import sys
import os
import json
import numpy as np
import librosa
from scipy.ndimage import gaussian_filter1d

# ─── CONFIG ───────────────────────────────────────────────────────────────────
SAMPLE_RATE  = 22050
DURATION_MAX = 400.0   # seconds
FMIN_MALE    = 65.0    # Hz — bass floor (Barry White, deep baritone)
FMAX_FEMALE  = 900.0   # Hz — high soprano ceiling
WIN_SEC      = 1.5     # window size
HOP_SEC      = 0.5     # window step
MERGE_GAP_S  = 1.0     # merge adjacent same-singer segments within this gap


def classify_vocal_audio(vocals_wav_path: str, output_json_path: str, artist_name: str = ""):
    print(f"[KaraokeLab] PYIN F0-Diarizer v3 → {vocals_wav_path}", flush=True)

    # ── 1. Load audio ─────────────────────────────────────────────────────────
    try:
        y, sr = librosa.load(vocals_wav_path, sr=SAMPLE_RATE, mono=True, duration=DURATION_MAX)
    except Exception as e:
        _fail(output_json_path, f"Load error: {e}"); return

    if len(y) < sr * 1.5:
        _fail(output_json_path, "Audio too short"); return

    # ── 2. PYIN Pitch Extraction ──────────────────────────────────────────────
    # PYIN is probabilistic YIN — much more robust with vibrato, breath, harmonics.
    hop_length   = 512
    frame_length = 2048
    frames_per_sec = sr / hop_length

    try:
        f0, voiced_flag, _ = librosa.pyin(
            y,
            fmin=FMIN_MALE,
            fmax=FMAX_FEMALE,
            sr=sr,
            frame_length=frame_length,
            hop_length=hop_length,
        )
    except Exception as e:
        print(f"[PYIN] Error, using YIN fallback: {e}", flush=True)
        f0 = librosa.yin(y, fmin=FMIN_MALE, fmax=FMAX_FEMALE, sr=sr,
                         frame_length=frame_length, hop_length=hop_length)
        voiced_flag = (~np.isnan(f0)) & (f0 > FMIN_MALE) & (f0 < FMAX_FEMALE)

    # Clean: only voiced frames with valid pitch
    f0_voiced = np.where(voiced_flag & ~np.isnan(f0), f0, 0.0)

    voiced_pitches = f0_voiced[f0_voiced > FMIN_MALE]
    if len(voiced_pitches) < 30:
        _single_voice(output_json_path, "singer1", 0.0, "Not enough pitched frames")
        return

    print(f"[PYIN] voiced_frames={len(voiced_pitches)}, median={np.median(voiced_pitches):.1f}Hz", flush=True)

    # ── 3. Adaptive split threshold (per-song, not fixed 210 Hz) ─────────────
    #
    # Build pitch histogram in 5 Hz bins and find the VALLEY between the two
    # most prominent register peaks.
    # This is critical because tenors (~130-220 Hz) and female altos (~180-280 Hz)
    # overlap in frequency, and a fixed threshold would misclassify them.
    #
    hist_bins  = np.arange(FMIN_MALE, FMAX_FEMALE + 5, 5.0)
    hist, _    = np.histogram(voiced_pitches, bins=hist_bins)
    hist_sm    = gaussian_filter1d(hist.astype(float), sigma=2.5)

    peaks = _find_peaks(hist_sm)    # list of (center_hz, count), biggest first

    # Filter peaks by register: "male zone" ≤ 230 Hz, "female zone" ≥ 185 Hz
    low_peaks  = [(hz, v) for hz, v in peaks if FMIN_MALE <= hz < 230]
    high_peaks = [(hz, v) for hz, v in peaks if hz >= 185 and hz <= FMAX_FEMALE]

    is_bimodal = False
    split_hz   = 210.0   # safe default (covers most baritones and altos)

    if low_peaks and high_peaks:
        best_low  = max(low_peaks,  key=lambda x: x[1])
        best_high = max(high_peaks, key=lambda x: x[1])
        gap  = best_high[0] - best_low[0]
        maxv = max(hist_sm)

        # Two clearly separated register peaks?
        if (gap >= 30
                and best_low[1]  >= maxv * 0.06
                and best_high[1] >= maxv * 0.06):
            is_bimodal = True

            # Find the valley between the two peaks (minimum between them)
            lo_idx = int((best_low[0]  - FMIN_MALE) / 5)
            hi_idx = int((best_high[0] - FMIN_MALE) / 5)
            valley_region = hist_sm[lo_idx:hi_idx + 1]
            if len(valley_region) > 0:
                valley_idx = lo_idx + int(np.argmin(valley_region))
                split_hz   = FMIN_MALE + valley_idx * 5.0 + 2.5
            else:
                split_hz = (best_low[0] + best_high[0]) / 2.0

    print(f"[PYIN] bimodal={is_bimodal}, split_hz={split_hz:.1f}, peaks={peaks[:3]}", flush=True)

    # ── 4. RMS energy (for "both" simultaneous detection ONLY) ───────────────
    #
    # KEY INSIGHT: We do NOT use energy bands to decide male vs female.
    # We use PYIN F0 for that (much more accurate).
    # Energy bands are ONLY used to detect simultaneous singing (chorus/both).
    #
    # Margin: ±15 Hz around split to avoid catching harmonics in wrong band
    import scipy.signal
    male_hi  = max(60.0,        split_hz - 15)
    female_lo = min(800.0,      split_hz + 15)

    sos_male   = scipy.signal.butter(4, [FMIN_MALE, male_hi],  btype='bandpass', fs=sr, output='sos')
    sos_female = scipy.signal.butter(4, [female_lo, 800.0],    btype='bandpass', fs=sr, output='sos')
    sos_full   = scipy.signal.butter(4, [FMIN_MALE, 800.0],    btype='bandpass', fs=sr, output='sos')

    y_male   = scipy.signal.sosfilt(sos_male,   y)
    y_female = scipy.signal.sosfilt(sos_female, y)
    y_full   = scipy.signal.sosfilt(sos_full,   y)

    rms_total  = librosa.feature.rms(y=y_full,   hop_length=hop_length)[0]
    rms_male   = librosa.feature.rms(y=y_male,   hop_length=hop_length)[0]
    rms_female = librosa.feature.rms(y=y_female, hop_length=hop_length)[0]

    # Noise floor
    rms_nz     = rms_total[rms_total > 0.0005]
    noise_fl   = float(np.percentile(rms_nz, 12)) if len(rms_nz) > 0 else 0.001
    rms_thresh = max(0.001, noise_fl * 0.80)

    # ── 5. Sliding-window diarization ─────────────────────────────────────────
    win_frames  = int(WIN_SEC  * frames_per_sec)
    step_frames = int(HOP_SEC  * frames_per_sec)
    n_frames    = min(len(f0_voiced), len(rms_total))

    raw_segs   = []
    male_votes = female_votes = both_votes = 0

    for start_f in range(0, n_frames - win_frames, step_frames):
        end_f = start_f + win_frames

        sub_rms_tot = rms_total[start_f:end_f]
        sub_rms_m   = rms_male  [start_f:end_f]
        sub_rms_f   = rms_female[start_f:end_f]
        sub_f0      = f0_voiced [start_f:end_f]

        # Voiced frames: have pitch AND are above noise floor
        voiced_mask = (sub_rms_tot > rms_thresh) & (sub_f0 > FMIN_MALE)
        if np.sum(voiced_mask) < 3:
            continue  # silence / unvoiced window

        # ── PRIMARY CRITERION: F0-based male/female classification ────────────
        # Count how many voiced frames are in male zone vs female zone
        frame_f0   = sub_f0[voiced_mask]
        male_f0_frames   = np.sum(frame_f0 < split_hz)
        female_f0_frames = np.sum(frame_f0 >= split_hz)
        med_pitch   = float(np.median(frame_f0))

        # ── SECONDARY: Energy balance for "both" detection ────────────────────
        # "Both" singing = energy simultaneously active in male AND female bands
        mean_m  = float(np.mean(sub_rms_m[voiced_mask]))
        mean_f  = float(np.mean(sub_rms_f[voiced_mask]))
        balance = min(mean_m, mean_f) / max(1e-9, max(mean_m, mean_f))
        both_active = (mean_m > rms_thresh * 1.4) and (mean_f > rms_thresh * 1.4)
        is_both = both_active and balance >= 0.36

        # ── Decision (F0 primary, energy only for "both") ─────────────────────
        if is_both and is_bimodal:
            role = "both"
            both_votes += 1
        elif male_f0_frames >= female_f0_frames:
            role = "singer1"   # Hombre: more frames below split
            male_votes += 1
        else:
            role = "singer2"   # Mujer: more frames above split
            female_votes += 1

        start_sec = round(start_f / frames_per_sec, 2)
        end_sec   = round(end_f   / frames_per_sec, 2)
        raw_segs.append({
            "start":        start_sec,
            "end":          end_sec,
            "singer":       role,
            "pitchHz":      round(med_pitch, 1),
            "malef0Frames": int(male_f0_frames),
            "femalef0Frames": int(female_f0_frames),
        })

    # ── 6. Temporal smoothing: remove isolated single-window anomalies ────────
    if len(raw_segs) >= 3:
        for i in range(1, len(raw_segs) - 1):
            prev_r = raw_segs[i - 1]["singer"]
            curr_r = raw_segs[i]["singer"]
            next_r = raw_segs[i + 1]["singer"]
            # Isolated blip surrounded by same role → correct it
            if curr_r != "both" and prev_r == next_r and curr_r != prev_r:
                raw_segs[i]["singer"] = prev_r

    # ── 7. Merge adjacent same-singer segments ────────────────────────────────
    merged = []
    for seg in raw_segs:
        if not merged:
            merged.append(dict(seg))
        else:
            last = merged[-1]
            if last["singer"] == seg["singer"] and (seg["start"] - last["end"]) <= MERGE_GAP_S:
                last["end"] = seg["end"]
            else:
                merged.append(dict(seg))

    # ── 8. Global summary ─────────────────────────────────────────────────────
    total_v   = max(1, male_votes + female_votes + both_votes)
    male_pct  = male_votes   / total_v
    fem_pct   = female_votes / total_v
    both_pct  = both_votes   / total_v

    is_duet = (
        is_bimodal
        or (male_votes >= 2 and female_votes >= 2)
        or (both_votes >= 2 and (male_votes >= 1 or female_votes >= 1))
        or both_pct >= 0.10
    )

    primary_gender = "singer2" if female_votes > male_votes else "singer1"
    overall_median = float(np.median(voiced_pitches))

    print(
        f"[PYIN] isDuet={is_duet}, split={split_hz:.1f}Hz, "
        f"male={male_pct:.0%} fem={fem_pct:.0%} both={both_pct:.0%} "
        f"segs={len(merged)}",
        flush=True
    )

    result = {
        "success":          True,
        "isDuet":           is_duet,
        "primaryGender":    primary_gender,
        "splitHz":          round(split_hz, 1),
        "isBimodal":        is_bimodal,
        "meanPitchHz":      round(overall_median, 1),
        "malePercentage":   round(male_pct  * 100, 1),
        "femalePercentage": round(fem_pct   * 100, 1),
        "bothPercentage":   round(both_pct  * 100, 1),
        "segments":         merged,
    }

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _find_peaks(arr):
    bin_width = 5.0
    peaks = []
    for i in range(1, len(arr) - 1):
        if arr[i] > arr[i - 1] and arr[i] > arr[i + 1] and arr[i] > 0.5:
            hz = FMIN_MALE + i * bin_width + bin_width / 2
            peaks.append((hz, float(arr[i])))
    return sorted(peaks, key=lambda x: -x[1])


def _fail(path, msg):
    print(f"[ERROR] {msg}", flush=True)
    with open(path, "w") as f:
        json.dump({"success": False, "isDuet": False, "primaryGender": "singer1",
                   "segments": [], "error": msg}, f)


def _single_voice(path, gender, pitch, note=""):
    with open(path, "w") as f:
        json.dump({
            "success": True, "isDuet": False, "primaryGender": gender,
            "meanPitchHz": pitch, "segments": [], "note": note,
            "malePercentage": 100.0 if gender == "singer1" else 0.0,
            "femalePercentage": 100.0 if gender == "singer2" else 0.0,
            "bothPercentage": 0.0,
        }, f)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 classify_vocal.py <vocals_wav_path> <output_json_path> [artist_name]")
        sys.exit(1)
    artist = sys.argv[3] if len(sys.argv) > 3 else ""
    classify_vocal_audio(sys.argv[1], sys.argv[2], artist)
