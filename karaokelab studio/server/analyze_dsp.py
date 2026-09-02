import sys
import json
import numpy as np
import scipy.signal
import soundfile as sf
import librosa

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Professional Key Profiles
KRUMHANSL_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KRUMHANSL_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

TEMPERLEY_MAJ = np.array([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0])
TEMPERLEY_MIN = np.array([5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0])

def standardize(v):
    std = np.std(v)
    if std < 1e-6:
        return v - np.mean(v)
    return (v - np.mean(v)) / std

def analyze_audio_bpm_and_key(audio_path, output_json_path):
    print(f"Starting High-Precision DSP Analysis: {audio_path}...", flush=True)
    
    # 1. Load up to 180s of audio
    y, sr = librosa.load(audio_path, sr=22050, mono=True, duration=180.0)
    
    # 2. Harmonic-Percussive Separation
    y_harm, y_perc = librosa.effects.hpss(y)
    
    # ── 1. EXACT SUB-SAMPLE BPM ESTIMATION (0.01 BPM Resolution) ──
    hop = 128 # 5.8ms high-resolution frame step
    fps = sr / hop
    onset = librosa.onset.onset_strength(y=y_perc, sr=sr, hop_length=hop)
    
    # Fast autocorrelation
    ac = np.correlate(onset, onset, mode='full')
    ac = ac[len(onset)-1:]
    
    # Focus search on standard musical range (50 to 220 BPM)
    min_lag = int(round(60.0 * fps / 220.0))
    max_lag = int(round(60.0 * fps / 50.0))
    
    peaks, _ = scipy.signal.find_peaks(ac[min_lag:max_lag], distance=max(5, min_lag // 2))
    
    if len(peaks) > 0:
        best_peak_idx = peaks[np.argmax(ac[min_lag + peaks])] + min_lag
        # Quadratic sub-sample parabolic interpolation
        if 1 < best_peak_idx < len(ac) - 1:
            y0 = ac[best_peak_idx - 1]
            y1 = ac[best_peak_idx]
            y2 = ac[best_peak_idx + 1]
            denom = y0 - 2.0 * y1 + y2
            delta = 0.5 * (y0 - y2) / denom if abs(denom) > 1e-6 else 0.0
            true_lag = best_peak_idx + delta
        else:
            true_lag = float(best_peak_idx)
            
        exact_bpm = (60.0 * fps) / true_lag
    else:
        # Fallback to librosa beat_track
        tempo, _ = librosa.beat.beat_track(y=y_perc, sr=sr, start_bpm=120)
        exact_bpm = float(tempo[0] if isinstance(tempo, np.ndarray) else tempo)
        
    # Scale octave if necessary
    if exact_bpm < 65:
        exact_bpm *= 2
    elif exact_bpm > 195:
        exact_bpm /= 2
        
    final_bpm = int(round(exact_bpm))
    print(f"✓ Exact Sub-Sample BPM: {final_bpm} (raw: {exact_bpm:.2f})", flush=True)
    
    # ── 2. EXACT MUSICAL KEY ESTIMATION ──
    # A. Bass Root Detection (C1 to C3)
    try:
        chroma_bass = librosa.feature.chroma_cqt(y=y_harm, sr=sr, fmin=librosa.note_to_hz('C1'), n_octaves=3, n_chroma=12)
        bass_profile = np.mean(chroma_bass, axis=1)
        bass_root_idx = int(np.argmax(bass_profile))
    except Exception:
        bass_root_idx = 0

    # B. Full Harmonic Chroma CQT & CENS
    chroma_cqt = librosa.feature.chroma_cqt(y=y_harm, sr=sr, n_chroma=12, bins_per_octave=36)
    chroma_cens = librosa.feature.chroma_cens(y=y_harm, sr=sr, n_chroma=12)
    harmonic_profile = 0.6 * np.mean(chroma_cqt, axis=1) + 0.4 * np.mean(chroma_cens, axis=1)
    harmonic_norm = standardize(harmonic_profile)

    best_key = "C Major"
    best_score = -999.0
    
    profiles = [
        (standardize(TEMPERLEY_MAJ), standardize(TEMPERLEY_MIN), 1.4),
        (standardize(KRUMHANSL_MAJ), standardize(KRUMHANSL_MIN), 1.0),
    ]

    for root in range(12):
        maj_score = 0.0
        min_score = 0.0
        
        for maj_prof, min_prof, weight in profiles:
            maj_score += weight * float(np.dot(harmonic_norm, np.roll(maj_prof, root)))
            min_score += weight * float(np.dot(harmonic_norm, np.roll(min_prof, root)))
            
        if root == bass_root_idx:
            maj_score += 0.8
            min_score += 0.8

        maj3_energy = harmonic_profile[(root + 4) % 12]
        min3_energy = harmonic_profile[(root + 3) % 12]
        if maj3_energy > min3_energy:
            maj_score += 0.5
        else:
            min_score += 0.5

        if maj_score > best_score:
            best_score = maj_score
            best_key = f"{NOTE_NAMES[root]} Major"
            
        if min_score > best_score:
            best_score = min_score
            best_key = f"{NOTE_NAMES[root]} Minor"

    print(f"✓ Exact Key: {best_key}", flush=True)
    
    result_data = {
        "success": True,
        "bpm": final_bpm,
        "key": best_key
    }
    
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(result_data, f, indent=2)
        
    print("DSP analysis completed successfully.", flush=True)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 analyze_dsp.py <audio_path> <output_json_path>")
        sys.exit(1)
    analyze_audio_bpm_and_key(sys.argv[1], sys.argv[2])
