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

Those heavy assets stay in the separate local `a11llm` workspace on Windows.

## Recommended usage

- Local Windows support runtime:
  keep the Python venv in `a11llm/scripts/venv`
- Public Railway backend:
  prefer `A11_SD_PROXY_URL=https://sd.funesterie.me/api/tools/generate_sd`
  instead of shipping heavy SD dependencies in Railway

## Optional Python packages

If you want to run the script directly, install at least:

- `torch`
- `diffusers`
- `accelerate`
- `safetensors`
