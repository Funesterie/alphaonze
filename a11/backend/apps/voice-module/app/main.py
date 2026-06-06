import os
import json
import re
import shutil
import subprocess
import time
import wave
from pathlib import Path
from typing import Any, Literal, Optional
from urllib.parse import quote, urljoin

import requests
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

try:
    from . import prime_spiral_morph
except ImportError:
    import prime_spiral_morph


ROOT = Path("/app")
OUT_DIR = Path(os.environ.get("A11_VOICE_OUT_DIR", ROOT / "out"))
PIPER_BIN = Path(os.environ.get("A11_PIPER_BIN", ROOT / "piper" / "piper"))
PIPER_MODEL = Path(os.environ.get("A11_VOICE_MODEL", ROOT / "models" / "fr_FR-siwis-medium.onnx"))
PIPER_CONFIG = Path(os.environ.get("A11_VOICE_CONFIG", f"{PIPER_MODEL}.json"))
ESPEAK_DATA = Path(os.environ.get("A11_ESPEAK_DATA", ROOT / "piper" / "espeak-ng-data"))
CONVERSION_PROVIDER = os.environ.get("A11_VOICE_CONVERTER_PROVIDER", "ffmpeg").strip().lower() or "ffmpeg"
DEFAULT_CONVERSION_STRENGTH = float(os.environ.get("A11_VOICE_CONVERSION_STRENGTH", "0.45") or "0.45")
DEFAULT_F0_SHIFT = float(os.environ.get("A11_VOICE_DEFAULT_F0_SHIFT", "-1.5") or "-1.5")
A11_CONVERSION_STRENGTH = float(os.environ.get("A11_A11_VOICE_CONVERSION_STRENGTH", "0.62") or "0.62")
A11_DEFAULT_F0_SHIFT = float(os.environ.get("A11_A11_VOICE_DEFAULT_F0_SHIFT", "-2.4") or "-2.4")
VIVY_CONVERSION_STRENGTH = float(os.environ.get("A11_VIVY_VOICE_CONVERSION_STRENGTH", "0.28") or "0.28")
VIVY_DEFAULT_F0_SHIFT = float(os.environ.get("A11_VIVY_VOICE_DEFAULT_F0_SHIFT", "0") or "0")
XTTS_RVC_URL = (
    os.environ.get("A11_VOICE_XTTS_RVC_URL")
    or os.environ.get("A11_XTTS_RVC_URL")
    or ""
).strip()
XTTS_RVC_PROTOCOL = os.environ.get("A11_VOICE_XTTS_RVC_PROTOCOL", "a11").strip().lower() or "a11"
XTTS_RVC_TIMEOUT = float(os.environ.get("A11_VOICE_XTTS_RVC_TIMEOUT_SECONDS", "240") or "240")
XTTS_RVC_LANGUAGE = os.environ.get("A11_VOICE_XTTS_RVC_LANGUAGE", "fr").strip() or "fr"
XTTS_RVC_INDEX_RATE = float(os.environ.get("A11_VOICE_XTTS_RVC_INDEX_RATE", "0.75") or "0.75")
XTTS_RVC_PITCH = float(os.environ.get("A11_VOICE_XTTS_RVC_PITCH", "0") or "0")
XTTS_RVC_FALLBACK_TO_FFMPEG = os.environ.get("A11_VOICE_XTTS_RVC_FALLBACK", "true").strip().lower() not in {"0", "false", "no", "off"}

OUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="A11 Voice Module", version="0.1.0")

OFFICIAL_PERSONAS = {"a11", "kaen44", "k44", "vivy"}


def split_path_env(value: str) -> list[Path]:
    return [Path(item.strip()) for item in re.split(r"[;|]+", value or "") if item.strip()]


def voice_library_dirs() -> list[Path]:
    configured = (
        os.environ.get("A11_VOICE_REFERENCE_LIBRARY_DIRS")
        or os.environ.get("A11_VOICE_REFERENCE_LIBRARY_DIR")
        or os.environ.get("A11_VOICE_LIBRARY_DIRS")
        or os.environ.get("A11_VOICE_LIBRARY_DIR")
        or ""
    )
    here = Path(__file__).resolve()
    dirs = split_path_env(configured)
    repo_runtime = here.parents[3] / "runtime" / "voice-library" if len(here.parents) > 3 else None
    dirs.extend([
        Path(os.environ.get("A11_RUNTIME_ROOT", ROOT / "runtime")) / "voice-library",
        ROOT / "runtime" / "voice-library",
        Path.cwd() / "runtime" / "voice-library",
    ])
    if repo_runtime is not None:
        dirs.append(repo_runtime)
    seen = set()
    unique = []
    for item in dirs:
        key = str(item)
        if key and key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def normalize_persona(value: Optional[str]) -> str:
    raw = re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())
    if raw in {"kaen44", "k44", "kaen"}:
        return "kaen44"
    if raw in {"vivy", "vivi"}:
        return "vivy"
    if raw in {"a11", "alpha11", "alphaonze", "aonze"}:
        return "a11"
    return raw


def preferred_reference_names(persona: str, mode: str) -> list[str]:
    if persona == "a11":
        return [
            "a11-official-stern-french.wav",
            "a11-official-stern-french-context.wav",
            "a11-terminator.wav",
            "a11-terminator-context.wav",
        ]
    if persona == "kaen44":
        return [
            "kaen44-official-french-narrator.wav",
            "kaen44-donna.wav",
            "kaen44-donna-extra.wav",
            "kaen44-donna-context.wav",
        ]
    if persona == "vivy":
        if mode == "sing":
            return ["vivy.wav", "vivy-song-context.wav", "vivy-pv-context.wav", "vivy-adaptive.wav"]
        return ["vivy.wav", "vivy-adaptive.wav", "vivy-pv-context.wav", "vivy-song-context.wav"]
    return []


