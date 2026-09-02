import sys
import json
import os
import torch
import whisper

def transcribe_vocals(audio_path, output_json_path):
    # Device: use cpu for reliable PyTorch execution across macOS
    device = "cpu"
    print(f"Loading Whisper AI model on {device}...", flush=True)
    
    # Load base model (robust, highly accurate across all languages and accents)
    model = whisper.load_model("base", device=device)
    
    import torchaudio
    import numpy as np

    print(f"Listening to song audio: {audio_path}...", flush=True)
    wav, sr = torchaudio.load(audio_path)
    if wav.shape[0] > 1:
        wav = wav.mean(dim=0)
    else:
        wav = wav.squeeze(0)
    if sr != 16000:
        wav = torchaudio.functional.resample(wav, sr, 16000)
    audio_array = wav.numpy().astype(np.float32)
    
    # Listen to audio waveform directly (no ffmpeg needed)
    result = model.transcribe(
        audio_array,
        temperature=0.0,
        condition_on_previous_text=False,
        no_speech_threshold=0.5,
        word_timestamps=True,
        verbose=False,
        initial_prompt="Letra de canción karaoke cantada, con ritmo y rima musical en español o inglés."
    )
    
    detected_lang = result.get("language", "es")
    print(f"Detected language from audio: {detected_lang}", flush=True)
    
    segments = result.get("segments", [])
    lyrics = []
    
    for seg in segments:
        words = seg.get("words", [])
        
        if words and len(words) >= 2:
            current_chunk = []
            for w in words:
                word_text = w.get("word", "").strip()
                w_start = round(w.get("start", 0.0), 2)
                w_end = round(w.get("end", 0.0), 2)
                
                if word_text:
                    current_chunk.append({
                        "word": word_text,
                        "start": w_start,
                        "end": w_end
                    })
                    
                # Split at punctuation or after 5-7 words for comfortable karaoke pacing
                is_punct = any(word_text.endswith(p) for p in ('.', ',', '?', '!', ';', ':'))
                if len(current_chunk) >= 6 or (len(current_chunk) >= 3 and is_punct):
                    line_start = current_chunk[0]["start"]
                    line_end = current_chunk[-1]["end"]
                    line_text = " ".join([cw["word"] for cw in current_chunk])
                    lyrics.append({
                        "time": line_start,
                        "text": line_text,
                        "duration": max(1.2, round(line_end - line_start, 2)),
                        "words": list(current_chunk)
                    })
                    current_chunk = []
                    
            if current_chunk:
                line_start = current_chunk[0]["start"]
                line_end = current_chunk[-1]["end"]
                line_text = " ".join([cw["word"] for cw in current_chunk])
                lyrics.append({
                    "time": line_start,
                    "text": line_text,
                    "duration": max(1.2, round(line_end - line_start, 2)),
                    "words": list(current_chunk)
                })
        else:
            text = seg.get("text", "").strip()
            start = round(seg.get("start", 0.0), 2)
            end = round(seg.get("end", 0.0), 2)
            dur = max(1.2, round(end - start, 2))
            if text and len(text) > 1:
                lyrics.append({
                    "time": start,
                    "text": text,
                    "duration": dur
                })
            
    # Sort chronologically & refine durations
    lyrics.sort(key=lambda x: x["time"])
    for i in range(len(lyrics) - 1):
        gap = lyrics[i + 1]["time"] - lyrics[i]["time"]
        if gap > 0:
            lyrics[i]["duration"] = min(lyrics[i]["duration"], round(gap, 2))
            
    # Write output
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump({
            "success": True,
            "language": detected_lang,
            "lyrics": lyrics
        }, f, ensure_ascii=False, indent=2)
        
    print(f"✓ AI heard and transcribed {len(lyrics)} lines directly from audio.", flush=True)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 transcribe.py <audio_path> <output_json_path>")
        sys.exit(1)
    transcribe_vocals(sys.argv[1], sys.argv[2])
