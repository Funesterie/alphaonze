import gc
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import wave
from pathlib import Path
from typing import Optional

os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")

DEVICE = os.environ.get("A11_XTTS_RVC_DEVICE", "cpu").strip() or "cpu"
if DEVICE.lower() == "cpu":
    # The upstream RVC helper checks torch.cuda before honoring the requested
    # device. Mask CUDA early so CPU mode cannot crash on GPU index parsing.
    os.environ["CUDA_VISIBLE_DEVICES"] = "-1"

import requests
import torch
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from TTS.api import TTS

def patch_xtts_generation_mixin() -> bool:
    try:
        from functools import wraps
        from inspect import getattr_static
        from transformers import GenerationConfig
        from transformers.generation.utils import GenerationMixin
        from TTS.tts.layers.xtts.gpt import GPT2InferenceModel

        for name in dir(GenerationMixin):
            if name.startswith("__"):
                continue
            member = getattr(GenerationMixin, name)
            if callable(member) and not hasattr(GPT2InferenceModel, name):
                setattr(GPT2InferenceModel, name, getattr_static(GenerationMixin, name))

        if not getattr(GPT2InferenceModel, "_a11_generation_config_patched", False):
            original_init = GPT2InferenceModel.__init__

            @wraps(original_init)
            def init_with_generation_config(self, *args, **kwargs):
                original_init(self, *args, **kwargs)
                if getattr(self, "generation_config", None) is None:
                    self.generation_config = GenerationConfig.from_model_config(self.config)

            GPT2InferenceModel.__init__ = init_with_generation_config
            GPT2InferenceModel._a11_generation_config_patched = True

        return all(
            hasattr(GPT2InferenceModel, name)
            for name in ("generate", "_prepare_generation_config")
        )
    except Exception:
        return False


XTTS_GENERATE_PATCHED = patch_xtts_generation_mixin()

if DEVICE.lower() == "cpu":
    # Some CUDA builds still report a device on Windows after import. RVC only
    # needs a boolean here, so keep CPU mode deterministic.
    torch.cuda.is_available = lambda: False


ROOT = Path(os.environ.get("A11_XTTS_RVC_ROOT", Path.cwd())).resolve()
MODELS_DIR = ROOT / "models"
XTTS_DIR = MODELS_DIR / "xtts"
VOICES_DIR = ROOT / "voices"
RVCS_DIR = ROOT / "rvcs"
OUT_DIR = Path(os.environ.get("A11_XTTS_RVC_OUT_DIR", ROOT / "outputs")).resolve()
LANGUAGE = os.environ.get("A11_XTTS_RVC_LANGUAGE", "fr").strip() or "fr"
INDEX_RATE = float(os.environ.get("A11_XTTS_RVC_INDEX_RATE", "0.45") or "0.45")
HOST = os.environ.get("A11_XTTS_RVC_HOST", "127.0.0.1")
PORT = int(os.environ.get("A11_XTTS_RVC_PORT", "5000") or "5000")
PERSONA_MANIFEST_PATH = Path(
    os.environ.get("A11_XTTS_RVC_PERSONA_MANIFEST", RVCS_DIR / "funesterie-personas.json")
).resolve()

DEFAULT_PERSONA_MANIFEST = {
    "a11-official-stern-french": {
        "persona": "a11",
        "voice": "a11-official-stern-french.wav",
        "rvc": "",
        "index": "",
    },
    "a11-voix-de-lait": {
        "persona": "a11",
        "voice": "a11-voix-de-lait.wav",
        "rvc": "",
        "index": "",
    },
    "djeff-rap": {
        "persona": "djeff",
        "voice": "djeff-rap.wav",
        "rvc": "djeff-rap.pth",
        "index": "djeff-rap.index",
    },
    "kaen44-official-french-narrator": {
        "persona": "kaen44",
        "voice": "kaen44-official-french-narrator.wav",
        "rvc": "",
        "index": "",
    },
    "vivy": {
        "persona": "vivy",
        "voice": "vivy.wav",
        "rvc": "vivy.pth",
        "index": "vivy.index",
    },
    "vivy-official-french-conversational": {
        "persona": "vivy",
        "voice": "vivy.wav",
        "rvc": "vivy.pth",
        "index": "vivy.index",
    },
}

for item in (XTTS_DIR, VOICES_DIR, RVCS_DIR, OUT_DIR):
    item.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Funesterie XTTS/RVC Bridge", version="0.1.0")

_tts = None
_hubert_model = None
_rvc_config = None
_rvc_data = None
_rvc_runtime_lock = threading.Lock()
_synthesis_lock = threading.Lock()
_synthesis_state_lock = threading.Lock()
_synthesis_state = {
    "busy": False,
    "style": None,
    "startedAt": None,
}


def download_file(url: str, target: Path) -> None:
    if target.exists() and target.stat().st_size > 0:
        return
    response = requests.get(url, timeout=180)
    response.raise_for_status()
    target.write_bytes(response.content)


