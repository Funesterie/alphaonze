import os
import math
import wave
from pathlib import Path

from PIL import Image, ImageSequence  # pip install pillow

ROOT_DIR = Path(__file__).resolve().parent
OUT_DIR = ROOT_DIR / "out"
GIF_TEMPLATE = ROOT_DIR / "A11_talking_smooth_8s.gif"


def get_wav_duration(path: Path) -> float:
    """Durée du WAV en secondes."""
    with wave.open(str(path), "rb") as wav:
        frames = wav.getnframes()
        rate = wav.getframerate()
        return frames / float(rate)


def load_gif_frames(path: Path):
    """Charge les frames + durées d'un GIF et renvoie (frames, durations_ms, loop_duration_sec)."""
    im = Image.open(str(path))

    frames = []
    durations = []
    total_ms = 0

    for frame in ImageSequence.Iterator(im):
        f = frame.convert("P")  # palette pour GIF
        frames.append(f)
        d = frame.info.get("duration", im.info.get("duration", 100))  # ms
        durations.append(d)
        total_ms += d

    loop_sec = total_ms / 1000.0
    return frames, durations, loop_sec


def main():
    if not GIF_TEMPLATE.exists():
        print(f"[ERR] GIF modèle introuvable : {GIF_TEMPLATE}")
        return

    frames, base_durations, gif_loop_sec = load_gif_frames(GIF_TEMPLATE)
    print(f"[GIF] {GIF_TEMPLATE.name} → durée 1 boucle ≈ {gif_loop_sec:.2f} s")

    if not OUT_DIR.exists():
        print(f"[ERR] Dossier WAV introuvable : {OUT_DIR}")
        return

    for fname in sorted(os.listdir(OUT_DIR)):
        if not fname.lower().endswith(".wav"):
            continue

        wav_path = OUT_DIR / fname
        try:
            wav_sec = get_wav_duration(wav_path)
            loops = max(1, math.ceil(wav_sec / gif_loop_sec))

            # On duplique les frames et les durées
            all_frames = frames * loops
            all_durations = base_durations * loops

            # Nom du GIF de sortie
            out_gif = OUT_DIR / f"{wav_path.stem}_a11.gif"

            # Sauvegarde du GIF
            first, rest = all_frames[0], all_frames[1:]
            first.save(
                out_gif,
                save_all=True,
                append_images=rest,
                duration=all_durations,
                loop=0,      # 0 = boucle infinie (en plus des frames déjà répétées)
                disposal=2,
            )

            print(
                f"[OK] {out_gif.name} → WAV ≈ {wav_sec:.2f}s, "
                f"boucles GIF = {loops}, durée GIF ≈ {loops * gif_loop_sec:.2f}s"
            )

        except Exception as e:
            print(f"[ERR] {fname}: {e}")


if __name__ == "__main__":
    main()