def find_persona_reference(persona: str, mode: str) -> Optional[Path]:
    for directory in voice_library_dirs():
        for name in preferred_reference_names(persona, mode):
            candidate = directory / name
            if candidate.exists() and candidate.is_file() and candidate.stat().st_size > 0:
                return candidate
    return None


def wants_persona_voice(req: "SynthesizeRequest", persona: str) -> bool:
    if persona not in {"a11", "kaen44", "vivy"}:
        return False
    return bool(
        req.voiceReferenceRequired
        or req.referenceVoiceRequired
        or req.useDefaultVoiceReference
        or req.defaultVoiceReference
        or req.voiceStyle
        or req.voicePersona
    )


def is_generated_audio(path: Path) -> bool:
    try:
        resolved = path.resolve()
        out_root = OUT_DIR.resolve()
        return (
            out_root in resolved.parents
            and resolved.suffix.lower() == ".wav"
            and resolved.name.startswith(("a11-voice-", "a11-converted-", "generated-", "reference-"))
        )
    except Exception:
        return False


def delete_generated_audio(path: Path) -> None:
    try:
        if is_generated_audio(path) and path.exists():
            path.unlink()
    except Exception:
        pass


def prune_old_audio(max_age_seconds: int = 600) -> None:
    now = time.time()
    try:
        for item in OUT_DIR.iterdir():
            if is_generated_audio(item) and now - item.stat().st_mtime > max_age_seconds:
                delete_generated_audio(item)
    except Exception:
        pass


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4096)
    voice: Optional[str] = None
    model: Optional[str] = None
    piperVoice: Optional[str] = None
    piperModel: Optional[str] = None
    persona: Optional[str] = None
    voicePersona: Optional[str] = None
    voiceStyle: Optional[str] = None
    surface: Optional[str] = None
    vocalMode: Literal["speech", "adaptive", "sing"] = "speech"
    lengthScale: Optional[float] = Field(default=None, ge=0.6, le=2.2)
    noiseScale: Optional[float] = Field(default=None, ge=0.1, le=1.4)
    noiseW: Optional[float] = Field(default=None, ge=0.1, le=1.4)
    engine: Optional[str] = None
    strength: Optional[float] = Field(default=None, ge=0.05, le=1.0)
    f0Shift: Optional[float] = Field(default=None, ge=-12.0, le=12.0)
    voiceReferenceRequired: bool = False
    referenceVoiceRequired: bool = False
    useDefaultVoiceReference: bool = False
    defaultVoiceReference: bool = False


class PrimeSpiralControlRequest(BaseModel):
    length: int = Field(default=512, ge=1, le=4096)
    bins: int = Field(default=128, ge=1, le=4096)
    mode: Literal[
        "phi_j_spiral",
        "riemann_chirp",
        "modular_grid",
        "gap_law",
        "resonance",
        "op_symmetry",
        "op_closure",
        "op_algebra",
        "prime_dimensions",
        "hybrid",
    ] = "hybrid"
    phi: float = Field(default=prime_spiral_morph.PHI, gt=0, le=16)
    j: float = Field(default=1.0, gt=0, le=16)
    orientation: Literal["right", "left", "mirror", "mirror_inverted"] = "right"
    maxDb: float = Field(default=3.0, ge=0.0, le=12.0)
    primeBoostDb: float = Field(default=1.0, ge=0.0, le=6.0)
    weightStrength: float = Field(default=0.25, ge=0.0, le=1.0)
    includeFeatures: bool = False


