# Local Vision With Janus

This folder hosts the optional local multimodal vision stack for A11.

Important compatibility note:

- the backend SD venv currently ships `transformers 5.x`
- Janus is more reliable here in a dedicated `tools/vision/venv`
- the Janus runtime therefore prefers `tools/vision/venv` first, then falls back to the SD venv only if needed

Default local model:

- `deepseek-ai/Janus-Pro-1B`

Why `1B` by default:

- it is realistic on a local `12 GB` GPU
- `Janus-Pro-7B` is still available through env override if the machine can handle it

Recommended env:

```env
A11_VISION_PROVIDER=janus
A11_JANUS_ENABLED=true
A11_JANUS_MODEL_DIR=D:\funesterie\a11\backend\apps\server\tools\vision\models\Janus-Pro-1B
A11_JANUS_PYTHON_PATH=D:\funesterie\a11\backend\apps\server\tools\vision\venv\Scripts\python.exe
A11_JANUS_DEVICE=cuda
A11_JANUS_TORCH_DTYPE=auto
```

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
    repo_id="deepseek-ai/Janus-Pro-1B",
    local_dir=r"D:\funesterie\a11\backend\apps\server\tools\vision\models\Janus-Pro-1B",
    local_dir_use_symlinks=False,
)
'@ | D:\funesterie\a11\backend\apps\server\tools\sd\venv\Scripts\python.exe -
```

The local Janus provider is used for:

- image judge memory
- generic `vision_analyze`

Stable Diffusion generation remains separate.
