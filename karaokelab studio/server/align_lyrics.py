import sys
import json
import os
import re
import difflib
import unicodedata
import whisper
import warnings
import torchaudio
import numpy as np

warnings.filterwarnings("ignore")

def normalize_text(text: str) -> str:
    if not text:
        return ""
    # Normalize unicode and remove diacritics / punctuation for matching
    nfd = unicodedata.normalize('NFD', text)
    cleaned = ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-zA-Z0-9\s]', '', cleaned).lower().strip()

def strip_line_metadata(raw_line: str) -> str:
    cleaned = raw_line.strip()
    # Remove timestamps [00:12.34]
    cleaned = re.sub(r'\[\d+:\d+(\.\d+)?\]', '', cleaned)
    # Remove bracket tags [Hombre], [Refrán: Wisin], etc.
    cleaned = re.sub(r'\[[^\]]+\]', '', cleaned)
    cleaned = re.sub(r'^\((?:hombre|mujer|él|ella|male|female|v1|v2|both|all|ambos)\)\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'^\s*:\s*', '', cleaned)
    return cleaned.strip()

def align_lyrics_with_transcription(official_lines, whisper_words, total_duration=180.0):
    if not official_lines or not whisper_words:
        return []

    # Clean whisper words to normalized tokens
    w_clean_list = [normalize_text(w['word']) for w in whisper_words]
    w_count = len(whisper_words)

    aligned_results = []
    w_cursor = 0
    last_valid_time = 0.0

    for line_idx, raw_line in enumerate(official_lines):
        line_clean = strip_line_metadata(raw_line)
        if not line_clean:
            aligned_results.append({
                'time': last_valid_time + 1.0,
                'text': '',
                'duration': 2.0,
                'words': []
            })
            continue

        raw_words = line_clean.split()
        norm_words = [normalize_text(w) for w in raw_words]
        norm_words = [w for w in norm_words if w]
        if not norm_words:
            aligned_results.append({
                'time': last_valid_time + 1.0,
                'text': line_clean,
                'duration': 2.0,
                'words': []
            })
            continue

        best_score = -1.0
        best_start = -1
        best_len = len(norm_words)

        # Search window: from current cursor up to cursor + 60 words
        search_limit = min(w_count, w_cursor + 60)
        target_len = len(norm_words)

        for candidate_start in range(w_cursor, max(w_cursor + 1, search_limit - target_len + 1)):
            for span in range(max(1, target_len - 2), min(target_len + 5, w_count - candidate_start + 1)):
                candidate_words = w_clean_list[candidate_start : candidate_start + span]
                cand_str = " ".join(candidate_words)
                target_str = " ".join(norm_words)

                ratio = difflib.SequenceMatcher(None, cand_str, target_str).ratio()
                if ratio > best_score:
                    best_score = ratio
                    best_start = candidate_start
                    best_len = span
                    if ratio >= 0.85:
                        break
            if best_score >= 0.85:
                break

        # If a match was found (>= 0.35 similarity)
        if best_score >= 0.35 and best_start >= 0:
            matched_whisper_slice = whisper_words[best_start : best_start + best_len]
            start_time = max(last_valid_time + 0.1, matched_whisper_slice[0]['start'])
            end_time = max(start_time + 0.8, matched_whisper_slice[-1]['end'])

            # Build word-level timestamps
            words_data = []
            for w_i, raw_w in enumerate(raw_words):
                if w_i < len(matched_whisper_slice):
                    w_obj = matched_whisper_slice[w_i]
                    w_s = max(start_time, round(w_obj['start'], 2))
                    w_e = max(w_s + 0.1, round(w_obj['end'], 2))
                    words_data.append({
                        'word': raw_w,
                        'start': w_s,
                        'end': w_e
                    })
                else:
                    prev_end = words_data[-1]['end'] if words_data else start_time
                    words_data.append({
                        'word': raw_w,
                        'start': round(prev_end, 2),
                        'end': round(max(prev_end + 0.3, end_time), 2)
                    })

            aligned_results.append({
                'time': round(start_time, 2),
                'text': line_clean,
                'duration': max(1.2, round(end_time - start_time, 2)),
                'words': words_data,
                'matched': True
            })

            last_valid_time = end_time
            w_cursor = best_start + best_len
        else:
            # Mark for interpolation
            aligned_results.append({
                'time': -1.0,
                'text': line_clean,
                'duration': max(1.5, len(raw_words) * 0.4 + 1.0),
                'words': [],
                'matched': False
            })

    # Interpolation Pass for any unaligned lines
    for i, item in enumerate(aligned_results):
        if item['time'] < 0:
            # Find previous matched anchor
            prev_time = 4.0
            for p in range(i - 1, -1, -1):
                if aligned_results[p]['time'] >= 0:
                    prev_time = aligned_results[p]['time'] + aligned_results[p]['duration'] + 0.3
                    break

            # Find next matched anchor
            next_time = total_duration - 4.0
            for n in range(i + 1, len(aligned_results)):
                if aligned_results[n]['time'] >= 0:
                    next_time = aligned_results[n]['time'] - 0.3
                    break

            interpolated_time = max(prev_time, min(next_time - 0.8, prev_time + (next_time - prev_time) * 0.3))
            item['time'] = round(interpolated_time, 2)

    # Clean matched metadata flag without changing original list order
    for item in aligned_results:
        item.pop('matched', None)

    return aligned_results

def force_align_audio_with_lyrics(vocal_wav_path, raw_lyrics_text, output_json_path):
    print(f"[AI Forced Aligner] Loading audio: {vocal_wav_path}...", flush=True)

    wav, sr = torchaudio.load(vocal_wav_path)
    if wav.shape[0] > 1:
        wav = wav.mean(dim=0)
    else:
        wav = wav.squeeze(0)
    if sr != 16000:
        wav = torchaudio.functional.resample(wav, sr, 16000)
    audio_array = wav.numpy().astype(np.float32)
    total_audio_duration = float(len(audio_array) / 16000.0)

    # 1. Parse official lines 1-to-1
    official_lines = []
    for raw in raw_lyrics_text.splitlines():
        cleaned = strip_line_metadata(raw)
        official_lines.append(cleaned)

    # 2. Run OpenAI Whisper
    print("[AI Forced Aligner] Running Whisper base with word timestamps...", flush=True)
    model = whisper.load_model("base", device="cpu")
    sample_prompt = " ".join([l for l in official_lines if l][:6]) if official_lines else None

    result = model.transcribe(
        audio_array,
        word_timestamps=True,
        initial_prompt=sample_prompt,
        temperature=0.0
    )

    # 3. Extract word timestamps
    whisper_words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            word_text = w.get("word", "").strip()
            if word_text:
                whisper_words.append({
                    "word": word_text,
                    "start": round(w.get("start", 0.0), 2),
                    "end": round(w.get("end", 0.0), 2)
                })

    print(f"[AI Forced Aligner] Transcribed {len(whisper_words)} acoustic words.", flush=True)

    # 4. Perform 1-to-1 alignment
    final_lyrics = []
    if official_lines:
        if len(whisper_words) > 0:
            final_lyrics = align_lyrics_with_transcription(official_lines, whisper_words, total_audio_duration)
        else:
            # Fallback linear distribution if whisper had 0 words
            intro = 8.0
            step = max(2.0, (total_audio_duration - intro - 4.0) / max(1, len(official_lines)))
            for i, line in enumerate(official_lines):
                final_lyrics.append({
                    "time": round(intro + i * step, 2),
                    "text": line,
                    "duration": round(step, 2),
                    "words": []
                })

    for i in range(len(final_lyrics) - 1):
        gap = final_lyrics[i + 1]["time"] - final_lyrics[i]["time"]
        if gap > 0:
            final_lyrics[i]["duration"] = min(final_lyrics[i]["duration"], round(gap, 2))

    print(f"[AI Forced Aligner] Complete: {len(final_lyrics)} lines aligned with exact voice.", flush=True)

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump({
            "success": True,
            "lyrics": final_lyrics
        }, f, indent=2)

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python3 align_lyrics.py <vocal_wav_path> <lyrics_text_file> <output_json_path>")
        sys.exit(1)

    vocal_wav = sys.argv[1]
    lyrics_txt_file = sys.argv[2]
    out_json = sys.argv[3]

    with open(lyrics_txt_file, "r", encoding="utf-8") as f:
        raw_text = f.read()

    force_align_audio_with_lyrics(vocal_wav, raw_text, out_json)