def ensure_models() -> None:
    rvc_base = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main"
    xtts_base = "https://huggingface.co/coqui/XTTS-v2/resolve/v2.0.2"
    for name in ("hubert_base.pt", "rmvpe.pt"):
        download_file(f"{rvc_base}/{name}", MODELS_DIR / name)
    for name in ("vocab.json", "config.json", "dvae.pth", "mel_stats.pth", "model.pth"):
        download_file(f"{xtts_base}/{name}", XTTS_DIR / name)


def normalize_style(value: str) -> str:
    key = (value or "").strip().lower()
    if key in {
        "a11",
        "alpha",
        "alphaonze",
        "a11-official",
        "a11-official-stern-french",
        "a11-voix-de-lait",
        "voix-de-lait",
        "voix de lait",
        "lait",
        "milk",
        "official-a11",
        "official",
    }:
        if key in {"a11-voix-de-lait", "voix-de-lait", "voix de lait", "lait", "milk"}:
            return "a11-voix-de-lait"
        return "a11-official-stern-french"
    if key in {
        "djeff",
        "djeff-rap",
        "rap-djeff",
        "pignon",
        "pignon-rap",
        "jeff",
        "jeffrey",
        "moto-rap",
    }:
        return "djeff-rap"
    if key in {
        "k44",
        "kaen44",
        "kaen",
        "kaen44-official",
        "kaen44-official-french-narrator",
        "official-kaen44",
        "official-k44",
        "family",
        "narrator",
    }:
        return "kaen44-official-french-narrator"
    if key in {"robot", "robotique", "cyber", "cybernetic", "cybernetique"}:
        return "a11-official-stern-french"
    if key in {
        "vivy",
        "vivy-official",
        "vivy-official-french-conversational",
        "vivy-french",
        "vivy-conversational",
        "official-vivy",
    }:
        return "vivy"
    return "a11-official-stern-french"


def resolve_style(persona: str = "", voice_style: str = "") -> str:
    persona_style = normalize_style(persona)
    raw_style = (voice_style or "").strip().lower()
    if raw_style in {"", "default", "voice", "speech", "song", "sing", "chant", "music", "musique"}:
        return persona_style
    style = normalize_style(raw_style)
    return style


