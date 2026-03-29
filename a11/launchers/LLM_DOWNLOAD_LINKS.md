# A11 Local Downloads

These large assets stay outside the backend repo and outside Tauri.

## llama.cpp binaries

- Official releases:
  https://github.com/ggerganov/llama.cpp/releases

## GGUF models

- Hugging Face GGUF search:
  https://huggingface.co/models?search=gguf
- Llama 3.2 search:
  https://huggingface.co/models?search=Llama-3.2-3B-Instruct%20GGUF

## Local target paths used by A11

- `D:\funesterie\a11\a11llm\llm\server\llama-server.exe`
- `D:\funesterie\a11\a11llm\llm\models\Llama-3.2-3B-Instruct-Q4_K_M.gguf`
- `D:\funesterie\a11\a11llm\scripts\venv\Scripts\python.exe`

## Architecture reminder

- Keep heavy models, `llama.cpp`, and Python venvs in `a11llm`
- Keep lightweight backend scripts in `a11backendrailway/apps/server`
- Do not bundle GGUF assets into Tauri until the desktop is stable enough for a tagged release
