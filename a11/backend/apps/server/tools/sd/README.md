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

- Default local profile: `SD_MODEL_PROFILE=sd35`
  uses `stabilityai/stable-diffusion-3.5-medium`.
- This gives A11 a much stronger default raster model than SD 1.5, but the first
  download may require Hugging Face access to the Stability AI model card.
- Multilingual legacy profile: `SD_MODEL_PROFILE=multilingual`
  uses `BAAI/AltDiffusion-m18`, which is designed for multilingual prompts including French.
- Legacy profile: `SD_MODEL_PROFILE=classic`
  uses `runwayml/stable-diffusion-v1-5`.
- You can still override everything with `SD_MODEL_ID=<hugging-face-repo-id>`.

## RTX 5070 local tuning

For the current Windows local box with an RTX 5070 12 GB, keep Janus on CPU and
run SD through the Torch/CUDA path:

```env
SD_MODEL_PROFILE=sd35
SD_DEVICE=cuda
SD_TORCH_DTYPE=float16
A11_SD_GPU_SETTLE_MS=1200
SD_SD3_EXECUTION_MODE=model_cpu_offload
SD_ENABLE_ATTENTION_SLICING=true
SD_ENABLE_CHANNELS_LAST=true
SD_ENABLE_XFORMERS=false
```

`model_cpu_offload` is the balanced SD3.5 mode for 12 GB VRAM on Windows: much
less conservative than sequential offload, but still safer than loading the
whole SD3 stack directly onto the GPU. The 1200 ms settle gives Ollama and any
Janus worker time to release VRAM before SD starts.

## Optional Python packages

If you want to run the script directly, install at least:

- `torch`
- `diffusers`
- `accelerate`
- `safetensors`
