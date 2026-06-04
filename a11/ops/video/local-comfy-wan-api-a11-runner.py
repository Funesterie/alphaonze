#!/usr/bin/env python
"""Local A11 bridge for ComfyUI Wan image-to-video API generation.

This runner is intentionally separate from the local Mochi runner:
Mochi is local text-to-video, while Wan API needs a Comfy Org API key and
supports image-to-video through the `WanImageToVideoApi` node.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hmac
import json
import mimetypes
import os
import random
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
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
    r"D:\projets\funesterie\a11\backend\apps\server\runtime\files\generated\videos\comfy-wan",
))
DEFAULT_JOB_TTL_SEC = int(os.environ.get("A11_COMFY_WAN_JOB_TTL_SEC", "3600"))
DEFAULT_JOB_POLL_INTERVAL_MS = int(os.environ.get("A11_COMFY_WAN_JOB_POLL_INTERVAL_MS", "5000"))
DEFAULT_JOB_WORKERS = max(1, int(os.environ.get("A11_COMFY_WAN_WORKERS", "1")))
DEFAULT_TIMEOUT_SEC = int(os.environ.get("A11_COMFY_WAN_TIMEOUT_SEC", "1800"))
DEFAULT_MODEL = os.environ.get("A11_COMFY_WAN_MODEL", "wan2.5-i2v-preview")
DEFAULT_RESOLUTION = os.environ.get("A11_COMFY_WAN_RESOLUTION", "480P").upper()
DEFAULT_DURATION_SEC = int(os.environ.get("A11_COMFY_WAN_DURATION_SEC", "5"))

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

COMFY_ORG_API_KEY = first_configured_token(
    "A11_COMFY_ORG_API_KEY",
    "A11_COMFY_API_KEY",
    "COMFY_ORG_API_KEY",
    "COMFYUI_API_KEY",
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
    sourceImageUrl: str = Field(default="")
    source_image_url: str = Field(default="")
    referenceImageUrl: str = Field(default="")
    reference_image_url: str = Field(default="")
    initImageUrl: str = Field(default="")
    init_image_url: str = Field(default="")
    imageUrl: str = Field(default="")
    image_url: str = Field(default="")
    sourceImagePath: str = Field(default="")
    source_image_path: str = Field(default="")
    referenceImagePath: str = Field(default="")
    reference_image_path: str = Field(default="")
    durationSeconds: float = Field(default=5)
    duration_seconds: float | None = None
    fps: int = Field(default=16)
    width: int | None = None
    height: int | None = None
    seed: int | None = None
    resolution: str = Field(default="")
    model: str = Field(default="")
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


def request_reference_image_source(request: VideoRequest) -> str:
    for attr in (
        "sourceImageUrl",
        "source_image_url",
        "referenceImageUrl",
        "reference_image_url",
        "initImageUrl",
        "init_image_url",
        "imageUrl",
        "image_url",
        "sourceImagePath",
        "source_image_path",
        "referenceImagePath",
        "reference_image_path",
    ):
        value = str(getattr(request, attr, "") or "").strip()
        if value:
            return value
    return ""


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
        "strategy": "local-comfy-wan-thread-poll",
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
        "provider": "comfyui-wan-api",
        "asyncJob": envelope,
    }
    if status == "done":
        payload["result"] = job.get("result") or {}
    elif status == "error":
        payload["error"] = str(job.get("error") or "local_comfy_wan_failed")
        payload["message"] = str(job.get("message") or job.get("error") or "local_comfy_wan_failed")
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


def run_async_video_job(runtime: "ComfyWanRuntime", job_id: str, request: VideoRequest) -> None:
    update_video_job(job_id, status="running")
    try:
        result = runtime.generate(request)
        update_video_job(job_id, status="done", result=result, completedAt=now_ms())
    except Exception as exc:
        update_video_job(
            job_id,
            status="error",
            error="local_comfy_wan_failed",
            message=str(exc),
            completedAt=now_ms(),
        )


def start_async_video_job(runtime: "ComfyWanRuntime", request: VideoRequest) -> dict[str, Any]:
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


def http_post_multipart(url: str, fields: dict[str, str], files: dict[str, tuple[str, bytes, str]], timeout: int = 60) -> dict[str, Any]:
    boundary = f"a11-comfy-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")
    for name, (filename, content, content_type) in files.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8")
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        chunks.append(content)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def safe_filename_from_source(source: str, default_ext: str = ".png") -> str:
    parsed = urllib.parse.urlparse(source)
    candidate = Path(parsed.path or source).name
    candidate = re.sub(r"[^A-Za-z0-9._-]+", "-", candidate).strip(".-")
    if not candidate:
        candidate = f"reference-{uuid.uuid4().hex[:8]}{default_ext}"
    if "." not in candidate:
        candidate += default_ext
    return candidate


def read_source_bytes(source: str) -> tuple[str, bytes, str]:
    if source.lower().startswith("data:"):
        header, encoded = source.split(",", 1)
        content_type = header[5:].split(";")[0] or "image/png"
        ext = mimetypes.guess_extension(content_type) or ".png"
        return f"reference-{uuid.uuid4().hex[:8]}{ext}", base64.b64decode(encoded), content_type

    if source.lower().startswith(("http://", "https://")):
        request = urllib.request.Request(source, headers={"User-Agent": "A11-Comfy-Wan/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            content = response.read()
            content_type = response.headers.get_content_type() or "application/octet-stream"
        return safe_filename_from_source(source, mimetypes.guess_extension(content_type) or ".png"), content, content_type

    path = Path(source)
    if not path.is_file():
        raise ValueError("reference_image_not_found")
    content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return path.name, path.read_bytes(), content_type


def normalize_resolution(request: VideoRequest, model: str) -> str:
    requested = str(request.resolution or "").strip().upper()
    if requested in {"480P", "720P", "1080P"}:
        return requested
    if request.width or request.height:
        longest = max(int(request.width or 0), int(request.height or 0))
        if longest >= 1080:
            return "1080P"
        if longest >= 720:
            return "720P"
    resolution = DEFAULT_RESOLUTION if DEFAULT_RESOLUTION in {"480P", "720P", "1080P"} else "480P"
    if model == "wan2.6-i2v" and resolution == "480P":
        return "720P"
    return resolution


def normalize_duration(request: VideoRequest) -> int:
    requested = int(round(float(request.duration_seconds or request.durationSeconds or DEFAULT_DURATION_SEC)))
    if requested <= 5:
        return 5
    if requested <= 10:
        return 10
    return 15


def output_path_from_entry(entry: dict[str, Any]) -> Path:
    filename = str(entry.get("filename") or "").strip()
    subfolder = str(entry.get("subfolder") or "").strip()
    kind = str(entry.get("type") or "output").strip().lower()
    root = DEFAULT_TEMP_DIR if kind == "temp" else DEFAULT_OUTPUT_DIR
    return root / subfolder / filename


def extract_video_path(history_entry: dict[str, Any], job_id: str) -> Path | None:
    outputs = history_entry.get("outputs") or {}
    for output in outputs.values():
        for key in ("videos", "gifs", "files", "images"):
            for entry in output.get(key) or []:
                path = output_path_from_entry(entry)
                if path.is_file() and path.suffix.lower() in {".mp4", ".webm", ".mov", ".mkv"}:
                    return path
    for path in DEFAULT_OUTPUT_DIR.rglob(f"*{job_id}*.mp4"):
        if path.is_file():
            return path
    return None


class ComfyWanRuntime:
    def __init__(self, comfy_url: str, public_copy_dir: Path):
        self.comfy_url = comfy_url.rstrip("/")
        self.public_copy_dir = public_copy_dir

    def health(self) -> dict[str, Any]:
        try:
            objects = http_json("GET", f"{self.comfy_url}/object_info", timeout=20)
            nodes = set(objects.keys())
            required = ["LoadImage", "WanImageToVideoApi", "SaveVideo"]
            return {
                "ok": all(name in nodes for name in required) and bool(COMFY_ORG_API_KEY),
                "service": "a11-local-comfy-wan-api-runner",
                "provider": "comfyui-wan-api",
                "comfyUrl": self.comfy_url,
                "outputDir": str(DEFAULT_OUTPUT_DIR),
                "publicCopyDir": str(self.public_copy_dir),
                "authRequired": bool(ACCESS_TOKEN),
                "apiKeyPresent": bool(COMFY_ORG_API_KEY),
                "asyncJobs": len(VIDEO_JOBS),
                "asyncWorkers": DEFAULT_JOB_WORKERS,
                "imageReferenceSupported": True,
                "nodes": {name: name in nodes for name in required},
                "model": DEFAULT_MODEL,
                "resolution": DEFAULT_RESOLUTION,
                "durationSeconds": DEFAULT_DURATION_SEC,
            }
        except Exception as exc:
            return {
                "ok": False,
                "service": "a11-local-comfy-wan-api-runner",
                "provider": "comfyui-wan-api",
                "comfyUrl": self.comfy_url,
                "authRequired": bool(ACCESS_TOKEN),
                "apiKeyPresent": bool(COMFY_ORG_API_KEY),
                "asyncJobs": len(VIDEO_JOBS),
                "asyncWorkers": DEFAULT_JOB_WORKERS,
                "imageReferenceSupported": True,
                "error": str(exc),
            }

    def upload_reference_image(self, source: str) -> str:
        filename, content, content_type = read_source_bytes(source)
        uploaded = http_post_multipart(
            f"{self.comfy_url}/upload/image",
            fields={"type": "input", "overwrite": "true"},
            files={"image": (filename, content, content_type)},
            timeout=90,
        )
        uploaded_name = str(uploaded.get("name") or uploaded.get("filename") or filename).strip()
        if not uploaded_name:
            raise RuntimeError(f"comfy_image_upload_failed: {uploaded}")
        subfolder = str(uploaded.get("subfolder") or "").strip()
        return f"{subfolder}/{uploaded_name}".strip("/")

    def build_workflow(self, request: VideoRequest, job_id: str, uploaded_image: str) -> dict[str, Any]:
        prompt = (request.prompt or request.message or "").strip()
        if not prompt:
            raise ValueError("prompt_required")
        negative = (request.negative_prompt or request.negativePrompt or "").strip()
        if not negative:
            negative = "low quality, blurry, distorted face, broken hands, unreadable text, watermark, bad anatomy"

        model = str(request.model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
        if model not in {"wan2.5-i2v-preview", "wan2.6-i2v"}:
            model = DEFAULT_MODEL
        seed = int(request.seed if request.seed is not None else random.randint(1, 2_147_483_647))

        return {
            "1": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": uploaded_image,
                },
            },
            "2": {
                "class_type": "WanImageToVideoApi",
                "inputs": {
                    "model": model,
                    "image": ["1", 0],
                    "prompt": prompt,
                    "negative_prompt": negative,
                    "resolution": normalize_resolution(request, model),
                    "duration": normalize_duration(request),
                    "seed": seed,
                    "generate_audio": False,
                    "prompt_extend": True,
                    "watermark": False,
                    "shot_type": "single",
                    "api_key_comfy_org": COMFY_ORG_API_KEY,
                    "unique_id": job_id,
                },
            },
            "3": {
                "class_type": "SaveVideo",
                "inputs": {
                    "video": ["2", 0],
                    "filename_prefix": f"a11-comfy-wan/{job_id}",
                    "format": "mp4",
                    "codec": "h264",
                },
            },
        }

    def generate(self, request: VideoRequest) -> dict[str, Any]:
        if not COMFY_ORG_API_KEY:
            raise ValueError("comfy_org_api_key_missing")
        source = request_reference_image_source(request)
        if not source:
            raise ValueError("reference_image_required_for_comfy_wan")

        prompt_text = (request.prompt or request.message or "").strip()
        if not prompt_text:
            raise ValueError("prompt_required")

        job_id = f"wan-{int(time.time())}-{uuid.uuid4().hex[:8]}"
        uploaded_image = self.upload_reference_image(source)
        workflow = self.build_workflow(request, job_id, uploaded_image)
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
                video_path = extract_video_path(history_entry, job_id)
                if video_path:
                    public_path = self.copy_to_public_dir(video_path)
                    return {
                        "ok": True,
                        "tool": "generate_video",
                        "provider": "comfyui-wan-api",
                        "model": model_for_result(workflow),
                        "prompt": prompt_text,
                        "prompt_id": prompt_id,
                        "video_path": str(public_path),
                        "outputPath": str(public_path),
                        "path": str(public_path),
                        "localComfyPath": str(video_path),
                        "filename": public_path.name,
                        "imageReferenceSupported": True,
                    }
            time.sleep(4)

        raise TimeoutError(f"comfy_wan_timeout: prompt_id={prompt_id} status={last_status}")

    def copy_to_public_dir(self, source: Path) -> Path:
        target_dir = self.public_copy_dir / time.strftime("%Y%m%d")
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / source.name
        shutil.copy2(source, target)
        return target


def model_for_result(workflow: dict[str, Any]) -> str:
    return str(workflow.get("2", {}).get("inputs", {}).get("model") or DEFAULT_MODEL)


def build_app(runtime: ComfyWanRuntime) -> FastAPI:
    app = FastAPI(title="A11 Local Comfy Wan API Runner")
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
                    "error": "local_comfy_wan_failed",
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
    parser.add_argument("--host", default=os.environ.get("A11_COMFY_WAN_RUNNER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("A11_COMFY_WAN_RUNNER_PORT", "17882")))
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    parser.add_argument("--public-copy-dir", default=str(DEFAULT_PUBLIC_COPY_DIR))
    args = parser.parse_args()

    runtime = ComfyWanRuntime(comfy_url=args.comfy_url, public_copy_dir=Path(args.public_copy_dir))
    uvicorn.run(build_app(runtime), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