def clean_text(value: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    text = text.replace("A11", "A onze")
    return text


def shape_for_mode(text: str, mode: str) -> str:
    if mode == "sing":
        return re.sub(r"([.!?])\s+", r"\1\n", text)
    return text


def piper_params(mode: str, req: SynthesizeRequest) -> dict:
    if mode == "sing":
        return {
            "length_scale": req.lengthScale or 1.28,
            "noise_scale": req.noiseScale or 0.58,
            "noise_w": req.noiseW or 0.72,
            "sentence_silence": 0.28,
        }
    if mode == "adaptive":
        return {
            "length_scale": req.lengthScale or 1.08,
            "noise_scale": req.noiseScale or 0.62,
            "noise_w": req.noiseW or 0.78,
            "sentence_silence": 0.22,
        }
    return {
        "length_scale": req.lengthScale or 1.0,
        "noise_scale": req.noiseScale or 0.667,
        "noise_w": req.noiseW or 0.8,
        "sentence_silence": 0.2,
    }


def piper_model_dirs() -> list[Path]:
    configured = (
        os.environ.get("A11_PIPER_MODEL_DIRS")
        or os.environ.get("A11_PIPER_MODEL_DIR")
        or os.environ.get("PIPER_MODEL_DIRS")
        or os.environ.get("PIPER_MODEL_DIR")
        or ""
    )
    dirs = split_path_env(configured)
    dirs.extend([
        Path("/app/extra-models"),
        PIPER_MODEL.parent,
        ROOT / "models",
    ])
    seen = set()
    unique = []
    for item in dirs:
        key = str(item)
        if key and key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def normalize_piper_model_name(value: Optional[str]) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    name = Path(raw).name
    name = re.sub(r"[^A-Za-z0-9_.-]+", "", name)
    if not name:
        return ""
    if not name.endswith(".onnx"):
        name = f"{name}.onnx"
    return name


def resolve_piper_model(req: SynthesizeRequest) -> tuple[Path, Path]:
    requested = (
        req.piperModel
        or req.piperVoice
        or req.model
        or req.voice
        or ""
    )
    candidates: list[Path] = []
    requested_raw = str(requested or "").strip()
    if requested_raw:
        requested_path = Path(requested_raw)
        if requested_path.is_absolute():
            candidates.append(requested_path)
        requested_name = normalize_piper_model_name(requested_raw)
        if requested_name:
            for directory in piper_model_dirs():
                candidates.append(directory / requested_name)

    candidates.append(PIPER_MODEL)
    for model_path in candidates:
        try:
            if model_path.exists() and model_path.is_file():
                config_path = Path(f"{model_path}.json")
                legacy_config_path = model_path.with_suffix(".onnx.json")
                if config_path.exists():
                    return model_path, config_path
                if legacy_config_path.exists():
                    return model_path, legacy_config_path
                return model_path, config_path
        except Exception:
            continue
    return PIPER_MODEL, PIPER_CONFIG


def wav_duration_ms(path: Path) -> Optional[int]:
    try:
        with wave.open(str(path), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            if rate:
                return round((frames / rate) * 1000)
    except Exception:
        return None
    return None


def clamp_float(value: Optional[float], fallback: float, low: float, high: float) -> float:
    try:
        parsed = float(value if value is not None else fallback)
    except Exception:
        parsed = fallback
    return max(low, min(high, parsed))


def default_conversion_strength_for(reference_style: str, persona: str = "") -> float:
    if normalize_persona(persona) == "a11" or reference_style in {"a11-official-stern-french", "a11"}:
        return A11_CONVERSION_STRENGTH
    if normalize_persona(persona or reference_style) == "vivy" or reference_style == "vivy":
        return VIVY_CONVERSION_STRENGTH
    return DEFAULT_CONVERSION_STRENGTH


def default_f0_shift_for(reference_style: str, persona: str = "") -> float:
    if normalize_persona(persona) == "a11" or reference_style in {"a11-official-stern-french", "a11"}:
        return A11_DEFAULT_F0_SHIFT
    if normalize_persona(persona or reference_style) == "vivy" or reference_style == "vivy":
        return VIVY_DEFAULT_F0_SHIFT
    return DEFAULT_F0_SHIFT


def wav_profile(path: Path) -> dict:
    try:
        with wave.open(str(path), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate() or 1
            channels = wav.getnchannels()
            width = wav.getsampwidth()
            duration_ms = round((frames / rate) * 1000)
            raw = wav.readframes(min(frames, rate * 8))
            rms = 0.0
            peak = 0.0
            inspected = 0
            if width == 2 and raw:
                for index in range(0, len(raw) - 1, 2):
                    sample = int.from_bytes(raw[index:index + 2], "little", signed=True) / 32768
                    value = abs(sample)
                    peak = max(peak, value)
                    rms += sample * sample
                    inspected += 1
                if inspected:
                    rms = (rms / inspected) ** 0.5
            return {
                "ok": True,
                "durationMs": duration_ms,
                "sampleRate": rate,
                "channels": channels,
                "sampleWidth": width,
                "rms": round(rms, 5),
                "peak": round(peak, 5),
            }
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:160]}


def safe_upload_name(upload: UploadFile, fallback: str) -> str:
    name = Path(upload.filename or fallback).name
    if not re.search(r"\.(wav|wave|mp3|ogg|webm|m4a|mp4|flac)$", name, re.I):
        name = f"{fallback}.wav"
    return name


async def save_upload(upload: UploadFile, prefix: str) -> Path:
    if not upload:
        raise HTTPException(status_code=400, detail=f"missing_{prefix}_audio")
    filename = safe_upload_name(upload, prefix)
    out_path = OUT_DIR / f"{prefix}-{int(time.time() * 1000)}-{filename}"
    with out_path.open("wb") as handle:
        shutil.copyfileobj(upload.file, handle)
    if not out_path.exists() or out_path.stat().st_size <= 0:
        raise HTTPException(status_code=400, detail=f"empty_{prefix}_audio")
    return out_path


def atempo_chain(speed: float) -> str:
    value = max(0.25, min(4.0, speed))
    parts = []
    while value > 2.0:
        parts.append("atempo=2.0")
        value /= 2.0
    while value < 0.5:
        parts.append("atempo=0.5")
        value /= 0.5
    parts.append(f"atempo={value:.5f}")
    return ",".join(parts)


def infer_reference_style(reference_file: Optional[Path]) -> str:
    key = str(reference_file.name if reference_file else "").lower()
    if "a11-official-stern-french" in key or ("a11" in key and "official" in key):
        return "a11-official-stern-french"
    if "kaen44-official-french-narrator" in key or (("kaen44" in key or "k44" in key) and "official" in key):
        return "kaen44-official-french-narrator"
    if "terminator" in key or "a11" in key:
        return "terminator"
    if "donna" in key or "kaen44" in key or "k44" in key:
        return "kaen44-official-french-narrator"
    if "vivy" in key:
        return "vivy"
    return ""


def parse_mapping_env(name: str) -> dict:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(key).lower(): str(value) for key, value in parsed.items() if value}
    except Exception:
        pass
    return {}


def provider_chain(engine: str) -> list[str]:
    raw = CONVERSION_PROVIDER if engine in {"", "auto", "default"} else engine
    values = [item.strip().lower() for item in re.split(r"[,;|]+", raw or "") if item.strip()]
    if not values:
        values = ["ffmpeg-morph"]
    if engine in {"", "auto", "default"} and XTTS_RVC_FALLBACK_TO_FFMPEG and not any(item in {"ffmpeg", "ffmpeg-morph", "morph"} for item in values):
        values.append("ffmpeg-morph")
    return values


