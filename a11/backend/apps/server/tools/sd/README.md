# A11 SD Runtime

This folder contains the lightweight Stable Diffusion helper that the backend can
use locally or through a tunneled local backend.

What belongs here:

- small scripts needed by `apps/server`
- optional notes or requirements for the image runtime

What does **not** belong here:

- GGUF models
- `llama.cpp`
- Python virtual environments
- generated images

Those heavy assets stay in the separate local `llm` workspace on Windows.

## Recommended usage

- Local Windows support runtime:
  prefer the backend-owned Python venv in `apps/server/tools/sd/venv`
- Public Railway backend:
  use proxy-only mode with `A11_SD_PROXY_URL=https://sd.funesterie.me/api/tools/generate_sd`
  instead of shipping heavy SD dependencies in Railway

## Production proxy-only contract

- `A11_SD_PROXY_URL` is the source of truth for remote SD generation.
- The expected public generation route is `POST /api/tools/generate_sd`.
- `https://sd.funesterie.me/health` is only the health check for the tunnel/backend.
- Keep `A11_SD_ALLOW_LOCAL_FALLBACK=false` on Railway unless you intentionally want a different topology.
- Do not define `SD_SCRIPT_PATH` or `SD_PYTHON_PATH` on Railway.
- Do not reuse `A11_VISION_BASE_URL` for image generation. It is reserved for remote vision/OCR.

## Local backend contract

- `sd.funesterie.me` points to the local backend on port `3000` through Cloudflare Tunnel.
- The SD generation route is served by the backend itself on `POST /api/tools/generate_sd`.
- The helper in `apps/server/tools/sd` uses the backend-owned venv and can select different SD model profiles.

## Model profiles

- Default local profile: `SD_MODEL_PROFILE=multilingual`
  uses `BAAI/AltDiffusion-m18`, which is designed for multilingual prompts including French.
- Legacy profile: `SD_MODEL_PROFILE=classic`
  uses `runwayml/stable-diffusion-v1-5`.
- You can still override everything with `SD_MODEL_ID=<hugging-face-repo-id>`.

## Optional Python packages

If you want to run the script directly, install at least:

- `torch`
- `diffusers`
- `accelerate`
- `safetensors`
