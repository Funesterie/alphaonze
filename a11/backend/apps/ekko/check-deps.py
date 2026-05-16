"""
Ekko — vérification des dépendances avant lancement.
Lance : python check-deps.py
"""
import sys
import importlib

def check(pkg, pip_name=None, optional=False):
    try:
        importlib.import_module(pkg)
        print(f"  ✓ {pkg}")
        return True
    except ImportError:
        tag = "(optionnel)" if optional else "REQUIS"
        print(f"  ✗ {pkg} {tag}  →  pip install {pip_name or pkg}")
        return not optional  # retourne True si bloquant

print(f"\nPython {sys.version}\n")
print("=== Dépendances Ekko ===\n")

errors = []

# Core
if not check("flask"):      errors.append("pip install flask")
if not check("numpy"):      errors.append("pip install numpy")

# Capture audio
print("\n--- Capture audio (un seul nécessaire) ---")
check("pyaudiowpatch", optional=True)   # Windows WASAPI
check("sounddevice",   optional=True)   # Linux/macOS

# VAD
print("\n--- VAD ---")
check("webrtcvad", optional=True)  # robuste, recommandé

# Transcription
print("\n--- Transcription ---")
check("faster_whisper", "faster-whisper", optional=True)
check("openai",  optional=True)
check("groq",    optional=True)

# Audio export (cloud backends)
print("\n--- Export audio ---")
check("soundfile", optional=True)

print()
if errors:
    print(f"⚠  Manquant (bloquant) :")
    for e in errors:
        print(f"   {e}")
    print()
    sys.exit(1)
else:
    print("✓ Dépendances core OK — tu peux lancer : python main.py\n")
