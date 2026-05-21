# A11 Architecture Reference

## Goal
Build a modular AI system with:
- local LLM (GGUF)
- local TTS (voice)
- central backend router (A11)
- frontend interface

## Project Structure

D:/funesterie/a11
- llm/: text generation stack (GGUF / llama.cpp)
- backend/: A11 API (Railway)
- frontend/: UI app (Netlify)
- launchers/: orchestration locale transverse

Important:

- `backend` ne doit pas embarquer le frontend source
- le frontend canonique vit dans `frontend/apps/web`

## 1) LLM Layer (llm)

Role:
- Generate text responses.

Typical content:
- models/: .gguf files
- server/: llama.cpp server binaries
- start script

Typical endpoint:
- http://localhost:8080/completion

Notes:
- GGUF quantization Q4 is a practical default.
- CPU mode is acceptable.
- External access must use a secure tunnel (ngrok or Cloudflare Tunnel).

## 2) TTS Layer (tts)

Role:
- Convert text to audio.

Typical content:
- models/: voice models
- server/: TTS engine runtime (for example Piper)
- start script

Typical endpoint:
- http://localhost:5002/tts

Notes:
- Must remain independent from the LLM process.
- Usually called after text completion.

## 3) Backend Layer (A11 on Railway)

Role:
- Intelligent routing between providers:
  - cloud provider (OpenAI)
  - local LLM (GGUF through tunnel)
  - optional additional providers

Key variables:
- LLM_ROUTER_URL=https://cerbere.example.com
- LOCAL_LLM_URL=https://llm.example.com
- A11_ALLOW_PUBLIC_TUNNEL_LLM=1
# OPENAI_API_KEY is configured via the deployment secret store.
- TTS_BASE_URL=... (optional, for externalized TTS)

Routing behavior:
- if provider=local, call Cerbere or the GGUF/local route
- otherwise use cloud provider route

Important:
- do not point `LLM_ROUTER_URL` to the public A11 API hostname
- do not reuse the frontend/API hostname for the LLM tunnel
- prefer a dedicated tunnel hostname for Cerbere (`4545`) and, only if needed, another one for llama-server (`8080`)

## 4) Frontend Layer (Netlify)

Role:
- User interface and interaction.

Key variable:
- VITE_API_URL=https://a11.funesterie.me

Compatibility:
- frontend also supports VITE_API_BASE_URL for backward compatibility.

Canonical location:
- `D:/funesterie/a11/frontend/apps/web`

## End-to-End Flow

User
-> Frontend (Netlify)
-> Backend A11 (Railway)
-> Cerbere (via dedicated tunnel)
-> Local LLM (GGUF)
-> Text response
-> optional TTS synthesis
-> Audio playback

## Autonomous Action System

The canonical name for the goal-to-action runtime is documented in:

```text
a11/backend/apps/server/A11_AUTONOMOUS_ACTION_SYSTEM.md
```

Short form:

```text
User / Goal
-> A11-Droid
-> A11-Planner / World_Context
-> Cerbere
-> A11-Plan-Executor
-> QFlush / Horn
-> Tools / Skills / Agents
-> Neo4j + Corpus + episodic memory
```

`World_Context` is the planning brain. QFlush, Spyder and Cortex are technical
orchestration layers inside the larger A11 Autonomous Action System.

## Operating Rules

Do not:
- merge llm and tts into one service
- run GGUF inference directly on Railway

Do:
- route all inference through backend A11
- keep tunnel active for local LLM access
- expose one API base URL to frontend

## Design Philosophy

- LLM: reasoning brain
- TTS: voice layer
- Backend: orchestration and routing
- Frontend: interaction layer

## Final Target

- autonomous local-first system
- cloud fallback when needed
- strict modularity
- future extensibility (vision, tools, automation)