def is_xtts_rvc_provider(provider: str) -> bool:
    return provider in {"xtts", "xtts-rvc", "xtts-rvc-ui", "rvc", "rvc-bridge", "external", "external-rvc"}


def xtts_rvc_env_name(reference_style: str, kind: Literal["voice", "rvc"]) -> str:
    style = (reference_style or "default").upper().replace("-", "_")
    if kind == "voice":
        candidates = [
            f"A11_VOICE_XTTS_RVC_{style}_VOICE",
            f"A11_XTTS_RVC_{style}_VOICE",
            "A11_VOICE_XTTS_RVC_DEFAULT_VOICE",
        ]
    else:
        candidates = [
            f"A11_VOICE_XTTS_RVC_{style}_RVC",
            f"A11_XTTS_RVC_{style}_RVC",
            "A11_VOICE_XTTS_RVC_DEFAULT_RVC",
        ]
    for name in candidates:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    default_voice = {
        "kaen44-official-french-narrator": "kaen44-official-french-narrator.wav",
        "terminator": "a11-terminator.wav",
        "donna": "kaen44-donna.wav",
        "vivy": "vivy.wav",
    }
    default_rvc = {
        "kaen44-official-french-narrator": "",
        "terminator": "a11-terminator.pth",
        "donna": "kaen44-donna.pth",
        "vivy": "vivy.pth",
    }
    return (default_voice if kind == "voice" else default_rvc).get(reference_style or "", "")


def find_audio_url(value: Any, base_url: str) -> Optional[str]:
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        if re.search(r"\.(wav|mp3|ogg|flac|m4a|webm)(\?|$)", candidate, re.I) or candidate.startswith(("/file=", "file=")):
            if candidate.startswith("http://") or candidate.startswith("https://"):
                return candidate
            if candidate.startswith("/"):
                return urljoin(base_url.rstrip("/") + "/", candidate.lstrip("/"))
            return urljoin(base_url.rstrip("/") + "/", f"file={quote(candidate)}")
        return None
    if isinstance(value, dict):
        for key in ("url", "audio_url", "audioUrl", "path", "name", "file"):
            found = find_audio_url(value.get(key), base_url)
            if found:
                return found
        for item in value.values():
            found = find_audio_url(item, base_url)
            if found:
                return found
    if isinstance(value, list):
        for item in reversed(value):
            found = find_audio_url(item, base_url)
            if found:
                return found
    return None


def download_audio(url: str, out_file: Path) -> None:
    response = requests.get(url, timeout=XTTS_RVC_TIMEOUT, stream=True)
    response.raise_for_status()
    with out_file.open("wb") as handle:
        for chunk in response.iter_content(chunk_size=1024 * 256):
            if chunk:
                handle.write(chunk)
    if not out_file.exists() or out_file.stat().st_size <= 0:
        raise RuntimeError("xtts_rvc_empty_download")


def run_xtts_rvc_a11_api(
    generated_file: Path,
    reference_file: Optional[Path],
    out_file: Path,
    mode: str,
    text: str,
    strength: float,
    f0_shift: Optional[float],
    reference_style: str,
) -> dict:
    endpoint = os.environ.get("A11_VOICE_XTTS_RVC_ENDPOINT", "/api/voice/convert").strip() or "/api/voice/convert"
    url = urljoin(XTTS_RVC_URL.rstrip("/") + "/", endpoint.lstrip("/"))
    files = {"generated": ("generated.wav", generated_file.open("rb"), "audio/wav")}
    try:
        if reference_file:
            files["reference"] = (reference_file.name, reference_file.open("rb"), "audio/wav")
        data = {
            "text": text,
            "mode": mode,
            "engine": "xtts-rvc",
            "strength": str(strength),
            "voiceStyle": reference_style,
        }
        if f0_shift is not None:
            data["f0Shift"] = str(f0_shift)
        response = requests.post(url, files=files, data=data, timeout=XTTS_RVC_TIMEOUT)
        content_type = response.headers.get("content-type", "")
        response.raise_for_status()
        if content_type.startswith("audio/"):
            out_file.write_bytes(response.content)
            rvc_model = response.headers.get("x-a11-rvc-model", "")
            rvc_index = response.headers.get("x-a11-rvc-index", "")
            voice_engine = response.headers.get("x-a11-voice-engine", "")
        else:
            parsed = response.json()
            remote_audio = find_audio_url(parsed, XTTS_RVC_URL)
            if not remote_audio:
                raise RuntimeError("xtts_rvc_missing_audio_url")
            download_audio(remote_audio, out_file)
            voice_conversion = parsed.get("voiceConversion") if isinstance(parsed, dict) else {}
            capabilities = parsed.get("providerCapabilities") if isinstance(parsed, dict) else {}
            rvc_model = (voice_conversion or {}).get("rvcModel") or (capabilities or {}).get("rvcModel") or ""
            rvc_index = (voice_conversion or {}).get("rvcIndex") or (capabilities or {}).get("rvcIndex") or ""
            voice_engine = (voice_conversion or {}).get("engine") or parsed.get("engine") or ""
    finally:
        for handle in files.values():
            try:
                handle[1].close()
            except Exception:
                pass

    return {
        "provider": "xtts-rvc",
        "engine": voice_engine or "xtts-rvc-api",
        "voiceStyle": reference_style or None,
        "rvcModel": rvc_model or None,
        "rvcIndex": rvc_index or None,
        "externalUrlConfigured": True,
    }


