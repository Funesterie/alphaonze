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


if __name__ == "__main__":
    unittest.main()
