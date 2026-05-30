import pathlib
import sys
import tempfile
import unittest
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from apply_prime_spiral_morph import apply_morph


class PrimeSpiralWavScriptTests(unittest.TestCase):
    def test_apply_morph_writes_wav(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            source = tmp_path / "source.wav"
            target = tmp_path / "target.wav"
            with wave.open(str(source), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(8000)
                wav.writeframes((b"\x00\x10" * 800))

            meta = apply_morph(source, target, mode="op_symmetry", dry_wet=0.2)
            self.assertTrue(target.exists())
            self.assertEqual(meta["controlPoints"], 5)

            with wave.open(str(target), "rb") as wav:
                self.assertEqual(wav.getnchannels(), 1)
                self.assertEqual(wav.getframerate(), 8000)
                self.assertEqual(wav.getnframes(), 800)


if __name__ == "__main__":
    unittest.main()