def run_xtts_rvc_gradio(
    out_file: Path,
    mode: str,
    text: str,
    f0_shift: Optional[float],
    reference_style: str,
) -> dict:
    if not text:
        raise RuntimeError("xtts_rvc_text_required")
    endpoint = os.environ.get("A11_VOICE_XTTS_RVC_GRADIO_ENDPOINT", "/run/predict").strip() or "/run/predict"
    url = urljoin(XTTS_RVC_URL.rstrip("/") + "/", endpoint.lstrip("/"))
    voice_name = xtts_rvc_env_name(reference_style, "voice")
    rvc_name = xtts_rvc_env_name(reference_style, "rvc")
    if not voice_name:
        raise RuntimeError("xtts_rvc_voice_name_missing")
    if not rvc_name:
        raise RuntimeError("xtts_rvc_model_name_missing")
    pitch = f0_shift if f0_shift is not None else XTTS_RVC_PITCH
    payload = {
        "data": [
            rvc_name,
            voice_name,
            text,
            pitch,
            XTTS_RVC_INDEX_RATE,
            XTTS_RVC_LANGUAGE,
        ]
    }
    response = requests.post(url, json=payload, timeout=XTTS_RVC_TIMEOUT)
    response.raise_for_status()
    parsed = response.json()
    remote_audio = find_audio_url(parsed, XTTS_RVC_URL)
    if not remote_audio:
        raise RuntimeError("xtts_rvc_gradio_missing_audio_url")
    download_audio(remote_audio, out_file)
    return {
        "provider": "xtts-rvc",
        "engine": "xtts-rvc-ui-gradio",
        "voiceStyle": reference_style or None,
        "voiceSample": voice_name,
        "rvcModel": rvc_name,
        "language": XTTS_RVC_LANGUAGE,
        "indexRate": XTTS_RVC_INDEX_RATE,
    }


def run_xtts_rvc(
    generated_file: Path,
    reference_file: Optional[Path],
    out_file: Path,
    mode: str,
    text: str,
    strength: float,
    f0_shift: Optional[float],
) -> dict:
    if not XTTS_RVC_URL:
        raise RuntimeError("xtts_rvc_url_missing")
    reference_style = infer_reference_style(reference_file)
    protocol = XTTS_RVC_PROTOCOL
    if protocol in {"gradio", "xtts-rvc-ui"}:
        return run_xtts_rvc_gradio(out_file, mode, text, f0_shift, reference_style)
    return run_xtts_rvc_a11_api(generated_file, reference_file, out_file, mode, text, strength, f0_shift, reference_style)


def ffmpeg_morph_filter(mode: str, strength: float, f0_shift: Optional[float], generated_profile: dict, reference_profile: dict, reference_style: str = "") -> str:
    sample_rate = int(generated_profile.get("sampleRate") or 22050)
    mode_shift = -0.6 if mode == "adaptive" else 0.0
    if mode == "sing":
        mode_shift = 0.8
    if reference_style == "terminator":
        strength = max(strength, 0.84)
        default_shift = -5.8 if mode != "sing" else -3.2
    elif reference_style == "vivy":
        strength = min(strength, 0.38)
        default_shift = VIVY_DEFAULT_F0_SHIFT + (0.15 if mode == "sing" else 0.0)
    else:
        default_shift = DEFAULT_F0_SHIFT + mode_shift
    shift = clamp_float(f0_shift, default_shift, -12.0, 12.0) * strength
    pitch_ratio = 2 ** (shift / 12)
    filters = []
    if abs(pitch_ratio - 1.0) > 0.01:
        filters.append(f"asetrate={max(8000, int(sample_rate * pitch_ratio))}")
        filters.append(f"aresample={sample_rate}")
        filters.append(atempo_chain(1 / pitch_ratio))

    generated_rms = float(generated_profile.get("rms") or 0)
    reference_rms = float(reference_profile.get("rms") or 0)
    if generated_rms > 0 and reference_rms > 0:
        volume = max(0.55, min(1.8, (reference_rms / generated_rms) ** min(1.0, strength)))
        filters.append(f"volume={volume:.4f}")

    if reference_style == "terminator":
        filters.extend([
            "highpass=f=90",
            "lowpass=f=4200",
            "acrusher=bits=10:mode=log:aa=1",
            "aecho=0.72:0.82:42|86:0.16|0.08",
            "chorus=0.55:0.8:45|58:0.20|0.16:0.25|0.18:2|2.6",
            "aphaser=in_gain=0.65:out_gain=0.74:delay=2:decay=0.35:speed=0.35:type=t",
        ])

    filters.extend([
        "acompressor=threshold=-18dB:ratio=2.4:attack=8:release=140",
        "loudnorm=I=-16:LRA=10:TP=-1.5",
    ])
    return ",".join(filters)


def run_ffmpeg_morph(generated_file: Path, reference_file: Optional[Path], out_file: Path, mode: str, strength: float, f0_shift: Optional[float]) -> dict:
    generated_profile = wav_profile(generated_file)
    reference_profile = wav_profile(reference_file) if reference_file else {}
    reference_style = infer_reference_style(reference_file)
    filter_graph = ffmpeg_morph_filter(mode, strength, f0_shift, generated_profile, reference_profile, reference_style)
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(generated_file),
            "-af",
            filter_graph,
            "-ar",
            "22050",
            "-ac",
            "1",
            str(out_file),
        ],
        capture_output=True,
        text=True,
        timeout=90,
    )
    if proc.returncode != 0 or not out_file.exists():
        details = (proc.stderr or proc.stdout or "").strip()[:800]
        raise RuntimeError(f"ffmpeg_morph_failed:{details}")
    return {
        "provider": "ffmpeg-morph",
        "filter": filter_graph,
        "voiceStyle": reference_style or None,
        "generatedProfile": generated_profile,
        "referenceProfile": reference_profile or None,
    }


