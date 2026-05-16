import os
import re
import shutil
import subprocess
import time
import wave
from pathlib import Path
from typing import Literal, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


ROOT = Path("/app")
OUT_DIR = Path(os.environ.get("A11_VOICE_OUT_DIR", ROOT / "out"))
PIPER_BIN = Path(os.environ.get("A11_PIPER_BIN", ROOT / "piper" / "piper"))
PIPER_MODEL = Path(os.environ.get("A11_VOICE_MODEL", ROOT / "models" / "fr_FR-siwis-medium.onnx"))
PIPER_CONFIG = Path(os.environ.get("A11_VOICE_CONFIG", f"{PIPER_MODEL}.json"))
ESPEAK_DATA = Path(os.environ.get("A11_ESPEAK_DATA", ROOT / "piper" / "espeak-ng-data"))
CONVERSION_PROVIDER = os.environ.get("A11_VOICE_CONVERTER_PROVIDER", "ffmpeg").strip().lower() or "ffmpeg"
DEFAULT_CONVERSION_STRENGTH = float(os.environ.get("A11_VOICE_CONVERSION_STRENGTH", "0.45") or "0.45")
DEFAULT_F0_SHIFT = float(os.environ.get("A11_VOICE_DEFAULT_F0_SHIFT", "-1.5") or "-1.5")

OUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="A11 Voice Module", version="0.1.0")


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
    vocalMode: Literal["speech", "adaptive", "sing"] = "speech"
    lengthScale: Optional[float] = Field(default=None, ge=0.6, le=2.2)
    noiseScale: Optional[float] = Field(default=None, ge=0.1, le=1.4)
    noiseW: Optional[float] = Field(default=None, ge=0.1, le=1.4)


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


def ffmpeg_morph_filter(mode: str, strength: float, f0_shift: Optional[float], generated_profile: dict, reference_profile: dict) -> str:
    sample_rate = int(generated_profile.get("sampleRate") or 22050)
    mode_shift = -0.6 if mode == "adaptive" else 0.0
    if mode == "sing":
        mode_shift = 0.8
    shift = clamp_float(f0_shift, DEFAULT_F0_SHIFT + mode_shift, -12.0, 12.0) * strength
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

    filters.extend([
        "acompressor=threshold=-18dB:ratio=2.4:attack=8:release=140",
        "loudnorm=I=-16:LRA=10:TP=-1.5",
    ])
    return ",".join(filters)


def run_ffmpeg_morph(generated_file: Path, reference_file: Optional[Path], out_file: Path, mode: str, strength: float, f0_shift: Optional[float]) -> dict:
    generated_profile = wav_profile(generated_file)
    reference_profile = wav_profile(reference_file) if reference_file else {}
    filter_graph = ffmpeg_morph_filter(mode, strength, f0_shift, generated_profile, reference_profile)
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
        "generatedProfile": generated_profile,
        "referenceProfile": reference_profile or None,
    }


def run_piper(text: str, out_file: Path, req: SynthesizeRequest) -> dict:
    if not PIPER_BIN.exists():
        raise RuntimeError("piper_missing")
    if not PIPER_MODEL.exists():
        raise RuntimeError("piper_model_missing")

    params = piper_params(req.vocalMode, req)
    args = [
        str(PIPER_BIN),
        "--model",
        str(PIPER_MODEL),
        "--config",
        str(PIPER_CONFIG),
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
    return {"via": "piper", "params": params}


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


def synthesize(req: SynthesizeRequest) -> dict:
    prune_old_audio()
    text = shape_for_mode(clean_text(req.text), req.vocalMode)
    if not text:
        raise HTTPException(status_code=400, detail="missing_text")

    out_name = f"a11-voice-{int(time.time() * 1000)}.wav"
    out_file = OUT_DIR / out_name
    piper_error = None
    try:
        meta = run_piper(text, out_file, req)
    except Exception as exc:
        piper_error = str(exc)
        meta = run_espeak(text, out_file, req)

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
    strength: Optional[float] = Form(default=None),
    f0Shift: Optional[float] = Form(default=None),
):
    prune_old_audio()
    generated_file = await save_upload(generated, "generated")
    reference_file = await save_upload(reference, "reference") if reference else None
    out_name = f"a11-converted-{int(time.time() * 1000)}.wav"
    out_file = OUT_DIR / out_name
    selected_engine = (engine or "auto").strip().lower()
    selected_provider = CONVERSION_PROVIDER if selected_engine == "auto" else selected_engine
    morph_strength = clamp_float(strength, DEFAULT_CONVERSION_STRENGTH, 0.05, 1.0)

    try:
        # RVC/XTTS can be attached here later; ffmpeg-morph is the always-on local bridge.
        meta = run_ffmpeg_morph(generated_file, reference_file, out_file, mode, morph_strength, f0Shift)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:900]) from exc
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
        "engine": selected_provider,
        "strength": morph_strength,
        "referenceUsed": bool(reference_file),
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
            "engines": ["ffmpeg-morph", "rvc-bridge", "xtts-bridge"],
        },
    }


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
