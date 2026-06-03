#!/usr/bin/env python
"""Small A11 HTTP wrapper around the Genmo Mochi CLI/runtime.

This runner is intentionally local-only by default. A11 talks to it through
A11_VIDEO_LOCAL_RUNNER_URL, then rewrites generated/videos paths to a public URL.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path
from typing import Any

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel, Field
    import uvicorn
except Exception as exc:  # pragma: no cover - startup guard
    print(f"Missing web runner dependency: {exc}", file=sys.stderr)
    raise


DEFAULT_WEIGHTS_DIR = Path(os.environ.get("A11_VIDEO_LOCAL_WEIGHTS_DIR", r"E:\Funesterie\models\video\weights"))
DEFAULT_GENMO_REPO = Path(os.environ.get("A11_MOCHI_REPO_DIR", r"E:\Funesterie\models\video\genmo-models"))
DEFAULT_OUTPUT_DIR = Path(os.environ.get("A11_MOCHI_OUTPUT_DIR", r"E:\Funesterie\models\video\generated\videos"))
DEFAULT_MAX_FRAMES = int(os.environ.get("A11_MOCHI_MAX_FRAMES", "31"))
DEFAULT_STEPS = int(os.environ.get("A11_MOCHI_STEPS", "24"))


class VideoRequest(BaseModel):
    prompt: str = Field(default="")
    message: str = Field(default="")
    negativePrompt: str = Field(default="")
    negative_prompt: str = Field(default="")
    durationSeconds: float = Field(default=2)
    duration_seconds: float | None = None
    fps: int = Field(default=6)
    width: int = Field(default=848)
    height: int = Field(default=480)
    seed: int | None = None
    cfgScale: float = Field(default=6.0)
    cfg_scale: float | None = None
    steps: int | None = None
    num_steps: int | None = None
    num_frames: int | None = None


def normalize_num_frames(request: VideoRequest) -> int:
    if request.num_frames:
        frames = int(request.num_frames)
    else:
        duration = float(request.duration_seconds or request.durationSeconds or 2)
        frames = max(7, int(round(duration * max(1, int(request.fps or 6)))))

    frames = min(max(7, frames), DEFAULT_MAX_FRAMES)
    remainder = (frames - 1) % 6
    if remainder:
        frames += 6 - remainder
    return min(frames, DEFAULT_MAX_FRAMES)


def add_genmo_to_path(repo_dir: Path) -> None:
    src = repo_dir / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


class MochiRuntime:
    def __init__(self, weights_dir: Path, repo_dir: Path, output_dir: Path, cpu_offload: bool = True):
        self.weights_dir = weights_dir
        self.repo_dir = repo_dir
        self.output_dir = output_dir
        self.cpu_offload = cpu_offload
        self._loaded = False
        self._cli: Any = None

    def health(self) -> dict[str, Any]:
        files = ["dit.safetensors", "encoder.safetensors", "decoder.safetensors"]
        return {
            "ok": True,
            "service": "a11-local-mochi-runner",
            "weightsDir": str(self.weights_dir),
            "repoDir": str(self.repo_dir),
            "outputDir": str(self.output_dir),
            "weightsPresent": {name: (self.weights_dir / name).is_file() for name in files},
            "loaded": self._loaded,
        }

    def load(self) -> None:
        if self._loaded:
            return
        if not self.repo_dir.exists():
            raise RuntimeError(f"Genmo repo missing: {self.repo_dir}")
        add_genmo_to_path(self.repo_dir)
        import demos.cli as mochi_cli  # type: ignore

        mochi_cli.configure_model(str(self.weights_dir), None, self.cpu_offload)
        self._cli = mochi_cli
        self._loaded = True

    def generate(self, request: VideoRequest) -> dict[str, Any]:
        prompt = (request.prompt or request.message or "").strip()
        if not prompt:
            raise ValueError("prompt_required")

        self.load()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        seed = int(request.seed if request.seed is not None else random.randint(1, 2_147_483_647))
        cfg_scale = float(request.cfg_scale or request.cfgScale or 6.0)
        steps = int(request.num_steps or request.steps or DEFAULT_STEPS)
        negative = (request.negative_prompt or request.negativePrompt or "").strip()

        output_path = self._cli.generate_video(
            prompt=prompt,
            negative_prompt=negative,
            width=int(request.width or 848),
            height=int(request.height or 480),
            num_frames=normalize_num_frames(request),
            seed=seed,
            cfg_scale=cfg_scale,
            num_inference_steps=steps,
            output_dir=str(self.output_dir),
        )
        return {
            "ok": True,
            "tool": "generate_video",
            "provider": "local-mochi",
            "model": "genmo/mochi-1-preview",
            "video_path": str(output_path),
            "path": str(output_path),
            "seed": seed,
            "prompt": prompt,
        }


def build_app(runtime: MochiRuntime) -> FastAPI:
    app = FastAPI(title="A11 Local Mochi Runner")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return runtime.health()

    @app.post("/api/tools/generate_video")
    def generate_video(request: VideoRequest) -> dict[str, Any]:
        try:
            return runtime.generate(request)
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "ok": False,
                    "error": "local_mochi_runner_failed",
                    "message": str(exc),
                },
            ) from exc

    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("A11_MOCHI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("A11_MOCHI_PORT", "17880")))
    parser.add_argument("--weights-dir", default=str(DEFAULT_WEIGHTS_DIR))
    parser.add_argument("--repo-dir", default=str(DEFAULT_GENMO_REPO))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--no-cpu-offload", action="store_true")
    args = parser.parse_args()

    runtime = MochiRuntime(
        weights_dir=Path(args.weights_dir),
        repo_dir=Path(args.repo_dir),
        output_dir=Path(args.output_dir),
        cpu_offload=not args.no_cpu_offload,
    )
    app = build_app(runtime)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
