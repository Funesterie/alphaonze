import importlib.util
import math
import os
import pathlib
import struct
import sys
import tempfile
import types
import unittest
import wave


BRIDGE_PATH = pathlib.Path(__file__).with_name("funesterie_xtts_rvc_api.py")


def write_tone_wav(path: pathlib.Path, duration_sec: float, rate: int = 22050) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(duration_sec * rate)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        for index in range(frames):
            sample = int(8000 * math.sin(2 * math.pi * 220 * index / rate))
            handle.writeframesraw(struct.pack("<h", sample))


def install_runtime_stubs() -> None:
    torch_stub = types.ModuleType("torch")
    torch_stub.cuda = types.SimpleNamespace(is_available=lambda: False)
    torch_stub.load = lambda *args, **kwargs: None
    torch_stub.set_num_threads = lambda value: None
    sys.modules["torch"] = torch_stub

    tts_package = types.ModuleType("TTS")
    tts_api = types.ModuleType("TTS.api")

    class FakeTTS:
        def __init__(self, *args, **kwargs):
            pass

        def to(self, device):
            return self

    tts_api.TTS = FakeTTS
    sys.modules["TTS"] = tts_package
    sys.modules["TTS.api"] = tts_api


def import_bridge(temp_root: pathlib.Path):
    install_runtime_stubs()
    previous_env = {
        key: os.environ.get(key)
        for key in (
            "A11_XTTS_RVC_ROOT",
            "A11_XTTS_RVC_DEVICE",
            "A11_XTTS_RVC_PREPARE_SPEAKER_WAV",
            "A11_XTTS_RVC_DURATION_GUARD",
        )
    }
    os.environ["A11_XTTS_RVC_ROOT"] = str(temp_root)
    os.environ["A11_XTTS_RVC_DEVICE"] = "cpu"
    module_name = f"funesterie_xtts_rvc_api_test_{id(temp_root)}"
    spec = importlib.util.spec_from_file_location(module_name, BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
        return module, previous_env
    except Exception:
        sys.modules.pop(module_name, None)
        raise


def restore_env(previous_env: dict) -> None:
    for key, value in previous_env.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


class XttsRvcBridgeAudioGuardTests(unittest.TestCase):
    def test_synthesize_prepares_long_reference_and_trims_runaway_xtts_output(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = pathlib.Path(temp_dir)
            bridge, previous_env = import_bridge(temp_root)
            try:
                voice_path = bridge.VOICES_DIR / "a11-official-stern-french.wav"
                write_tone_wav(voice_path, duration_sec=14.0)
                captured = {}

                class FakeSynthesizer:
                    def tts_to_file(self, text, speaker_wav, language, file_path):
                        del text, language
                        speaker_path = pathlib.Path(speaker_wav)
                        captured["speakerSeconds"] = bridge.probe_audio_duration_seconds(speaker_path)
                        write_tone_wav(pathlib.Path(file_path), duration_sec=20.0)

                bridge.get_tts = lambda: FakeSynthesizer()

                result = bridge.synthesize_persona_voice(
                    "Salut Jeffrey. Je teste une phrase courte et claire.",
                    persona="a11",
                    vocal_mode="adaptive",
                    use_rvc=False,
                )

                self.assertEqual(result["engine"], "xtts-reference")
                self.assertEqual(result["speakerPreparation"]["action"], "prepared")
                self.assertLessEqual(captured["speakerSeconds"], 12.2)
                self.assertEqual(result["durationGuard"]["action"], "trimmed")
                self.assertLessEqual(result["durationGuard"]["finalSeconds"], 7.0)
                self.assertLess(bridge.probe_audio_duration_seconds(result["path"]), 7.0)
            finally:
                restore_env(previous_env)

    def test_duration_guard_leaves_reasonable_xtts_output_alone(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = pathlib.Path(temp_dir)
            bridge, previous_env = import_bridge(temp_root)
            try:
                xtts_path = bridge.OUT_DIR / "xtts-a11-test.wav"
                write_tone_wav(xtts_path, duration_sec=3.0)

                metadata = bridge.constrain_xtts_output_duration(
                    xtts_path,
                    "Salut Jeffrey.",
                    "adaptive",
                    "a11-official-stern-french",
                )

                self.assertEqual(metadata["action"], "none")
                self.assertLessEqual(bridge.probe_audio_duration_seconds(xtts_path), 3.1)
            finally:
                restore_env(previous_env)


class GeneratedAudioConversionTests(unittest.TestCase):
    def test_convert_without_rvc_model_passes_clean_audio_through_without_xtts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = pathlib.Path(temp_dir)
            bridge, previous_env = import_bridge(temp_root)
            try:
                generated = bridge.OUT_DIR / "elevenlabs-input.wav"
                write_tone_wav(generated, duration_sec=2.0)

                def fail_xtts():
                    raise AssertionError("XTTS must not run during audio-to-audio conversion")

                bridge.get_tts = fail_xtts

                result = bridge.convert_generated_audio(
                    generated,
                    persona="a11",
                    voice_style="a11-official-stern-french",
                    use_rvc=True,
                    source_engine="elevenlabs",
                )

                # a11 has no .pth in the default manifest -> clean passthrough, not garbled XTTS
                self.assertEqual(result["engine"], "elevenlabs-clean")
                self.assertEqual(result["pipeline"], "convert")
                self.assertFalse(result["hasRvc"])
                self.assertTrue(result["path"].exists())
                self.assertGreater(result["path"].stat().st_size, 0)
            finally:
                restore_env(previous_env)

    def test_convert_with_rvc_model_runs_rvc_on_generated_audio_not_text(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = pathlib.Path(temp_dir)
            bridge, previous_env = import_bridge(temp_root)
            try:
                generated = bridge.OUT_DIR / "elevenlabs-input.wav"
                write_tone_wav(generated, duration_sec=2.0)
                # Provide a persona RVC model so the conversion re-timbres the clip.
                (bridge.RVCS_DIR / "vivy.pth").write_bytes(b"fake-rvc-model")
                captured = {}

                def fake_run_rvc(input_path, output_path, rvc_path, *args, **kwargs):
                    captured["input"] = pathlib.Path(input_path)
                    captured["rvc"] = pathlib.Path(rvc_path)
                    write_tone_wav(pathlib.Path(output_path), duration_sec=2.0)

                def fail_xtts():
                    raise AssertionError("XTTS must not run during audio-to-audio conversion")

                bridge.run_rvc = fake_run_rvc
                bridge.get_tts = fail_xtts

                result = bridge.convert_generated_audio(
                    generated,
                    persona="vivy",
                    voice_style="vivy",
                    use_rvc=True,
                    source_engine="elevenlabs",
                )

                self.assertEqual(result["engine"], "elevenlabs-rvc")
                self.assertTrue(result["hasRvc"])
                self.assertEqual(captured["rvc"].name, "vivy.pth")
                # The RVC input must be the supplied clip (or its prepared copy),
                # never a freshly synthesized XTTS file.
                self.assertTrue(captured["input"].name.startswith(("elevenlabs-input", "convert-src-")))
                self.assertTrue(result["path"].exists())
            finally:
                restore_env(previous_env)


if __name__ == "__main__":
    unittest.main()
