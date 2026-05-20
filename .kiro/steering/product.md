# Product: A11 (AlphaOnze)

A11 is a modular, local-first AI assistant built by Funesterie. It routes user requests through a central backend to either a local LLM (via Ollama or a GGUF/llama.cpp server) or a cloud provider (OpenAI), with optional TTS voice output and image/video generation via Stable Diffusion.

## Core Capabilities

- **Chat**: Conversational AI with persistent memory, conversation history, and multi-turn context
- **Image generation**: Stable Diffusion pipeline (local GPU via Windows backend, proxied through Railway in production)
- **Video generation**: Frame-by-frame SD pipeline assembled with FFmpeg/NVENC
- **TTS**: Local voice synthesis via Piper (ONNX models)
- **File handling**: Upload, OCR (Tesseract), PDF generation, artifact creation, email delivery
- **Agent actions**: Tool-calling layer (web search, file ops, SD generation, env snapshots)
- **Auth**: JWT-based login/register/password-reset with PostgreSQL user store

## Target Users

Internal/private deployment for Funesterie. The public frontend is at `a11.funesterie.me`, backed by `a11.funesterie.me`.

## Key Design Principles

- Local-first: default LLM is `gemma4:e4b` via Ollama; cloud is a fallback
- Strict modularity: LLM, TTS, image, video, and backend are independent services
- Same codebase for local dev and production — only env vars differ
- Railway (backend) is proxy-only for SD/video; actual GPU work runs on the local Windows machine
