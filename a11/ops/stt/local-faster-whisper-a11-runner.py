#!/usr/bin/env python
"""Local faster-whisper bridge for A11 STT.

It exposes an OpenAI-compatible transcription endpoint:
POST /v1/audio/transcriptions

The model, temp files and caches are intended to live on E:\ so the Windows
system disk does not get eaten by Whisper assets.
"""

from __future__ import annotations

import argparse
import hmac
import os
from pathlib import Path
import tempfile
import threading
from typing import Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel
import uvicorn


DEFAULT_MODEL_ID = os.environ.get("A11_STT_FAST_WHISPER_MODEL", "Systran/faster-whisper-large-v3")
DEFAULT_WORK_ROOT = Path(os.environ.get("A11_STT_WORK_ROOT", r"E:\Funesterie\stt\faster-whisper"))
DEFAULT_DOWNLOAD_ROOT = Path(os.environ.get("A11_STT_DOWNLOAD_ROOT", str(DEFAULT_WORK_ROOT / "models")))
DEFAULT_TEMP_ROOT = Path(os.environ.get("A11_STT_TEMP_ROOT", str(DEFAULT_WORK_ROOT / "tmp")))
DEFAULT_DEVICE = os.environ.get("A11_STT_FAST_WHISPER_DEVICE", "auto")
DEFAULT_COMPUTE_TYPE = os.environ.get("A11_STT_FAST_WHISPER_COMPUTE_TYPE", "auto")
DEFAULT_BEAM_SIZE = int(os.environ.get("A11_STT_FAST_WHISPER_BEAM_SIZE", "5"))
DEFAULT_VAD_FILTER = os.environ.get("A11_STT_FAST_WHISPER_VAD", "true").lower() not in {"0", "false", "no", "off"}
ACCESS_TOKEN = os.environ.get("A11_STT_FAST_WHISPER_TOKEN", "").strip()


app = FastAPI(title="A11 faster-whisper bridge", version="1.0.0")
model_lock = threading.Lock()
model_instance: Optional[WhisperModel] = None
model_id = DEFAULT_MODEL_ID
download_root = DEFAULT_DOWNLOAD_ROOT
temp_root = DEFAULT_TEMP_ROOT
device = DEFAULT_DEVICE
compute_type = DEFAULT_COMPUTE_TYPE


def configure(args: argparse.Namespace) -> None:
    global model_id, download_root, temp_root, device, compute_type
    model_id = args.model
    download_root = Path(args.download_root)
    temp_root = Path(args.temp_root)
    device = args.device
    compute_type = args.compute_type
    download_root.mkdir(parents=True, exist_ok=True)
    temp_root.mkdir(parents=True, exist_ok=True)


def require_auth(request: Request, x_a11_stt_token: str = Header(default="")) -> None:
    if not ACCESS_TOKEN:
        return

    candidates = [x_a11_stt_token]
    authorization = str(request.headers.get("authorization") or "").strip()
    if authorization.lower().startswith("bearer "):
        candidates.append(authorization[7:].strip())

    for candidate in candidates:
        if candidate and hmac.compare_digest(str(candidate), ACCESS_TOKEN):
            return

    raise HTTPException(status_code=401, detail={"ok": False, "error": "stt_bridge_unauthorized"})


def get_model() -> WhisperModel:
    global model_instance
    if model_instance is not None:
        return model_instance

    with model_lock:
        if model_instance is None:
            model_instance = WhisperModel(
                model_id,
                device=device,
                compute_type=compute_type,
                download_root=str(download_root),
            )
    return model_instance


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "provider": "faster-whisper",
        "model": model_id,
        "loaded": model_instance is not None,
        "device": device,
        "compute_type": compute_type,
        "download_root": str(download_root),
        "temp_root": str(temp_root),
    }


@app.post("/v1/audio/transcriptions")
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
    model: str = Form(default=""),
    language: str = Form(default="fr"),
    response_format: str = Form(default="json"),
    x_a11_stt_token: str = Header(default=""),
) -> JSONResponse:
    require_auth(request, x_a11_stt_token)

    effective_model = model_id
    if model and model != model_id:
        # Keep the public endpoint OpenAI-like, but do not hot-swap models from
        # untrusted requests. The launcher decides which model is loaded.
        effective_model = model_id

    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=str(temp_root)) as handle:
        temp_path = Path(handle.name)
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)

    try:
        whisper = get_model()
        segments, info = whisper.transcribe(
            str(temp_path),
            language=language or None,
            beam_size=DEFAULT_BEAM_SIZE,
            vad_filter=DEFAULT_VAD_FILTER,
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text).strip()
        payload = {
            "text": text,
            "language": getattr(info, "language", None) or language or None,
            "duration": getattr(info, "duration", None),
            "provider": "faster-whisper",
            "model": effective_model,
        }
        if response_format == "text":
            return JSONResponse(content={"text": text})
        return JSONResponse(content=payload)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except Exception:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="A11 local faster-whisper STT bridge")
    parser.add_argument("--host", default=os.environ.get("A11_STT_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("A11_STT_PORT", "17911")))
    parser.add_argument("--model", default=DEFAULT_MODEL_ID)
    parser.add_argument("--download-root", default=str(DEFAULT_DOWNLOAD_ROOT))
    parser.add_argument("--temp-root", default=str(DEFAULT_TEMP_ROOT))
    parser.add_argument("--device", default=DEFAULT_DEVICE)
    parser.add_argument("--compute-type", default=DEFAULT_COMPUTE_TYPE)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    configure(args)
    uvicorn.run(app, host=args.host, port=args.port)