def run_piper(text: str, out_file: Path, req: SynthesizeRequest) -> dict:
    model_path, config_path = resolve_piper_model(req)
    if not PIPER_BIN.exists():
        raise RuntimeError("piper_missing")
    if not model_path.exists():
        raise RuntimeError("piper_model_missing")

    params = piper_params(req.vocalMode, req)
    args = [
        str(PIPER_BIN),
        "--model",
        str(model_path),
        "--config",
        str(config_path),
        "--output_file",
        str(out_file),
        "--length_scale",
        str(params["length_scale"]),
        "--noise_scale",
        str(params["noise_scale"]),
        "--noise_w",
        str(params["noise_w"]),
        "--sentence_silence",
        str(params["sentence_silence"]),
        "--quiet",
    ]
    if ESPEAK_DATA.exists():
        args.extend(["--espeak_data", str(ESPEAK_DATA)])

    proc = subprocess.run(
        args,
        input=text,
        text=True,
        capture_output=True,
        timeout=60,
    )
    if proc.returncode != 0 or not out_file.exists():
        details = (proc.stderr or proc.stdout or "").strip()[:800]
        raise RuntimeError(f"piper_failed:{details}")
    return {"via": "piper", "params": params, "model": model_path.name}


def run_espeak(text: str, out_file: Path, req: SynthesizeRequest) -> dict:
    speed = 118 if req.vocalMode == "sing" else 155
    pitch = 76 if req.vocalMode == "sing" else 52
    amplitude = 150 if req.vocalMode == "sing" else 125
    proc = subprocess.run(
        [
            "espeak-ng",
            "-v",
            "fr-fr",
            "-s",
            str(speed),
            "-p",
            str(pitch),
            "-a",
            str(amplitude),
            "-w",
            str(out_file),
            text,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0 or not out_file.exists():
        details = (proc.stderr or proc.stdout or "").strip()[:800]
        raise RuntimeError(f"espeak_failed:{details}")
    return {"via": "espeak-ng", "params": {"speed": speed, "pitch": pitch, "amplitude": amplitude}}


def reference_sketch_duration(text: str, mode: str) -> float:
    base = 7.0 if mode == "sing" else 4.5
    per_char = 0.035 if mode == "sing" else 0.018
    return max(base, min(28.0, base + len(clean_text(text)) * per_char))


def run_reference_voice_sketch(reference_file: Path, out_file: Path, req: SynthesizeRequest, text: str) -> dict:
    if not reference_file.exists():
        raise RuntimeError("reference_voice_missing")

    duration = reference_sketch_duration(text, req.vocalMode)
    if req.vocalMode == "sing":
        filter_graph = (
            "highpass=f=70,lowpass=f=9800,"
            "asetrate=44100*1.015,aresample=44100,"
            "aphaser=in_gain=0.72:out_gain=0.82:delay=2.1:decay=0.35,"
            "acompressor=threshold=-19dB:ratio=2.4:attack=12:release=160,"
            "loudnorm=I=-17:TP=-1.5:LRA=10,"
            "afade=t=in:st=0:d=0.18,"
            f"afade=t=out:st={max(0.1, duration - 0.45):.3f}:d=0.45"
        )
    else:
        filter_graph = (
            "highpass=f=75,lowpass=f=9000,"
            "acompressor=threshold=-18dB:ratio=2.0:attack=10:release=120,"
            "loudnorm=I=-18:TP=-1.5:LRA=9,"
            "afade=t=in:st=0:d=0.12,"
            f"afade=t=out:st={max(0.1, duration - 0.35):.3f}:d=0.35"
        )

    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-stream_loop",
            "-1",
            "-i",
            str(reference_file),
            "-t",
            f"{duration:.3f}",
            "-af",
            filter_graph,
            "-ar",
            "44100",
            "-ac",
            "1",
            str(out_file),
        ],
        capture_output=True,
        text=True,
        timeout=90,
    )
    if proc.returncode != 0 or not out_file.exists():
        details = (proc.stderr or proc.stdout or "").strip()[:800]
        raise RuntimeError(f"reference_voice_sketch_failed:{details}")
    return {
        "provider": "voice-reference-sketch",
        "engine": "ffmpeg-reference-sketch",
        "voiceStyle": reference_file.stem,
        "durationTargetSeconds": duration,
        "promptRenderedAsSpeech": False,
        "promptCarriedInMetadata": True,
        "filter": filter_graph,
    }


