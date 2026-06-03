#!/usr/bin/env python
"""Local A11 bridge for ComfyUI Mochi video generation.

The public A11 backend can call this service through A11_VIDEO_PROXY_URL or
A11_VIDEO_LOCAL_RUNNER_URL when a reachable bridge/tunnel is configured.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hmac
import json
import math
import os
import random
import shutil
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import uvicorn


DEFAULT_COMFY_URL = os.environ.get("A11_COMFY_URL", "http://127.0.0.1:8188").rstrip("/")
DEFAULT_OUTPUT_DIR = Path(os.environ.get("A11_COMFY_OUTPUT_DIR", r"E:\Funesterie\outputs\comfy"))
DEFAULT_TEMP_DIR = Path(os.environ.get("A11_COMFY_TEMP_DIR", r"E:\Funesterie\tmp\comfy"))
DEFAULT_PUBLIC_COPY_DIR = Path(os.environ.get(
    "A11_COMFY_PUBLIC_VIDEO_DIR",
    r"D:\projets\funesterie\a11\backend\apps\server\runtime\files\generated\videos\comfy",
))

CLIP_NAME = os.environ.get("A11_COMFY_MOCHI_T5", r"t5\t5xxl_fp8_e4m3fn.safetensors")
MODEL_NAME = os.environ.get("A11_COMFY_MOCHI_MODEL", "mochi_preview_dit_GGUF_Q4_0_v2.safetensors")
VAE_NAME = os.environ.get("A11_COMFY_MOCHI_VAE", "mochi_preview_vae_decoder_bf16.safetensors")
DEFAULT_WIDTH = int(os.environ.get("A11_COMFY_MOCHI_WIDTH", "384"))
DEFAULT_HEIGHT = int(os.environ.get("A11_COMFY_MOCHI_HEIGHT", "384"))
DEFAULT_STEPS = int(os.environ.get("A11_COMFY_MOCHI_STEPS", "8"))
DEFAULT_MAX_FRAMES = int(os.environ.get("A11_COMFY_MOCHI_MAX_FRAMES", "13"))
DEFAULT_TIMEOUT_SEC = int(os.environ.get("A11_COMFY_MOCHI_TIMEOUT_SEC", "1800"))
DEFAULT_MAX_PIXELS = int(os.environ.get("A11_COMFY_MOCHI_MAX_PIXELS", str(384 * 384)))
DEFAULT_JOB_TTL_SEC = int(os.environ.get("A11_COMFY_MOCHI_JOB_TTL_SEC", "3600"))
DEFAULT_JOB_POLL_INTERVAL_MS = int(os.environ.get("A11_COMFY_MOCHI_JOB_POLL_INTERVAL_MS", "5000"))
DEFAULT_JOB_WORKERS = max(1, int(os.environ.get("A11_COMFY_MOCHI_WORKERS", "1")))
MOCHI_SAFE_DIMENSION_MULTIPLE = 16

VIDEO_JOBS: dict[str, dict[str, Any]] = {}
VIDEO_JOBS_LOCK = threading.Lock()
VIDEO_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=DEFAULT_JOB_WORKERS)


def first_configured_token(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "")
        for token in str(value or "").replace(",", " ").split():
            token = token.strip()
            if token:
                return token
    return ""


ACCESS_TOKEN = first_configured_token(
    "A11_VIDEO_PROXY_TOKEN",
    "A11_VIDEO_BRIDGE_TOKEN",
    "VIDEO_PROXY_TOKEN",
    "A11_NEZ_ADMIN_TOKEN",
    "NEZ_ADMIN_TOKEN",
    "A11_NEZ_SERVICE_TOKEN",
    "NEZ_SERVICE_TOKEN",
    "A11_NEZ_TOKEN",
    "NEZ_TOKEN",
)


def require_bridge_auth(request: Request) -> None:
    if not ACCESS_TOKEN:
        return

    candidates = [
        request.headers.get("x-a11-video-token"),
        request.headers.get("x-nez-token"),
        request.headers.get("x-nez-admin-token"),
    ]
    authorization = str(request.headers.get("authorization") or "").strip()
    if authorization.lower().startswith("bearer "):
        candidates.append(authorization[7:].strip())

    for candidate in candidates:
        if candidate and hmac.compare_digest(str(candidate), ACCESS_TOKEN):
            return

    raise HTTPException(
        status_code=401,
        detail={
            "ok": False,
            "error": "video_bridge_unauthorized",
            "message": "video_bridge_unauthorized",
        },
    )


class VideoRequest(BaseModel):
    prompt: str = Field(default="")
    message: str = Field(default="")
    negativePrompt: str = Field(default="")
    negative_prompt: str = Field(default="")
    durationSeconds: float = Field(default=2)
    duration_seconds: float | None = None
    fps: int = Field(default=6)
    width: int | None = None
    height: int | None = None
    seed: int | None = None
    cfgScale: float = Field(default=4.5)
    cfg_scale: float | None = None
    steps: int | None = None
    num_steps: int | None = None
    num_frames: int | None = None
    acceptAsyncVideoJob: bool | str | int | None = None
    acceptAsyncJob: bool | str | int | None = None
    mobileAsync: bool | str | int | None = None
    async_request: bool | str | int | None = Field(default=None, alias="async")


def is_truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def is_async_requested(request: VideoRequest) -> bool:
    return (
        request.acceptAsyncVideoJob is True
        or request.acceptAsyncJob is True
        or request.mobileAsync is True
        or request.async_request is True
        or is_truthy(request.acceptAsyncVideoJob)
        or is_truthy(request.acceptAsyncJob)
        or is_truthy(request.mobileAsync)
        or is_truthy(request.async_request)
    )


def now_ms() -> int:
    return int(time.time() * 1000)


def cleanup_expired_video_jobs() -> None:
    deadline_ms = now_ms() - max(60, DEFAULT_JOB_TTL_SEC) * 1000
    with VIDEO_JOBS_LOCK:
        expired = [
            job_id
            for job_id, job in VIDEO_JOBS.items()
            if int(job.get("updatedAt") or job.get("createdAt") or 0) < deadline_ms
        ]
        for job_id in expired:
            VIDEO_JOBS.pop(job_id, None)


def serialize_video_job(job: dict[str, Any]) -> dict[str, Any]:
    job_id = str(job.get("jobId") or job.get("id") or "")
    status = str(job.get("status") or "pending")
    envelope = {
        "id": job_id,
        "jobId": job_id,
        "kind": "video.generate",
        "status": status,
        "poll_url": f"/api/video/jobs/{job_id}",
        "pollUrl": f"/api/video/jobs/{job_id}",
        "pollIntervalMs": int(job.get("pollIntervalMs") or DEFAULT_JOB_POLL_INTERVAL_MS),
        "createdAt": int(job.get("createdAt") or now_ms()),
        "updatedAt": int(job.get("updatedAt") or now_ms()),
        "completedAt": job.get("completedAt") or None,
        "strategy": "local-comfy-thread-poll",
    }

    payload = {
        "ok": status != "error",
        "id": job_id,
        "jobId": job_id,
        "status": status,
        "poll_url": envelope["poll_url"],
        "pollUrl": envelope["pollUrl"],
        "pollIntervalMs": envelope["pollIntervalMs"],
        "createdAt": envelope["createdAt"],
        "updatedAt": envelope["updatedAt"],
        "completedAt": envelope["completedAt"],
        "provider": "comfyui-mochi",
        "asyncJob": envelope,
    }

    if status == "done":
        payload["result"] = job.get("result") or {}
    elif status == "error":
        payload["error"] = str(job.get("error") or "local_comfy_mochi_failed")
        payload["message"] = str(job.get("message") or job.get("error") or "local_comfy_mochi_failed")

    return payload


def update_video_job(job_id: str, **updates: Any) -> None:
    with VIDEO_JOBS_LOCK:
        job = VIDEO_JOBS.get(job_id)
        if not job:
            return
        job.update(updates)
        job["updatedAt"] = now_ms()


def get_video_job(job_id: str) -> dict[str, Any] | None:
    cleanup_expired_video_jobs()
    with VIDEO_JOBS_LOCK:
        job = VIDEO_JOBS.get(job_id)
        return dict(job) if job else None


def run_async_video_job(runtime: "ComfyMochiRuntime", job_id: str, request: VideoRequest) -> None:
    update_video_job(job_id, status="running")
    try:
        result = runtime.generate(request)
        update_video_job(job_id, status="done", result=result, completedAt=now_ms())
    except Exception as exc:
        update_video_job(
            job_id,
            status="error",
            error="local_comfy_mochi_failed",
            message=str(exc),
            completedAt=now_ms(),
        )


def start_async_video_job(runtime: "ComfyMochiRuntime", request: VideoRequest) -> dict[str, Any]:
    cleanup_expired_video_jobs()
    job_id = f"lvjob-{now_ms()}-{uuid.uuid4().hex[:8]}"
    job = {
        "id": job_id,
        "jobId": job_id,
        "status": "pending",
        "createdAt": now_ms(),
        "updatedAt": now_ms(),
        "pollIntervalMs": DEFAULT_JOB_POLL_INTERVAL_MS,
    }
    with VIDEO_JOBS_LOCK:
        VIDEO_JOBS[job_id] = job
    VIDEO_JOB_EXECUTOR.submit(run_async_video_job, runtime, job_id, request)
    return serialize_video_job(job)


def http_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def clamp_dimension(value: int | None, fallback: int) -> int:
    numeric = int(value or fallback)
    numeric = max(128, min(848, numeric))
    return max(128, (numeric // MOCHI_SAFE_DIMENSION_MULTIPLE) * MOCHI_SAFE_DIMENSION_MULTIPLE)


def clamp_resolution(width: int, height: int) -> tuple[int, int]:
    pixels = width * height
    if pixels <= DEFAULT_MAX_PIXELS:
        return width, height
    scale = math.sqrt(DEFAULT_MAX_PIXELS / pixels)
    width = max(128, int((width * scale) // MOCHI_SAFE_DIMENSION_MULTIPLE) * MOCHI_SAFE_DIMENSION_MULTIPLE)
    height = max(128, int((height * scale) // MOCHI_SAFE_DIMENSION_MULTIPLE) * MOCHI_SAFE_DIMENSION_MULTIPLE)
    return width, height


def normalize_num_frames(request: VideoRequest) -> int:
    if request.num_frames:
        frames = int(request.num_frames)
    else:
        duration = float(request.duration_seconds or request.durationSeconds or 2)
        frames = int(round(duration * max(1, int(request.fps or 6))))
    frames = max(7, min(DEFAULT_MAX_FRAMES, frames))
    remainder = (frames - 7) % 6
    if remainder:
        frames += 6 - remainder
    return max(7, min(DEFAULT_MAX_FRAMES, frames))


def build_prompt(request: VideoRequest, job_id: str) -> dict[str, Any]:
    prompt = (request.prompt or request.message or "").strip()
    if not prompt:
        raise ValueError("prompt_required")
    negative = (request.negative_prompt or request.negativePrompt or "").strip()
    if not negative:
        negative = "low quality, blurry, watermark, text, distorted motion, compression artifacts"

    width, height = clamp_resolution(
        clamp_dimension(request.width, DEFAULT_WIDTH),
        clamp_dimension(request.height, DEFAULT_HEIGHT),
    )
    fps = max(1, min(24, int(request.fps or 6)))
    seed = int(request.seed if request.seed is not None else random.randint(1, 2_147_483_647))
    cfg = float(request.cfg_scale or request.cfgScale or 4.5)
    steps = max(2, min(50, int(request.num_steps or request.steps or DEFAULT_STEPS)))
    filename_prefix = f"a11-comfy-mochi/{job_id}"

    return {
        "1": {
            "class_type": "MochiTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "prompt": prompt,
                "strength": 1,
                "force_offload": False,
            },
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": CLIP_NAME,
                "type": "mochi",
            },
        },
        "8": {
            "class_type": "MochiTextEncode",
            "inputs": {
                "clip": ["1", 1],
                "prompt": negative,
                "strength": 1,
                "force_offload": True,
            },
        },
        "4": {
            "class_type": "DownloadAndLoadMochiModel",
            "inputs": {
                "trigger": ["8", 0],
                "model": MODEL_NAME,
                "vae": VAE_NAME,
                "precision": "fp8_e4m3fn",
                "attention_mode": "sdpa",
                "cublas_ops": False,
                "rms_norm_func": "default",
            },
        },
        "14": {
            "class_type": "MochiSampler",
            "inputs": {
                "model": ["4", 0],
                "positive": ["1", 0],
                "negative": ["8", 0],
                "width": width,
                "height": height,
                "num_frames": normalize_num_frames(request),
                "steps": steps,
                "cfg": cfg,
                "seed": seed,
            },
        },
        "15": {
            "class_type": "MochiDecodeSpatialTiling",
            "inputs": {
                "vae": ["4", 1],
                "samples": ["14", 0],
                "enable_vae_tiling": True,
                "num_tiles_w": 4,
                "num_tiles_h": 4,
                "overlap": 16,
                "min_block_size": 1,
                "per_batch": 6,
                "unnormalize": True,
            },
        },
        "9": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["15", 0],
                "frame_rate": fps,
                "loop_count": 0,
                "filename_prefix": filename_prefix,
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": 23,
                "save_metadata": True,
                "trim_to_audio": False,
                "pingpong": False,
                "save_output": True,
            },
        },
    }


def output_path_from_gif(entry: dict[str, Any]) -> Path:
    filename = str(entry.get("filename") or "").strip()
    subfolder = str(entry.get("subfolder") or "").strip()
    kind = str(entry.get("type") or "output").strip().lower()
    root = DEFAULT_TEMP_DIR / "temp" if kind == "temp" else DEFAULT_OUTPUT_DIR
    return root / subfolder / filename


def extract_video_path(history_entry: dict[str, Any]) -> Path | None:
    outputs = history_entry.get("outputs") or {}
    for output in outputs.values():
        for entry in output.get("gifs") or []:
            path = output_path_from_gif(entry)
            if path.is_file():
                return path
    return None


class ComfyMochiRuntime:
    def __init__(self, comfy_url: str, public_copy_dir: Path):
        self.comfy_url = comfy_url.rstrip("/")
        self.public_copy_dir = public_copy_dir

    def health(self) -> dict[str, Any]:
        try:
            objects = http_json("GET", f"{self.comfy_url}/object_info", timeout=20)
            nodes = set(objects.keys())
            required = ["MochiSampler", "MochiDecode", "VHS_VideoCombine", "CLIPLoader", "DownloadAndLoadMochiModel"]
            return {
                "ok": all(name in nodes for name in required),
                "service": "a11-local-comfy-mochi-runner",
                "provider": "comfyui-mochi",
                "comfyUrl": self.comfy_url,
                "outputDir": str(DEFAULT_OUTPUT_DIR),
                "publicCopyDir": str(self.public_copy_dir),
                "authRequired": bool(ACCESS_TOKEN),
                "asyncJobs": len(VIDEO_JOBS),
                "asyncWorkers": DEFAULT_JOB_WORKERS,
                "nodes": {name: name in nodes for name in required},
                "model": MODEL_NAME,
                "vae": VAE_NAME,
                "clip": CLIP_NAME,
            }
        except Exception as exc:
            return {
                "ok": False,
                "service": "a11-local-comfy-mochi-runner",
                "provider": "comfyui-mochi",
                "comfyUrl": self.comfy_url,
                "authRequired": bool(ACCESS_TOKEN),
                "asyncJobs": len(VIDEO_JOBS),
                "asyncWorkers": DEFAULT_JOB_WORKERS,
                "error": str(exc),
            }

    def generate(self, request: VideoRequest) -> dict[str, Any]:
        prompt_text = (request.prompt or request.message or "").strip()
        if not prompt_text:
            raise ValueError("prompt_required")

        job_id = f"comfy-{int(time.time())}-{uuid.uuid4().hex[:8]}"
        workflow = build_prompt(request, job_id)
        client_id = uuid.uuid4().hex
        queued = http_json("POST", f"{self.comfy_url}/prompt", {"prompt": workflow, "client_id": client_id}, timeout=60)
        prompt_id = str(queued.get("prompt_id") or "").strip()
        if not prompt_id:
            raise RuntimeError(f"comfy_prompt_queue_failed: {queued}")

        deadline = time.time() + DEFAULT_TIMEOUT_SEC
        last_status: dict[str, Any] = {}
        while time.time() < deadline:
            history = http_json("GET", f"{self.comfy_url}/history/{prompt_id}", timeout=30)
            history_entry = history.get(prompt_id) or {}
            if history_entry:
                last_status = history_entry.get("status") or {}
                status_text = str(last_status.get("status_str") or "").lower()
                if status_text == "error":
                    raise RuntimeError(json.dumps(last_status, ensure_ascii=False))
                video_path = extract_video_path(history_entry)
                if video_path:
                    public_path = self.copy_to_public_dir(video_path)
                    return {
                        "ok": True,
                        "tool": "generate_video",
                        "provider": "comfyui-mochi",
                        "model": "genmo/mochi-1-preview",
                        "prompt": prompt_text,
                        "prompt_id": prompt_id,
                        "video_path": str(public_path),
                        "outputPath": str(public_path),
                        "path": str(public_path),
                        "localComfyPath": str(video_path),
                        "filename": public_path.name,
                    }
            time.sleep(3)

        raise TimeoutError(f"comfy_video_timeout: prompt_id={prompt_id} status={last_status}")

    def copy_to_public_dir(self, source: Path) -> Path:
        target_dir = self.public_copy_dir / time.strftime("%Y%m%d")
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / source.name
        shutil.copy2(source, target)
        return target


def build_app(runtime: ComfyMochiRuntime) -> FastAPI:
    app = FastAPI(title="A11 Local Comfy Mochi Runner")
    DEFAULT_PUBLIC_COPY_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/files/generated/videos", StaticFiles(directory=str(DEFAULT_PUBLIC_COPY_DIR)), name="generated-videos")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return runtime.health()

    @app.post("/api/tools/generate_video")
    def generate_video(request: VideoRequest, http_request: Request) -> dict[str, Any]:
        require_bridge_auth(http_request)
        if is_async_requested(request):
            return JSONResponse(status_code=202, content=start_async_video_job(runtime, request))
        try:
            return runtime.generate(request)
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "ok": False,
                    "error": "local_comfy_mochi_failed",
                    "message": str(exc),
                },
            ) from exc

    def handle_job_status(job_id: str, http_request: Request) -> dict[str, Any]:
        require_bridge_auth(http_request)
        job = get_video_job(job_id)
        if not job:
            raise HTTPException(
                status_code=404,
                detail={
                    "ok": False,
                    "error": "video_job_not_found",
                    "message": "video_job_not_found",
                    "jobId": job_id,
                },
            )
        return serialize_video_job(job)

    @app.get("/api/video/jobs/{job_id}")
    def video_job_status(job_id: str, http_request: Request) -> dict[str, Any]:
        return handle_job_status(job_id, http_request)

    @app.get("/api/tools/video_jobs/{job_id}")
    def tool_video_job_status(job_id: str, http_request: Request) -> dict[str, Any]:
        return handle_job_status(job_id, http_request)

    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("A11_COMFY_RUNNER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("A11_COMFY_RUNNER_PORT", "17881")))
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    parser.add_argument("--public-copy-dir", default=str(DEFAULT_PUBLIC_COPY_DIR))
    args = parser.parse_args()

    runtime = ComfyMochiRuntime(comfy_url=args.comfy_url, public_copy_dir=Path(args.public_copy_dir))
    uvicorn.run(build_app(runtime), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
