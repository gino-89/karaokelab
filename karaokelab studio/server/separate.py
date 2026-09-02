import sys
import os
import warnings
import torch
import torchaudio
from demucs.pretrained import get_model
from demucs.apply import apply_model

warnings.filterwarnings("ignore")

def separate(input_path, output_dir):
    os.makedirs(output_dir, exist_ok=True)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"[Demucs AI] Running Studio Model (htdemucs) on {device}...", flush=True)

    try:
        model = get_model("htdemucs")
        model.to(device)
        model.eval()
    except Exception as err:
        print(f"[Demucs AI] Fallback to CPU: {err}", flush=True)
        device = "cpu"
        model = get_model("htdemucs")
        model.to(device)
        model.eval()

    if device == "cpu" and hasattr(torch, 'set_num_threads'):
        torch.set_num_threads(6)

    print(f"[Demucs AI] Loading audio: {input_path}...", flush=True)
    wav, sr = torchaudio.load(input_path)

    # Resample to model sample rate (44100Hz) if necessary
    if sr != model.samplerate:
        wav = torchaudio.functional.resample(wav, sr, model.samplerate)
        sr = model.samplerate

    # Ensure stereo (2 channels)
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    elif wav.shape[0] > 2:
        wav = wav[:2]

    # Save original max peak for volume scaling
    max_peak = wav.abs().max().item()
    if max_peak > 1.0:
        wav = wav / max_peak

    wav = wav.to(device)

    print(f"[Demucs AI] Processing stems on {device} (shifts=1, overlap=0.25)...", flush=True)
    try:
        with torch.no_grad():
            sources = apply_model(model, wav[None], device=device, shifts=1, split=True, overlap=0.25)[0]
    except Exception as mpsErr:
        print(f"[Demucs AI] MPS GPU fallback to CPU: {mpsErr}", flush=True)
        device = "cpu"
        model.to(device)
        wav = wav.to(device)
        with torch.no_grad():
            sources = apply_model(model, wav[None], device=device, shifts=1, split=True, overlap=0.25)[0]

    sources = sources.cpu()

    # Restore original volume scale if scaled
    if max_peak > 1.0:
        sources = sources * max_peak

    # Map sources by name (drums, bass, other, vocals)
    source_names = model.sources
    stems = {name: sources[idx] for idx, name in enumerate(source_names)}

    # 1. Clean Instrumental (Drums + Bass + Other)
    instrumental = stems['drums'] + stems['bass'] + stems['other']

    inst_peak = instrumental.abs().max().item()
    if inst_peak > 0.99:
        instrumental = instrumental * (0.98 / inst_peak)

    inst_path = os.path.join(output_dir, "instrumental.wav")
    torchaudio.save(inst_path, instrumental, sr, encoding="PCM_S", bits_per_sample=16)
    print(f"[Demucs AI] Saved Instrumental: {inst_path}", flush=True)

    # 2. Studio Vocals (Pure Acapella)
    vocals = stems['vocals']
    voc_peak = vocals.abs().max().item()
    if voc_peak > 0.99:
        vocals = vocals * (0.98 / voc_peak)

    voc_path = os.path.join(output_dir, "vocals.wav")
    torchaudio.save(voc_path, vocals, sr, encoding="PCM_S", bits_per_sample=16)
    print(f"[Demucs AI] Saved Vocals: {voc_path}", flush=True)

    # 3. Bass
    bass_path = os.path.join(output_dir, "bass.wav")
    torchaudio.save(bass_path, stems['bass'], sr, encoding="PCM_S", bits_per_sample=16)
    print(f"[Demucs AI] Saved Bass: {bass_path}", flush=True)

    print("SUCCESS: Separation complete!", flush=True)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 separate.py <input_audio> <output_dir>")
        sys.exit(1)
    input_file = sys.argv[1]
    out_dir = sys.argv[2]
    separate(input_file, out_dir)