def synthesize(req: SynthesizeRequest) -> dict:
    prune_old_audio()
    text = shape_for_mode(clean_text(req.text), req.vocalMode)
    if not text:
        raise HTTPException(status_code=400, detail="missing_text")

    out_name = f"a11-voice-{int(time.time() * 1000)}.wav"
    out_file = OUT_DIR / out_name
    piper_error = None
    generator_error = None
    meta = None
    try:
        meta = run_piper(text, out_file, req)
    except Exception as exc:
        piper_error = str(exc)
        try:
            meta = run_espeak(text, out_file, req)
        except Exception as espeak_exc:
            generator_error = f"{piper_error}; {espeak_exc}"

    persona = normalize_persona(req.voicePersona or req.persona or req.surface)
    reference_file = find_persona_reference(persona, req.vocalMode) if wants_persona_voice(req, persona) else None
    if wants_persona_voice(req, persona):
        if not reference_file:
            delete_generated_audio(out_file)
            raise HTTPException(
                status_code=424,
                detail={
                    "error": "persona_reference_missing",
                    "persona": persona,
                    "searched": [str(item) for item in voice_library_dirs()],
                },
            )

        converted_name = f"a11-voice-persona-{int(time.time() * 1000)}.wav"
        converted_file = OUT_DIR / converted_name
        if not out_file.exists():
            try:
                voice_meta = run_reference_voice_sketch(reference_file, converted_file, req, text)
            except Exception as exc:
                raise HTTPException(
                    status_code=424,
                    detail={
                        "error": "persona_voice_generation_failed",
                        "persona": persona,
                        "message": str(exc)[:900],
                        "baseGeneratorError": generator_error,
                    },
                ) from exc

            return {
                "ok": True,
                "text": text,
                "audio_url": f"/out/{converted_name}",
                "audioUrl": f"/out/{converted_name}",
                "duration_ms": wav_duration_ms(converted_file),
                "module": "a11-voice-module",
                "provider": voice_meta.get("provider") or "voice-reference-sketch",
                "via": "a11-voice-module-reference-sketch",
                "vocalMode": req.vocalMode,
                "persona": persona,
                "piperError": piper_error,
                "baseGeneratorError": generator_error,
                "baseVoice": None,
                "providerCapabilities": {
                    "referenceVoice": True,
                    "styleVoice": True,
                    "promptToAudioSketch": True,
                },
                "voiceReference": {
                    "id": f"{persona}:{reference_file.stem}",
                    "label": reference_file.name,
                    "scope": "voice-library",
                },
                "voiceConversion": {
                    "ok": True,
                    "module": "a11-voice-module",
                    "provider": voice_meta.get("provider") or "voice-reference-sketch",
                    "engine": voice_meta.get("engine") or "ffmpeg-reference-sketch",
                    "voiceStyle": voice_meta.get("voiceStyle") or req.voiceStyle or reference_file.stem,
                    "attemptedEngines": ["reference-sketch"],
                    "reference": {
                        "id": f"{persona}:{reference_file.stem}",
                        "label": reference_file.name,
                        "scope": "voice-library",
                    },
                },
                **voice_meta,
            }

        selected_engine = (req.engine or "auto").strip().lower()
        reference_style = infer_reference_style(reference_file)
        morph_strength = clamp_float(
            req.strength,
            default_conversion_strength_for(reference_style, persona),
            0.05,
            1.0,
        )
        morph_f0_shift = req.f0Shift if req.f0Shift is not None else default_f0_shift_for(reference_style, persona)
        attempted = []
        last_error = None

        try:
            for provider in provider_chain(selected_engine):
                attempted.append(provider)
                try:
                    if is_xtts_rvc_provider(provider):
                        voice_meta = run_xtts_rvc(
                            out_file,
                            reference_file,
                            converted_file,
                            req.vocalMode,
                            text,
                            morph_strength,
                            morph_f0_shift,
                        )
                        break
                    if provider in {"ffmpeg", "ffmpeg-morph", "morph"}:
                        voice_meta = run_ffmpeg_morph(
                            out_file,
                            reference_file,
                            converted_file,
                            req.vocalMode,
                            morph_strength,
                            morph_f0_shift,
                        )
                        break
                    raise RuntimeError(f"unknown_voice_converter:{provider}")
                except Exception as exc:
                    last_error = exc
                    if selected_engine not in {"", "auto", "default"} or not XTTS_RVC_FALLBACK_TO_FFMPEG:
                        raise
            else:
                raise last_error or RuntimeError("voice_conversion_provider_unavailable")
        except Exception as exc:
            delete_generated_audio(out_file)
            raise HTTPException(
                status_code=424,
                detail={
                    "error": "persona_voice_conversion_failed",
                    "persona": persona,
                    "message": str(exc)[:900],
                    "attempted": attempted,
                },
            ) from exc

        delete_generated_audio(out_file)
        engine = voice_meta.get("engine") or voice_meta.get("provider") or (attempted[-1] if attempted else "persona-voice")
        return {
            "ok": True,
            "text": text,
            "audio_url": f"/out/{converted_name}",
            "audioUrl": f"/out/{converted_name}",
            "duration_ms": wav_duration_ms(converted_file),
            "module": "a11-voice-module",
            "provider": voice_meta.get("provider") or "persona-voice",
            "via": "a11-voice-module-persona",
            "vocalMode": req.vocalMode,
            "persona": persona,
            "piperError": piper_error,
            "baseVoice": meta,
            "providerCapabilities": {
                "referenceVoice": True,
                "styleVoice": True,
            },
            "voiceReference": {
                "id": f"{persona}:{reference_file.stem}",
                "label": reference_file.name,
                "scope": "voice-library",
            },
            "voiceConversion": {
                "ok": True,
                "module": "a11-voice-module",
                "provider": voice_meta.get("provider") or "persona-voice",
                "engine": engine,
                "voiceStyle": voice_meta.get("voiceStyle") or req.voiceStyle or reference_file.stem,
                "attemptedEngines": attempted,
                "reference": {
                    "id": f"{persona}:{reference_file.stem}",
                    "label": reference_file.name,
                    "scope": "voice-library",
                },
            },
            **voice_meta,
        }

    if not out_file.exists():
        raise HTTPException(
            status_code=424,
            detail={
                "error": "voice_generator_unavailable",
                "message": "No local voice generator produced audio.",
                "baseGeneratorError": generator_error,
            },
        )

    return {
        "ok": True,
        "text": text,
        "audio_url": f"/out/{out_name}",
        "audioUrl": f"/out/{out_name}",
        "duration_ms": wav_duration_ms(out_file),
        "module": "a11-voice-module",
        "vocalMode": req.vocalMode,
        "piperError": piper_error,
        **meta,
    }


