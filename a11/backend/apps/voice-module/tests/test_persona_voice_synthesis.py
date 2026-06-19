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
    def test_xtts_rvc_api_receives_explicit_persona_and_voice_style(self):
        previous_url = main.XTTS_RVC_URL
        previous_protocol = main.XTTS_RVC_PROTOCOL
        previous_post = main.requests.post

        class FakeResponse:
            def __init__(self, content: bytes):
                self.headers = {"content-type": "audio/wav"}
                self.content = content

            def raise_for_status(self):
                return None

        with tempfile.TemporaryDirectory() as temp_root:
            temp = pathlib.Path(temp_root)
            generated = temp / "generated.wav"
            reference = temp / "neutral-reference.wav"
            out_file = temp / "out.wav"
            write_wav(generated)
            write_wav(reference)
            wav_bytes = generated.read_bytes()
            captured = {}

            def fake_post(url, files, data, timeout):
                captured["url"] = url
                captured["data"] = dict(data)
                return FakeResponse(wav_bytes)

            main.XTTS_RVC_URL = "http://xtts-rvc.local:5000"
            main.XTTS_RVC_PROTOCOL = "a11"
            main.requests.post = fake_post

            try:
                result = main.run_xtts_rvc(
                    generated,
                    reference,
                    out_file,
                    "adaptive",
                    "bonjour",
                    0.4,
                    None,
                    persona="vivy",
                    voice_style="vivy-official-french-conversational",
                )
            finally:
                main.XTTS_RVC_URL = previous_url
                main.XTTS_RVC_PROTOCOL = previous_protocol
                main.requests.post = previous_post

            self.assertEqual(captured["url"], "http://xtts-rvc.local:5000/api/voice/convert")
            self.assertEqual(captured["data"]["persona"], "vivy")
            self.assertEqual(captured["data"]["voiceStyle"], "vivy")
            self.assertEqual(result["voiceStyle"], "vivy")
            self.assertTrue(out_file.exists())

    def test_a11_ref_infers_official_voice_not_robot_style(self):
        with tempfile.TemporaryDirectory() as temp_root:
            reference = pathlib.Path(temp_root) / "A11 ref.wav"
            write_wav(reference)

            self.assertEqual(main.infer_reference_style(reference), "a11-official-stern-french")

    def test_resolve_piper_model_uses_requested_model_directory(self):
        previous_model_dirs = os.environ.get("A11_PIPER_MODEL_DIRS")

        with tempfile.TemporaryDirectory() as temp_root:
            model_dir = pathlib.Path(temp_root)
            model_path = model_dir / "fr_FR-tom-medium.onnx"
            config_path = model_dir / "fr_FR-tom-medium.onnx.json"
            model_path.write_bytes(b"model")
            config_path.write_text("{}", encoding="utf-8")
            os.environ["A11_PIPER_MODEL_DIRS"] = str(model_dir)

            try:
                resolved_model, resolved_config = main.resolve_piper_model(main.SynthesizeRequest(
                    text="bonjour",
                    voice="fr_FR-tom-medium",
                ))
            finally:
                if previous_model_dirs is None:
                    os.environ.pop("A11_PIPER_MODEL_DIRS", None)
                else:
                    os.environ["A11_PIPER_MODEL_DIRS"] = previous_model_dirs

        self.assertEqual(resolved_model, model_path)
        self.assertEqual(resolved_config, config_path)

    def test_a11_prefers_official_stern_reference_before_legacy_reference(self):
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
            write_wav(library / "a11-terminator.wav")
            write_wav(library / "A11 ref.wav")
            write_wav(library / "a11-official-stern-french.wav")
            main.OUT_DIR = out_dir
            os.environ["A11_VOICE_LIBRARY_DIR"] = str(library)

            def fake_piper(text, out_file, req):
                write_wav(out_file)
                return {"via": "test-piper"}

            def fake_espeak(text, out_file, req):
                raise AssertionError("espeak should not run when piper succeeds")

            def fake_morph(generated_file, reference_file, out_file, mode, strength, f0_shift):
                self.assertEqual(reference_file.name, "A11 ref.wav")
                self.assertEqual(round(strength, 2), 0.62)
                self.assertEqual(round(f0_shift, 1), -2.4)
                write_wav(out_file)
                return {
                    "provider": "ffmpeg-morph",
                    "engine": "test-morph",
                    "voiceStyle": "a11-official-stern-french",
                }

            main.run_piper = fake_piper
            main.run_espeak = fake_espeak
            main.run_ffmpeg_morph = fake_morph

            try:
                payload = main.synthesize(main.SynthesizeRequest(
                    text="bonjour",
                    persona="a11",
                    voicePersona="a11",
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
        self.assertEqual(payload["voiceReference"]["label"], "A11 ref.wav")
        self.assertEqual(payload["voiceConversion"]["voiceStyle"], "a11-official-stern-french")

    def test_kaen44_official_persona_synthesis_uses_owned_family_reference_voice(self):
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
            write_wav(library / "K44 Ref.wav")
            write_wav(library / "kaen44-official-french-narrator.wav")
            main.OUT_DIR = out_dir
            os.environ["A11_VOICE_LIBRARY_DIR"] = str(library)

            def fake_piper(text, out_file, req):
                write_wav(out_file)
                return {"via": "test-piper"}

            def fake_espeak(text, out_file, req):
                raise AssertionError("espeak should not run when piper succeeds")

            def fake_morph(generated_file, reference_file, out_file, mode, strength, f0_shift):
                self.assertEqual(reference_file.name, "K44 Ref.wav")
                write_wav(out_file)
                return {"provider": "ffmpeg-morph", "engine": "test-morph", "voiceStyle": "kaen44-official-french-narrator"}

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
        self.assertEqual(payload["voiceReference"]["label"], "K44 Ref.wav")
        self.assertEqual(payload["voiceConversion"]["voiceStyle"], "kaen44-official-french-narrator")
        self.assertEqual(payload["via"], "a11-voice-module-persona")


if __name__ == "__main__":
    unittest.main()