def load_persona_manifest() -> dict:
    manifest = {style: values.copy() for style, values in DEFAULT_PERSONA_MANIFEST.items()}
    if not PERSONA_MANIFEST_PATH.exists():
        return manifest
    try:
        raw = json.loads(PERSONA_MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return manifest
    if not isinstance(raw, dict):
        return manifest
    for raw_style, raw_values in raw.items():
        if not isinstance(raw_values, dict):
            continue
        style = normalize_style(raw_style)
        current = manifest.setdefault(style, {})
        for key in ("persona", "voice", "rvc", "index"):
            value = raw_values.get(key)
            if isinstance(value, str) and value.strip():
                current[key] = value.strip()
    return manifest


def env_name(style: str, kind: str) -> str:
    suffixes = {"voice": "VOICE", "rvc": "RVC", "index": "INDEX"}
    suffix = suffixes[kind]
    style_key = style.upper().replace("-", "_")
    for name in (
        f"A11_XTTS_RVC_{style_key}_{suffix}",
        f"A11_VOICE_XTTS_RVC_{style_key}_{suffix}",
        f"A11_XTTS_RVC_DEFAULT_{suffix}",
        f"A11_VOICE_XTTS_RVC_DEFAULT_{suffix}",
    ):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    manifest = load_persona_manifest()
    value = manifest.get(style, {}).get(kind, "")
    if value:
        return value
    if kind == "index":
        return f"{Path(env_name(style, 'rvc')).stem}.index"
    return DEFAULT_PERSONA_MANIFEST[style][kind]


def resolve_data_path(base_dir: Path, name: str) -> Path:
    path = Path(name)
    if path.is_absolute():
        return path
    return base_dir / name


def resolve_index_path(style: str, rvc_path: Path) -> Path:
    candidates = [resolve_data_path(RVCS_DIR, env_name(style, "index"))]
    exact = RVCS_DIR / f"{rvc_path.stem}.index"
    candidates.append(exact)
    candidates.extend(sorted(RVCS_DIR.glob(f"{rvc_path.stem}*.index")))
    seen = set()
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        if candidate.exists():
            return candidate
    return candidates[0]


def resolve_persona_binding(style: str) -> dict:
    manifest = load_persona_manifest()
    entry = manifest.get(style, DEFAULT_PERSONA_MANIFEST[style])
    voice_name = env_name(style, "voice")
    rvc_name = env_name(style, "rvc")
    voice_path = resolve_data_path(VOICES_DIR, voice_name)
    rvc_path = resolve_data_path(RVCS_DIR, rvc_name) if rvc_name else RVCS_DIR / "__no_rvc_model__.pth"
    index_path = resolve_index_path(style, rvc_path)
    return {
        "persona": entry.get("persona", style),
        "voiceName": voice_name,
        "voicePath": voice_path,
        "rvcName": rvc_name,
        "rvcPath": rvc_path,
        "indexName": index_path.name,
        "indexPath": index_path,
        "hasVoice": voice_path.is_file(),
        "hasRvc": rvc_path.is_file(),
        "hasIndex": index_path.is_file(),
    }


STYLE_RVC_TUNING = {
    "a11-official-stern-french": {
        "pitch": 0.0,
        "index_rate": 0.0,
        "rms_mix_rate": 0.5,
        "protect": 0.35,
    },
    "a11-voix-de-lait": {
        "pitch": 0.0,
        "index_rate": 0.0,
        "rms_mix_rate": 0.52,
        "protect": 0.38,
    },
    "djeff-rap": {
        "pitch": -2.0,
        "index_rate": 0.10,
        "rms_mix_rate": 0.35,
        "protect": 0.50,
    },
    "kaen44-official-french-narrator": {
        "pitch": 0.0,
        "index_rate": 0.0,
        "rms_mix_rate": 0.5,
        "protect": 0.35,
    },
    "vivy": {
        "pitch": 0.0,
        "index_rate": 0.28,
        "rms_mix_rate": 0.58,
        "protect": 0.48,
    },
}


def env_float(name: str, fallback: float) -> float:
    try:
        return float(os.environ.get(name, str(fallback)) or fallback)
    except Exception:
        return fallback


def env_bool(name: str, fallback: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return fallback
    return value.strip().lower() not in {"0", "false", "no", "off"}


def probe_audio_duration_seconds(path: Path) -> Optional[float]:
    try:
        if path.suffix.lower() == ".wav":
            with wave.open(str(path), "rb") as handle:
                rate = handle.getframerate()
                frames = handle.getnframes()
                if rate > 0 and frames >= 0:
                    return frames / float(rate)
    except Exception:
        pass

    ffprobe = os.environ.get("A11_FFPROBE_BIN", "ffprobe")
    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1:nk=1",
                str(path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=8,
        )
        if result.returncode != 0:
            return None
        duration = float((result.stdout or "").strip())
        return duration if duration >= 0 else None
    except Exception:
        return None


def round_seconds(value: Optional[float]) -> Optional[float]:
    return round(value, 3) if value is not None else None


def expected_xtts_duration_seconds(text: str, vocal_mode: str = "adaptive") -> float:
    clean_text = " ".join((text or "").split())
    if not clean_text:
        return 0.0

    word_count = len([part for part in clean_text.split(" ") if part])
    char_count = len(clean_text)
    words_per_second = max(1.6, env_float("A11_XTTS_RVC_WORDS_PER_SECOND", 2.55))
    expected = max(word_count / words_per_second, char_count / 18.0, 1.25)
    mode = (vocal_mode or "adaptive").strip().lower()
    if mode in {"slow", "calm", "pose", "posed", "narration"}:
        expected *= 1.18
    elif mode in {"fast", "rapide", "energetic", "energie", "énergie"}:
        expected *= 0.9
    return expected + 0.55


def xtts_duration_window(text: str, vocal_mode: str = "adaptive") -> dict:
    expected = expected_xtts_duration_seconds(text, vocal_mode)
    hard_max = max(8.0, env_float("A11_XTTS_RVC_OUTPUT_HARD_MAX_SECONDS", 90.0))
    target = min(hard_max, max(2.4, expected * 1.35 + 0.65))
    max_allowed = min(
        hard_max,
        max(target + 2.0, expected * 2.05 + 1.8, env_float("A11_XTTS_RVC_OUTPUT_MIN_GUARD_SECONDS", 6.0)),
    )
    return {
        "expectedSeconds": expected,
        "targetSeconds": target,
        "maxAllowedSeconds": max(max_allowed, target),
        "hardMaxSeconds": hard_max,
    }


def prepare_xtts_speaker_wav(source_path: Path, style: str, stamp: int) -> dict:
    source_duration = probe_audio_duration_seconds(source_path)
    max_seconds = max(3.0, env_float("A11_XTTS_RVC_SPEAKER_MAX_SECONDS", 12.0))
    metadata = {
        "enabled": env_bool("A11_XTTS_RVC_PREPARE_SPEAKER_WAV", True),
        "action": "original",
        "path": source_path,
        "sourceSeconds": round_seconds(source_duration),
        "preparedSeconds": None,
        "maxSeconds": max_seconds,
    }
    if not metadata["enabled"]:
        return metadata

    ffmpeg = os.environ.get("A11_FFMPEG_BIN", "ffmpeg")
    prepared_path = OUT_DIR / f"xtts-speaker-{style}-{stamp}.wav"
    audio_filter = (
        "highpass=f=70,"
        "lowpass=f=7600,"
        "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-42dB:"
        "stop_periods=-1:stop_duration=0.35:stop_threshold=-42dB,"
        f"atrim=0:{max_seconds:.3f},"
        "asetpts=N/SR/TB,"
        "loudnorm=I=-20:TP=-2:LRA=9"
    )
    try:
        result = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "24000",
                "-af",
                audio_filter,
                str(prepared_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if result.returncode != 0 or not prepared_path.exists() or prepared_path.stat().st_size <= 0:
            remove_later(prepared_path)
            metadata["error"] = (result.stderr or "speaker_prepare_failed")[-220:]
            return metadata
        prepared_duration = probe_audio_duration_seconds(prepared_path)
        metadata.update(
            {
                "action": "prepared",
                "path": prepared_path,
                "preparedSeconds": round_seconds(prepared_duration),
            }
        )
        return metadata
    except Exception as exc:
        remove_later(prepared_path)
        metadata["error"] = f"{type(exc).__name__}: {exc}"
        return metadata


def constrain_xtts_output_duration(xtts_path: Path, text: str, vocal_mode: str, style: str) -> dict:
    limits = xtts_duration_window(text, vocal_mode)
    original_duration = probe_audio_duration_seconds(xtts_path)
    metadata = {
        "enabled": env_bool("A11_XTTS_RVC_DURATION_GUARD", True),
        "action": "none",
        "originalSeconds": round_seconds(original_duration),
        "expectedSeconds": round_seconds(limits["expectedSeconds"]),
        "targetSeconds": round_seconds(limits["targetSeconds"]),
        "maxAllowedSeconds": round_seconds(limits["maxAllowedSeconds"]),
    }
    if not metadata["enabled"] or original_duration is None:
        return metadata
    if original_duration <= limits["maxAllowedSeconds"]:
        return metadata

    ffmpeg = os.environ.get("A11_FFMPEG_BIN", "ffmpeg")
    target_seconds = max(1.5, min(limits["targetSeconds"], original_duration))
    fade_duration = min(0.28, max(0.12, target_seconds / 8.0))
    fade_start = max(0.1, target_seconds - fade_duration)
    guarded_path = OUT_DIR / f"xtts-guarded-{style}-{int(time.time() * 1000)}.wav"
    audio_filter = (
        "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB,"
        f"atrim=0:{target_seconds:.3f},"
        "asetpts=N/SR/TB,"
        f"afade=t=out:st={fade_start:.3f}:d={fade_duration:.3f},"
        "loudnorm=I=-18:TP=-1.5:LRA=9"
    )
    try:
        result = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(xtts_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "22050",
                "-af",
                audio_filter,
                str(guarded_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if result.returncode != 0 or not guarded_path.exists() or guarded_path.stat().st_size <= 0:
            remove_later(guarded_path)
            metadata["action"] = "guard_failed"
            metadata["error"] = (result.stderr or "duration_guard_failed")[-220:]
            return metadata
        shutil.move(str(guarded_path), str(xtts_path))
        metadata.update(
            {
                "action": "trimmed",
                "finalSeconds": round_seconds(probe_audio_duration_seconds(xtts_path)),
            }
        )
        return metadata
    except Exception as exc:
        remove_later(guarded_path)
        metadata["action"] = "guard_failed"
        metadata["error"] = f"{type(exc).__name__}: {exc}"
        return metadata


def resolve_rvc_tuning(style: str, requested_pitch: Optional[float] = None) -> dict:
    defaults = STYLE_RVC_TUNING.get(style, STYLE_RVC_TUNING["a11-official-stern-french"])
    style_key = style.upper().replace("-", "_")
    pitch = requested_pitch if requested_pitch is not None else env_float(
        f"A11_XTTS_RVC_{style_key}_PITCH",
        defaults["pitch"],
    )
    return {
        "pitch": int(round(float(pitch))),
        "index_rate": max(0.0, min(1.0, env_float(f"A11_XTTS_RVC_{style_key}_INDEX_RATE", defaults["index_rate"]))),
        "rms_mix_rate": max(0.0, min(1.0, env_float(f"A11_XTTS_RVC_{style_key}_RMS_MIX_RATE", defaults["rms_mix_rate"]))),
        "protect": max(0.0, min(0.5, env_float(f"A11_XTTS_RVC_{style_key}_PROTECT", defaults["protect"]))),
    }


def load_trusted_xtts_model():
    original_torch_load = torch.load

    def torch_load_xtts_checkpoint(*args, **kwargs):
        # Coqui XTTS v2 checkpoints store trusted config classes that PyTorch
        # 2.6+ blocks with weights_only=True. Limit the compatibility shim to
        # the local XTTS model load, then restore torch.load immediately.
        kwargs.setdefault("weights_only", False)
        return original_torch_load(*args, **kwargs)

    torch.load = torch_load_xtts_checkpoint
    try:
        return TTS(model_path=str(XTTS_DIR), config_path=str(XTTS_DIR / "config.json")).to(DEVICE)
    finally:
        torch.load = original_torch_load


def get_tts():
    global _tts
    if _tts is None:
        ensure_models()
        torch.set_num_threads(max(1, int(os.environ.get("A11_XTTS_RVC_TORCH_THREADS", "4") or "4")))
        _tts = load_trusted_xtts_model()
    return _tts


class RvcData:
    def __init__(self):
        self.current_model = None
        self.cpt = None
        self.version = None
        self.net_g = None
        self.tgt_sr = None
        self.vc = None

    def load(self, model_path: Path):
        if self.current_model == str(model_path):
            return
        from rvc import get_vc

        self.cpt, self.version, self.net_g, self.tgt_sr, self.vc = get_vc(
            DEVICE,
            _rvc_config.is_half,
            _rvc_config,
            str(model_path),
        )
        self.current_model = str(model_path)


def ensure_rvc_runtime():
    global _hubert_model, _rvc_config, _rvc_data
    if _rvc_config is not None and _hubert_model is not None and _rvc_data is not None:
        return

    with _rvc_runtime_lock:
        if _rvc_config is not None and _hubert_model is not None and _rvc_data is not None:
            return

        from rvc import Config, load_hubert

        ensure_models()
        config = Config(DEVICE, DEVICE != "cpu")
        hubert_model = load_hubert(DEVICE, config.is_half, str(MODELS_DIR / "hubert_base.pt"))
        rvc_data = RvcData()

        _rvc_config = config
        _hubert_model = hubert_model
        _rvc_data = rvc_data


def run_rvc(
    input_path: Path,
    output_path: Path,
    rvc_path: Path,
    pitch: int,
    index_rate: float,
    index_path: Optional[Path] = None,
    rms_mix_rate: float = 0.5,
    protect: float = 0.35,
) -> None:
    ensure_rvc_runtime()
    if _rvc_data is None:
        raise RuntimeError("rvc_runtime_unavailable")

    from rvc import rvc_infer

    _rvc_data.load(rvc_path)
    model_name = rvc_path.stem
    index_path = index_path or RVCS_DIR / f"{model_name}.index"
    rvc_infer(
        index_path=str(index_path) if index_path.exists() and index_rate != 0 else "",
        index_rate=index_rate,
        input_path=str(input_path),
        output_path=str(output_path),
        pitch_change=pitch,
        f0_method="rmvpe",
        cpt=_rvc_data.cpt,
        version=_rvc_data.version,
        net_g=_rvc_data.net_g,
        filter_radius=3,
        tgt_sr=_rvc_data.tgt_sr,
        rms_mix_rate=rms_mix_rate,
        protect=protect,
        crepe_hop_length=0,
        vc=_rvc_data.vc,
        hubert_model=_hubert_model,
    )
    gc.collect()


def remove_later(path: Path) -> None:
    try:
        if path.exists() and OUT_DIR in path.resolve().parents:
            path.unlink()
    except Exception:
        pass


def set_synthesis_state(busy: bool, style: Optional[str] = None) -> None:
    with _synthesis_state_lock:
        _synthesis_state["busy"] = bool(busy)
        _synthesis_state["style"] = style if busy else None
        _synthesis_state["startedAt"] = time.time() if busy else None


def get_synthesis_state() -> dict:
    with _synthesis_state_lock:
        started_at = _synthesis_state.get("startedAt")
        return {
            "busy": bool(_synthesis_state.get("busy")),
            "style": _synthesis_state.get("style"),
            "activeSeconds": round(time.time() - started_at, 3) if started_at else 0,
        }


def check_xtts_runtime_imports() -> dict:
    try:
        from transformers import BeamSearchScorer, LogitsProcessorList, StoppingCriteriaList
        from TTS.tts.layers.xtts.gpt import GPT2InferenceModel

        del BeamSearchScorer, LogitsProcessorList, StoppingCriteriaList
        return {
            "ok": True,
            "xttsGenerate": hasattr(GPT2InferenceModel, "generate"),
            "xttsPrepareGenerationConfig": hasattr(GPT2InferenceModel, "_prepare_generation_config"),
            "xttsGenerationConfigPatched": bool(
                getattr(GPT2InferenceModel, "_a11_generation_config_patched", False)
            ),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": type(exc).__name__,
            "message": str(exc),
        }


class SynthesizeRequest(BaseModel):
    text: str = ""
    persona: str = ""
    surface: str = ""
    voicePersona: str = ""
    voiceStyle: str = ""
    vocalMode: str = "adaptive"
    f0Shift: Optional[float] = None


def synthesize_persona_voice(
    text: str,
    persona: str = "",
    voice_style: str = "",
    vocal_mode: str = "adaptive",
    f0_shift: Optional[float] = None,
    index_rate_override: Optional[float] = None,
    rms_mix_rate_override: Optional[float] = None,
    protect_override: Optional[float] = None,
    use_rvc: bool = True,
    speaker_wav_override: Optional[Path] = None,
    speaker_source: str = "style",
) -> dict:
    clean_text = " ".join((text or "").split())
    if not clean_text:
        raise HTTPException(status_code=400, detail="text_required_for_xtts_rvc")

    style = resolve_style(persona, voice_style)
    binding = resolve_persona_binding(style)
    voice_path = binding["voicePath"]
    rvc_path = binding["rvcPath"]
    rvc_index_path = binding["indexPath"]
    if not voice_path.exists():
        raise HTTPException(status_code=404, detail=f"voice_sample_missing:{voice_path.name}")
    speaker_wav_path = speaker_wav_override if speaker_wav_override and speaker_wav_override.is_file() else voice_path
    speaker_source = "upload" if speaker_wav_override and speaker_wav_override.is_file() else "style"

    with _synthesis_lock:
        set_synthesis_state(True, style)
        try:
            stamp = int(time.time() * 1000)
            xtts_path = OUT_DIR / f"xtts-{style}-{stamp}.wav"
            final_path = OUT_DIR / f"xtts-rvc-{style}-{stamp}.wav"
            speaker_preparation = prepare_xtts_speaker_wav(speaker_wav_path, style, stamp)
            prepared_speaker_path = speaker_preparation.get("path") or speaker_wav_path
            get_tts().tts_to_file(
                text=clean_text,
                speaker_wav=str(prepared_speaker_path),
                language=LANGUAGE,
                file_path=str(xtts_path),
            )
            duration_guard = constrain_xtts_output_duration(xtts_path, clean_text, vocal_mode, style)

            engine = "xtts-reference"
            tuning = resolve_rvc_tuning(style, f0_shift)
            if index_rate_override is not None:
                tuning["index_rate"] = max(0.0, min(1.0, float(index_rate_override)))
            if rms_mix_rate_override is not None:
                tuning["rms_mix_rate"] = max(0.0, min(1.0, float(rms_mix_rate_override)))
            if protect_override is not None:
                tuning["protect"] = max(0.0, min(0.5, float(protect_override)))
            if use_rvc and rvc_path.is_file():
                run_rvc(
                    xtts_path,
                    final_path,
                    rvc_path,
                    tuning["pitch"],
                    tuning["index_rate"],
                    index_path=rvc_index_path if rvc_index_path.is_file() else None,
                    rms_mix_rate=tuning["rms_mix_rate"],
                    protect=tuning["protect"],
                )
                engine = "xtts-rvc"
            else:
                shutil.copyfile(xtts_path, final_path)

            remove_later(xtts_path)
            if prepared_speaker_path != speaker_wav_path:
                remove_later(prepared_speaker_path)
            if not final_path.exists() or final_path.stat().st_size <= 0:
                raise HTTPException(status_code=500, detail="voice_output_missing")
        finally:
            if "prepared_speaker_path" in locals() and prepared_speaker_path != speaker_wav_path:
                remove_later(prepared_speaker_path)
            set_synthesis_state(False)

    return {
        "path": final_path,
        "filename": final_path.name,
        "style": style,
        "engine": engine,
        "rvcPath": rvc_path,
        "rvcIndexPath": rvc_index_path,
        "hasRvc": rvc_path.is_file(),
        "hasRvcIndex": rvc_index_path.is_file(),
        "speakerSource": speaker_source,
        "speakerPath": speaker_wav_path,
        "speakerPreparation": {
            key: (value.name if isinstance(value, Path) else value)
            for key, value in speaker_preparation.items()
            if key != "path"
        },
        "durationGuard": duration_guard,
        "tuning": tuning,
    }


def prepare_generated_wav(source_path: Path, target_path: Path) -> Path:
    """Decode an already-spoken clip (mp3/wav/m4a...) to mono PCM wav.

    Used before true voice conversion so RVC (and the no-model passthrough) can
    consume a clean ElevenLabs/Piper/cloud render. Falls back to the original
    file when ffmpeg is unavailable so conversion never hard-fails on decode.
    """
    if not env_bool("A11_XTTS_RVC_PREPARE_GENERATED_WAV", True):
        return source_path
    ffmpeg = os.environ.get("A11_FFMPEG_BIN", "ffmpeg")
    audio_filter = "highpass=f=60,loudnorm=I=-18:TP=-1.5:LRA=11"
    try:
        result = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "44100",
                "-af",
                audio_filter,
                str(target_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and target_path.exists() and target_path.stat().st_size > 0:
            return target_path
        remove_later(target_path)
    except Exception:
        remove_later(target_path)
    return source_path


def convert_generated_audio(
    generated_path: Path,
    persona: str = "",
    voice_style: str = "",
    vocal_mode: str = "adaptive",
    f0_shift: Optional[float] = None,
    index_rate_override: Optional[float] = None,
    rms_mix_rate_override: Optional[float] = None,
    protect_override: Optional[float] = None,
    use_rvc: bool = True,
    source_engine: str = "",
) -> dict:
    """True audio-to-audio voice conversion of an already-spoken clip.

    Unlike :func:`synthesize_persona_voice`, this never re-runs XTTS: it keeps
    the words and prosody of the supplied clip (typically a clean ElevenLabs
    render) and only re-timbres it through RVC when a persona ``.pth`` model is
    available. When no RVC model exists the clean source is returned as-is, so
    the official voice stays intelligible instead of being replaced by the
    hallucinated phonemes a cold XTTS pass produces.
    """
    if not generated_path.is_file():
        raise HTTPException(status_code=400, detail="generated_audio_required")

    style = resolve_style(persona, voice_style)
    binding = resolve_persona_binding(style)
    rvc_path = binding["rvcPath"]
    rvc_index_path = binding["indexPath"]
    source_label = (source_engine or "").strip().lower() or "audio"

    with _synthesis_lock:
        set_synthesis_state(True, style)
        prepared_source = generated_path
        try:
            stamp = int(time.time() * 1000)
            prepared_target = OUT_DIR / f"convert-src-{style}-{stamp}.wav"
            prepared_source = prepare_generated_wav(generated_path, prepared_target)
            final_path = OUT_DIR / f"convert-{style}-{stamp}.wav"

            tuning = resolve_rvc_tuning(style, f0_shift)
            if index_rate_override is not None:
                tuning["index_rate"] = max(0.0, min(1.0, float(index_rate_override)))
            if rms_mix_rate_override is not None:
                tuning["rms_mix_rate"] = max(0.0, min(1.0, float(rms_mix_rate_override)))
            if protect_override is not None:
                tuning["protect"] = max(0.0, min(0.5, float(protect_override)))

            if use_rvc and rvc_path.is_file():
                run_rvc(
                    prepared_source,
                    final_path,
                    rvc_path,
                    tuning["pitch"],
                    tuning["index_rate"],
                    index_path=rvc_index_path if rvc_index_path.is_file() else None,
                    rms_mix_rate=tuning["rms_mix_rate"],
                    protect=tuning["protect"],
                )
                engine = f"{source_label}-rvc"
            else:
                shutil.copyfile(prepared_source, final_path)
                engine = f"{source_label}-clean"

            if prepared_source != generated_path:
                remove_later(prepared_source)
            if not final_path.exists() or final_path.stat().st_size <= 0:
                raise HTTPException(status_code=500, detail="voice_output_missing")
        finally:
            if prepared_source != generated_path:
                remove_later(prepared_source)
            set_synthesis_state(False)

    return {
        "path": final_path,
        "filename": final_path.name,
        "style": style,
        "engine": engine,
        "pipeline": "convert",
        "sourceEngine": source_label,
        "rvcPath": rvc_path,
        "rvcIndexPath": rvc_index_path,
        "hasRvc": rvc_path.is_file(),
        "hasRvcIndex": rvc_index_path.is_file(),
        "speakerSource": "generated",
        "speakerPath": generated_path,
        "speakerPreparation": {"action": "generated-source", "enabled": True},
        "durationGuard": {"action": "none"},
        "tuning": tuning,
    }


@app.get("/health")
def health():
    voices = sorted(item.name for item in VOICES_DIR.glob("*") if item.is_file())
    rvcs = sorted(item.name for item in RVCS_DIR.glob("*.pth") if item.is_file())
    rvc_indexes = sorted(item.name for item in RVCS_DIR.glob("*.index") if item.is_file())
    styles = {}
    for style in ("a11-official-stern-french", "a11-voix-de-lait", "djeff-rap", "kaen44-official-french-narrator", "vivy"):
        binding = resolve_persona_binding(style)
        styles[style] = {
            "persona": binding["persona"],
            "voice": binding["voiceName"],
            "rvc": binding["rvcName"],
            "index": binding["indexName"],
            "hasVoice": binding["hasVoice"],
            "hasRvc": binding["hasRvc"],
            "hasIndex": binding["hasIndex"],
            "tuning": resolve_rvc_tuning(style),
        }
    return {
        "ok": True,
        "module": "funesterie-xtts-rvc-bridge",
        "device": DEVICE,
        "language": LANGUAGE,
        "runtimeImports": check_xtts_runtime_imports(),
        "personaManifest": str(PERSONA_MANIFEST_PATH),
        "xttsModel": (XTTS_DIR / "model.pth").exists(),
        "voices": voices,
        "rvcModels": rvcs,
        "rvcIndexes": rvc_indexes,
        "styles": styles,
        "synthesis": get_synthesis_state(),
    }


@app.post("/api/voice/convert")
async def convert_voice(
    background_tasks: BackgroundTasks,
    generated: Optional[UploadFile] = File(default=None),
    reference: Optional[UploadFile] = File(default=None),
    text: str = Form(default=""),
    persona: str = Form(default=""),
    voiceStyle: str = Form(default=""),
    mode: str = Form(default="adaptive"),
    f0Shift: Optional[float] = Form(default=None),
    indexRate: Optional[float] = Form(default=None),
    rmsMixRate: Optional[float] = Form(default=None),
    protect: Optional[float] = Form(default=None),
    useRvc: bool = Form(default=True),
    sourceEngine: str = Form(default=""),
    pipeline: str = Form(default="auto"),
    resynthesize: bool = Form(default=False),
):
    # Default behaviour: when an already-spoken clip is supplied, convert *that
    # audio* (true audio-to-audio RVC, or clean passthrough when no model). Only
    # fall back to a cold XTTS re-synthesis from text when explicitly forced or
    # when no clip is provided. This is what keeps an ElevenLabs render clean
    # instead of being replaced by hallucinated phonemes.
    pipeline_mode = (pipeline or "auto").strip().lower()
    force_resynthesize = bool(resynthesize) or pipeline_mode in {"xtts", "synthesize", "resynthesize"}

    generated_path = None
    uploaded_reference_path = None
    try:
        if generated is not None:
            generated_bytes = await generated.read()
            if generated_bytes and not force_resynthesize:
                suffix = Path(generated.filename or "generated.wav").suffix.lower()
                if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".mp4", ".webm"}:
                    suffix = ".wav"
                generated_path = OUT_DIR / f"convert-input-{int(time.time() * 1000)}{suffix}"
                generated_path.write_bytes(generated_bytes)

        if reference is not None:
            reference_bytes = await reference.read()
            if not reference_bytes and generated_path is None:
                raise HTTPException(status_code=400, detail="reference_audio_empty")
            if reference_bytes:
                suffix = Path(reference.filename or "reference.wav").suffix.lower()
                if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
                    suffix = ".wav"
                uploaded_reference_path = OUT_DIR / f"uploaded-reference-{int(time.time() * 1000)}{suffix}"
                uploaded_reference_path.write_bytes(reference_bytes)

        if generated_path is not None:
            result = convert_generated_audio(
                generated_path,
                persona=persona,
                voice_style=voiceStyle,
                vocal_mode=mode,
                f0_shift=f0Shift,
                index_rate_override=indexRate,
                rms_mix_rate_override=rmsMixRate,
                protect_override=protect,
                use_rvc=useRvc,
                source_engine=sourceEngine,
            )
        else:
            result = synthesize_persona_voice(
                text,
                persona=persona,
                voice_style=voiceStyle,
                f0_shift=f0Shift,
                vocal_mode=mode,
                index_rate_override=indexRate,
                rms_mix_rate_override=rmsMixRate,
                protect_override=protect,
                use_rvc=useRvc,
                speaker_wav_override=uploaded_reference_path,
            )
    finally:
        if generated_path is not None:
            remove_later(generated_path)
        if uploaded_reference_path is not None:
            remove_later(uploaded_reference_path)
    final_path = result["path"]
    rvc_path = result["rvcPath"]
    rvc_index_path = result["rvcIndexPath"]

    background_tasks.add_task(remove_later, final_path)
    return FileResponse(
        final_path,
        media_type="audio/wav",
        filename=final_path.name,
        headers={
            "X-A11-Voice-Engine": result["engine"],
            "X-A11-Voice-Style": result["style"],
            "X-A11-Voice-Pipeline": result.get("pipeline", "synthesize"),
            "X-A11-Voice-Source-Engine": result.get("sourceEngine", ""),
            "X-A11-Reference-Source": result.get("speakerSource", "style"),
            "X-A11-Speaker-Wav": result.get("speakerPath", Path()).name if result.get("speakerPath") else "",
            "X-A11-Speaker-Preparation": result.get("speakerPreparation", {}).get("action", ""),
            "X-A11-XTTS-Duration-Guard": result.get("durationGuard", {}).get("action", ""),
            "X-A11-RVC-Model": rvc_path.name if rvc_path.is_file() else "",
            "X-A11-RVC-Index": rvc_index_path.name if rvc_index_path.is_file() else "",
        },
        background=background_tasks,
    )


@app.post("/api/voice/synthesize")
def synthesize_voice(req: SynthesizeRequest):
    persona = req.voicePersona or req.persona or req.surface
    result = synthesize_persona_voice(
        req.text,
        persona=persona,
        voice_style=req.voiceStyle,
        vocal_mode=req.vocalMode,
        f0_shift=req.f0Shift,
    )
    rvc_path = result["rvcPath"]
    rvc_index_path = result["rvcIndexPath"]
    audio_url = f"/out/{result['filename']}"
    return {
        "ok": True,
        "module": "funesterie-xtts-rvc-bridge",
        "provider": "xtts-rvc",
        "engine": result["engine"],
        "via": "funesterie-xtts-rvc-bridge",
        "voiceStyle": result["style"],
        "audio_url": audio_url,
        "audioUrl": audio_url,
        "providerCapabilities": {
            "referenceVoice": True,
            "styleVoice": True,
            "rvcModel": result["hasRvc"],
            "rvcIndex": result["hasRvcIndex"],
            "referenceSource": result.get("speakerSource", "style"),
            "speakerPreparation": result.get("speakerPreparation"),
            "durationGuard": result.get("durationGuard"),
        },
        "voiceConversion": {
            "ok": True,
            "provider": "xtts-rvc",
            "engine": result["engine"],
            "voiceStyle": result["style"],
            "referenceSource": result.get("speakerSource", "style"),
            "speakerPreparation": result.get("speakerPreparation"),
            "durationGuard": result.get("durationGuard"),
            "attemptedEngines": [result["engine"]],
            "rvcModel": rvc_path.name if rvc_path.is_file() else "",
            "rvcIndex": rvc_index_path.name if rvc_index_path.is_file() else "",
            "tuning": result.get("tuning"),
        },
    }


@app.get("/out/{filename}")
def get_output(filename: str):
    safe_name = Path(filename).name
    target = OUT_DIR / safe_name
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="voice_output_not_found")
    return FileResponse(target, media_type="audio/wav", filename=safe_name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