@app.post("/api/voice/convert")
async def convert_voice(
    generated: UploadFile = File(...),
    reference: Optional[UploadFile] = File(default=None),
    mode: Literal["speech", "adaptive", "sing"] = Form(default="adaptive"),
    engine: str = Form(default="auto"),
    text: str = Form(default=""),
    persona: str = Form(default=""),
    voiceStyle: str = Form(default=""),
    strength: Optional[float] = Form(default=None),
    f0Shift: Optional[float] = Form(default=None),
):
    prune_old_audio()
    generated_file = await save_upload(generated, "generated")
    reference_file = await save_upload(reference, "reference") if reference else None
    out_name = f"a11-converted-{int(time.time() * 1000)}.wav"
    out_file = OUT_DIR / out_name
    selected_engine = (engine or "auto").strip().lower()
    reference_style = infer_reference_style(reference_file)
    normalized_persona = normalize_persona(persona or voiceStyle or reference_style)
    morph_strength = clamp_float(
        strength,
        default_conversion_strength_for(reference_style, normalized_persona),
        0.05,
        1.0,
    )
    morph_f0_shift = f0Shift if f0Shift is not None else default_f0_shift_for(reference_style, normalized_persona)
    last_error = None
    attempted = []

    try:
        for provider in provider_chain(selected_engine):
            attempted.append(provider)
            try:
                if is_xtts_rvc_provider(provider):
                    meta = run_xtts_rvc(generated_file, reference_file, out_file, mode, clean_text(text), morph_strength, morph_f0_shift)
                    break
                if provider in {"ffmpeg", "ffmpeg-morph", "morph"}:
                    meta = run_ffmpeg_morph(generated_file, reference_file, out_file, mode, morph_strength, morph_f0_shift)
                    break
                raise RuntimeError(f"unknown_voice_converter:{provider}")
            except Exception as exc:
                last_error = exc
                if selected_engine not in {"", "auto", "default"} or not XTTS_RVC_FALLBACK_TO_FFMPEG:
                    raise
        else:
            raise last_error or RuntimeError("voice_conversion_provider_unavailable")
    except Exception as exc:
        detail = {
            "error": "voice_conversion_failed",
            "message": str(exc)[:900],
            "attempted": attempted,
        }
        raise HTTPException(status_code=500, detail=detail) from exc
    finally:
        delete_generated_audio(generated_file)
        if reference_file:
            delete_generated_audio(reference_file)

    return {
        "ok": True,
        "audio_url": f"/out/{out_name}",
        "audioUrl": f"/out/{out_name}",
        "duration_ms": wav_duration_ms(out_file),
        "module": "a11-voice-module",
        "mode": mode,
        "engine": meta.get("engine") or meta.get("provider") or attempted[-1],
        "strength": morph_strength,
        "referenceUsed": bool(reference_file),
        "attemptedEngines": attempted,
        "persona": persona or None,
        "requestedVoiceStyle": voiceStyle or None,
        **meta,
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "module": "a11-voice-module",
        "piper": PIPER_BIN.exists(),
        "model": PIPER_MODEL.exists(),
        "config": PIPER_CONFIG.exists(),
        "outDir": str(OUT_DIR),
        "conversion": {
            "ok": True,
            "provider": CONVERSION_PROVIDER,
            "endpoint": "/api/voice/convert",
            "engines": ["xtts-rvc", "xtts-rvc-api", "xtts-rvc-ui-gradio", "ffmpeg-morph"],
            "xttsRvc": {
                "configured": bool(XTTS_RVC_URL),
                "protocol": XTTS_RVC_PROTOCOL,
                "fallbackToFfmpeg": XTTS_RVC_FALLBACK_TO_FFMPEG,
            },
        },
        "research": {
            "primeSpiral": {
                "ok": True,
                "endpoint": "/research/prime-spiral/control",
                "spectralBaseHz": prime_spiral_morph.SPECTRAL_BASE_HZ,
            },
        },
    }


@app.post("/research/prime-spiral/control")
def prime_spiral_control(req: PrimeSpiralControlRequest):
    try:
        curve = prime_spiral_morph.control_curve(
            req.length,
            phi=req.phi,
            j_value=req.j,
            orientation=req.orientation,
            max_db=req.maxDb,
            prime_boost_db=req.primeBoostDb,
            mode=req.mode,
        )
        weights = prime_spiral_morph.spectral_weights(
            req.bins,
            phi=req.phi,
            j_value=req.j,
            orientation=req.orientation,
            strength=req.weightStrength,
            mode=req.mode,
        )
        payload = {
            "ok": True,
            "schema": "funesterie.prime-spiral-audio-control.v1",
            "module": "a11-voice-module",
            "researchOnly": True,
            "spectralBaseHz": prime_spiral_morph.SPECTRAL_BASE_HZ,
            "params": req.model_dump(),
            "curve": curve,
            "weights": weights,
            "guardrails": {
                "notProductionVoiceRoute": True,
                "notRiemannProof": True,
                "boundedModulation": True,
            },
        }
        if req.includeFeatures:
            payload["features"] = [
                item.__dict__
                for item in prime_spiral_morph.spiral_features(
                    min(req.length, 512),
                    phi=req.phi,
                    j_value=req.j,
                    orientation=req.orientation,
                    max_db=req.maxDb,
                )
            ]
        return payload
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/voice/synthesize")
def synthesize_voice(req: SynthesizeRequest):
    return synthesize(req)


@app.post("/api/tts")
def synthesize_tts(req: SynthesizeRequest):
    return synthesize(req)


@app.get("/out/{filename}")
def get_audio(filename: str, background_tasks: BackgroundTasks, consume: bool = False):
    safe = Path(filename).name
    file_path = OUT_DIR / safe
    if not file_path.exists() or file_path.suffix.lower() != ".wav":
        raise HTTPException(status_code=404, detail="audio_not_found")
    if consume:
        background_tasks.add_task(delete_generated_audio, file_path)
    return FileResponse(file_path, media_type="audio/wav", filename=safe)
