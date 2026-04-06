import os
import wave

OUT_DIR = "d:/a11/tts/out"

for fname in os.listdir(OUT_DIR):
    if not fname.endswith(".wav"):
        continue
    fpath = os.path.join(OUT_DIR, fname)
    try:
        with wave.open(fpath, "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            duration = frames / float(rate)
            print(f"{fname}: {duration:.2f} sec")
    except Exception as e:
        print(f"{fname}: ERROR - {e}")
