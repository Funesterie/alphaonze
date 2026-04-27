# Local Vision With Janus

This folder hosts the optional local multimodal vision stack for A11.

Important compatibility note:

- the backend SD venv currently ships `transformers 5.x`
- Janus is more reliable here in a dedicated `tools/vision/venv`
- the Janus runtime therefore prefers `tools/vision/venv` first, then falls back to the SD venv only if needed

Default local model:

- default local runtime: `deepseek-ai/Janus-Pro-1B` on CPU
- optional GPU override: `deepseek-ai/Janus-Pro-7B`

Why CPU by default now:

- it leaves VRAM available for Stable Diffusion and local LLM traffic
- it avoids a persistent Janus worker sitting on CUDA between requests
- you can still force `A11_JANUS_DEVICE=cuda` and `A11_JANUS_PREFER_LATEST=true` when the machine has headroom

Recommended env:

```env
A11_VISION_PROVIDER=janus
A11_JANUS_ENABLED=true
A11_JANUS_MODEL_ID=deepseek-ai/Janus-Pro-1B
A11_JANUS_PYTHON_PATH=D:\funesterie\a11\backend\apps\server\tools\vision\venv\Scripts\python.exe
A11_JANUS_DEVICE=cpu
A11_JANUS_TORCH_DTYPE=auto
A11_JANUS_PREFER_LATEST=false
```

Optional GPU override:

```env
A11_JANUS_MODEL_ID=deepseek-ai/Janus-Pro-7B
A11_JANUS_DEVICE=cuda
A11_JANUS_PREFER_LATEST=true
```

Recommended Railway/Linux env with the bundled Docker Janus venv:

```env
A11_VISION_PROVIDER=janus
A11_JANUS_ENABLED=true
A11_JANUS_PYTHON_PATH=/opt/janus-venv/bin/python
A11_JANUS_MODEL_ID=deepseek-ai/Janus-Pro-1B
A11_JANUS_DEVICE=cpu
A11_JANUS_TORCH_DTYPE=auto
A11_VISION_BASE_URL=https://api.openai.com/v1
A11_VISION_API_KEY=sk-...
A11_VISION_MODEL=gpt-4o-mini
A11_OPENAI_API_KEY=sk-...
A11_OPENAI_BASE_URL=https://api.openai.com/v1
A11_OPENAI_MODEL=gpt-4o-mini
A11_TRANSLATION_API_KEY=sk-...
A11_TRANSLATION_BASE_URL=https://api.openai.com/v1
A11_TRANSLATION_MODEL=gpt-4o-mini
A11_WAZAA_LLM_ENRICH=true
```

Notes for Railway:

- the Docker image can now bundle a dedicated `/opt/janus-venv`
- `Janus-Pro-1B` remains the realistic default on CPU-only containers
- keep an OpenAI-compatible fallback configured for translation and remote vision judge
- first Janus request may still download model weights unless you bake or mount them separately

Recommended install in the dedicated Janus venv:

```powershell
D:\funesterie\a11\backend\apps\server\tools\sd\venv\Scripts\python.exe -m venv D:\funesterie\a11\backend\apps\server\tools\vision\venv
# Optional: reuse heavy torch packages from the SD venv
'D:\funesterie\a11\backend\apps\server\tools\sd\venv\Lib\site-packages' | Set-Content D:\funesterie\a11\backend\apps\server\tools\vision\venv\Lib\site-packages\a11_backend_sd_sitepackages.pth
D:\funesterie\a11\backend\apps\server\tools\vision\venv\Scripts\python.exe -m pip install -U pip
D:\funesterie\a11\backend\apps\server\tools\vision\venv\Scripts\python.exe -m pip install -r D:\funesterie\a11\backend\apps\server\tools\vision\requirements.txt
```

Model download example:

```powershell
@'
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="deepseek-ai/Janus-Pro-7B",
    local_dir=r"D:\funesterie\a11\backend\apps\server\tools\vision\models\Janus-Pro-7B",
    local_dir_use_symlinks=False,
)
'@ | D:\funesterie\a11\backend\apps\server\tools\sd\venv\Scripts\python.exe -
```

The local Janus provider is used for:

- image judge memory
- generic `vision_analyze`

Stable Diffusion generation remains separate.
