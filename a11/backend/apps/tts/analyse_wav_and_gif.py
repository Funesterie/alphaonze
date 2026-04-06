import os
import math
import wave
from pathlib import Path
from PIL import Image, ImageSequence

ROOT_DIR = Path(__file__).resolve().parent
OUT_DIR = ROOT_DIR / "out"
GIF_PATH = ROOT_DIR / "A11_talking_smooth_8s.gif"

def get_wav_duration(path: Path) -> float:
    """Durée du WAV en secondes."""
    with wave.open(str(path), "rb") as wav:
        frames = wav.getnframes()
        rate = wav.getframerate()
        return frames / float(rate)

def get_gif_single_loop_duration(path: Path) -> float:
    """Durée d'UNE boucle complète du GIF en secondes."""
    im = Image.open(str(path))
    total_ms = 0
    for frame in ImageSequence.Iterator(im):
        total_ms += frame.info.get("duration", im.info.get("duration", 0))
    return total_ms / 1000.0

def main():
    if not GIF_PATH.exists():
        print(f"[ERR] GIF introuvable : {GIF_PATH}")
        return

    gif_loop_sec = get_gif_single_loop_duration(GIF_PATH)
    print(f"GIF: {GIF_PATH.name} → durée 1 boucle ≈ {gif_loop_sec:.2f} s\n")

    if not OUT_DIR.exists():
        print(f"[ERR] Dossier WAV introuvable : {OUT_DIR}")
        return

    for fname in sorted(os.listdir(OUT_DIR)):
        if not fname.lower().endswith(".wav"):
            continue
        fpath = OUT_DIR / fname
        try:
            wav_sec = get_wav_duration(fpath)
            loops = max(1, math.ceil(wav_sec / gif_loop_sec))
            total_gif_sec = loops * gif_loop_sec
            print(
                f"{fname}: WAV ≈ {wav_sec:6.2f} s  |  "
                f"loops GIF = {loops:2d}  → durée GIF ≈ {total_gif_sec:6.2f} s"
            )
        except Exception as e:
            print(f"{fname}: ERROR - {e}")

if __name__ == "__main__":
    main()
