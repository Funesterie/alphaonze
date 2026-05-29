import os
import pathlib
import sys
import tempfile
import unittest
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import main


def write_wav(path: pathlib.Path) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(22050)
        handle.writeframes(b"\x00\x00" * 2205)


class PersonaVoiceSynthesisTests(unittest.TestCase):
    def test_official_persona_synthesis_uses_local_reference_voice(self):
        previous_library = os.environ.get("A11_VOICE_LIBRARY_DIR")
        previous_out_dir = main.OUT_DIR
        previous_run_piper = main.run_piper
        previous_run_espeak = main.run_espeak
        previous_run_ffmpeg_morph = main.run_ffmpeg_morph

        with tempfile.TemporaryDirectory() as temp_root:
            temp = pathlib.Path(temp_root)
            library = temp / "voice-library"
            out_dir = temp / "out"
            library.mkdir()
            out_dir.mkdir()
            write_wav(library / "kaen44-donna.wav")
            main.OUT_DIR = out_dir
            os.environ["A11_VOICE_LIBRARY_DIR"] = str(library)

            def fake_piper(text, out_file, req):
                write_wav(out_file)
                return {"via": "test-piper"}

            def fake_espeak(text, out_file, req):
                raise AssertionError("espeak should not run when piper succeeds")

            def fake_morph(generated_file, reference_file, out_file, mode, strength, f0_shift):
                self.assertEqual(reference_file.name, "kaen44-donna.wav")
                write_wav(out_file)
                return {"provider": "ffmpeg-morph", "engine": "test-morph", "voiceStyle": "donna"}

            main.run_piper = fake_piper
            main.run_espeak = fake_espeak
            main.run_ffmpeg_morph = fake_morph

            try:
                payload = main.synthesize(main.SynthesizeRequest(
                    text="bonjour",
                    persona="kaen44",
                    voicePersona="kaen44",
                    useDefaultVoiceReference=True,
                    voiceReferenceRequired=True,
                    vocalMode="adaptive",
                    engine="ffmpeg-morph",
                ))
            finally:
                main.run_piper = previous_run_piper
                main.run_espeak = previous_run_espeak
                main.run_ffmpeg_morph = previous_run_ffmpeg_morph
                main.OUT_DIR = previous_out_dir
                if previous_library is None:
                    os.environ.pop("A11_VOICE_LIBRARY_DIR", None)
                else:
                    os.environ["A11_VOICE_LIBRARY_DIR"] = previous_library

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["providerCapabilities"]["referenceVoice"], True)
        self.assertEqual(payload["voiceConversion"]["ok"], True)
        self.assertEqual(payload["voiceReference"]["label"], "kaen44-donna.wav")
        self.assertEqual(payload["via"], "a11-voice-module-persona")


if __name__ == "__main__":
    unittest.main()
