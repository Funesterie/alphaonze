from datetime import datetime, timezone
import base64
import io
import json
import time
from typing import Optional
import os

import gradio as gr
import huggingface_hub
import httpx
from PIL import Image


APP_VERSION = "0.4.0"

CSS = """
:root {
  --a11-bg-1: #08111f;
  --a11-bg-2: #13233f;
  --a11-panel: rgba(8, 17, 31, 0.78);
  --a11-line: rgba(130, 192, 255, 0.22);
  --a11-accent: #8dd0ff;
  --a11-accent-2: #53f0c7;
  --a11-text: #f3f7ff;
  --a11-muted: #9cb7d6;
}
.gradio-container {
  background:
    radial-gradient(circle at top left, rgba(83, 240, 199, 0.18), transparent 28%),
    radial-gradient(circle at top right, rgba(141, 208, 255, 0.18), transparent 25%),
    linear-gradient(145deg, var(--a11-bg-1), var(--a11-bg-2));
  color: var(--a11-text);
}
.a11-shell {
  border: 1px solid var(--a11-line);
  border-radius: 24px;
  padding: 20px;
  background: var(--a11-panel);
  backdrop-filter: blur(14px);
}
.a11-kicker {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(83, 240, 199, 0.12);
  border: 1px solid rgba(83, 240, 199, 0.2);
  color: var(--a11-accent-2);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.a11-muted { color: var(--a11-muted); }
"""

A11_API_BASE = (os.environ.get("A11_API_BASE") or "https://a11.funesterie.me").rstrip("/")
A11_CHAT_ENDPOINT = f"{A11_API_BASE}/api/ai/chat"
A11_UPLOAD_ENDPOINT = f"{A11_API_BASE}/api/upload/image-local"
A11_SD_JOB_ENDPOINT = f"{A11_API_BASE}/api/jobs/sd"
A11_JWT_TOKEN = os.environ.get("A11_JWT_TOKEN") or ""


def auth_headers() -> dict:
    if A11_JWT_TOKEN:
        return {"Authorization": f"Bearer {A11_JWT_TOKEN}"}
    return {}


def image_to_base64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def upload_image(image: Image.Image) -> Optional[str]:
    try:
        resp = httpx.post(
            A11_UPLOAD_ENDPOINT,
            json={"contentBase64": image_to_base64(image), "filename": "space-upload.png"},
            headers=auth_headers(),
            timeout=30,
        )
        if resp.is_success:
            url = resp.json().get("url", "")
            if url:
                return f"{A11_API_BASE}{url}" if url.startswith("/") else url
    except Exception:
        pass
    return None


def fetch_image_from_url(url: str) -> Optional[Image.Image]:
    try:
        if url.startswith("/"):
            url = f"{A11_API_BASE}{url}"
        r = httpx.get(url, headers=auth_headers(), timeout=30)
        if r.is_success:
            return Image.open(io.BytesIO(r.content))
    except Exception:
        pass
    return None


def call_image_async(prompt: str, init_image_url: Optional[str] = None) -> tuple[str, Optional[Image.Image]]:
    """Lance SD via job async, poll toutes les 5s jusqu'a 4 minutes."""
    body = {
        "prompt": prompt,
        "width": 512,
        "height": 512,
        "model_profile": "sd35turbo",
        "num_inference_steps": 8,
    }
    if init_image_url:
        body["init_image_url"] = init_image_url

    try:
        # 1. Lance le job, retour immediat
        resp = httpx.post(A11_SD_JOB_ENDPOINT, json=body, headers=auth_headers(), timeout=15)
        resp.raise_for_status()
        job_id = resp.json().get("jobId")
        if not job_id:
            return "Pas de jobId retourne", None

        # 2. Poll toutes les 5s, max 72 fois = 6 minutes
        for attempt in range(72):
            time.sleep(5)
            try:
                poll = httpx.get(
                    f"{A11_SD_JOB_ENDPOINT}/{job_id}",
                    headers=auth_headers(),
                    timeout=10,
                )
                if not poll.is_success:
                    continue
                data = poll.json()
                status = data.get("status")

                if status == "done":
                    result = data.get("result") or {}
                    out_url = result.get("image_url") or result.get("url") or ""
                    img = fetch_image_from_url(out_url) if out_url else None
                    label = f"OK apres {(attempt + 1) * 5}s"
                    return label, img

                if status == "error":
                    return f"Erreur SD: {data.get('error', 'unknown')}", None

            except Exception:
                continue

        return "Timeout (6 min depasse)", None

    except httpx.HTTPStatusError as exc:
        return f"HTTP {exc.response.status_code}: {exc.response.text[:300]}", None
    except Exception as exc:
        return f"{type(exc).__name__}: {exc}", None


def build_preview(
    prompt: str,
    request_mode: str,
    style_preset: str,
    creativity: float,
    source_image: Optional[Image.Image],
):
    cleaned_prompt = (prompt or "").strip()
    if not cleaned_prompt:
        raise gr.Error("Ajoute un prompt avant de lancer A11.")

    image_url = None
    if source_image is not None:
        image_url = upload_image(source_image)

    if request_mode in ("image", "video"):
        style_hint = "" if style_preset == "Aucun preset" else f", style {style_preset}"
        full_prompt = f"{cleaned_prompt}{style_hint}"
        status_text, generated_image = call_image_async(full_prompt, init_image_url=image_url)
        summary = "\n\n".join(filter(None, [
            f"**{status_text}**",
            f"**Mode:** `{request_mode}` | **Preset:** `{style_preset}`",
            f"**Image uploadee:** `{image_url}`" if image_url else None,
        ]))
        debug = json.dumps(
            {"endpoint": A11_SD_JOB_ENDPOINT, "prompt": full_prompt},
            ensure_ascii=False, indent=2
        )
        return summary, debug, generated_image

    # Mode chat
    style_hint = "" if style_preset == "Aucun preset" else f" Style: {style_preset}."
    system_prompt = f"Tu es A-11, assistant concis et direct.{style_hint}"
    user_content = f"[image:{image_url}] {cleaned_prompt}" if image_url else cleaned_prompt
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    try:
        resp = httpx.post(
            A11_CHAT_ENDPOINT,
            json={"messages": messages, "provider": "local", "stream": False},
            headers=auth_headers(),
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        reply = (
            data.get("content")
            or (data.get("choices") or [{}])[0].get("message", {}).get("content")
            or ""
        )
        status = f"HTTP {resp.status_code}"
    except httpx.HTTPStatusError as exc:
        reply = f"Erreur HTTP {exc.response.status_code}: {exc.response.text[:300]}"
        status = f"HTTP {exc.response.status_code}"
    except Exception as exc:
        reply = f"Erreur: {exc}"
        status = f"{type(exc).__name__}"

    summary = "\n\n".join(filter(None, [
        f"**{status}** - `{A11_API_BASE}`",
        f"**Mode:** `chat` | **Preset:** `{style_preset}`",
        reply or None,
    ]))
    debug = json.dumps({"endpoint": A11_CHAT_ENDPOINT, "messages": messages}, ensure_ascii=False, indent=2)
    return summary, debug, None


def runtime_snapshot():
    snapshot = {
        "app_version": APP_VERSION,
        "gradio": gr.__version__,
        "huggingface_hub": huggingface_hub.__version__,
        "api_base": A11_API_BASE,
        "utc_now": datetime.now(timezone.utc).isoformat(),
    }
    summary = "\n".join([
        "## Runtime",
        f"- Gradio: `{snapshot['gradio']}`",
        f"- Version A11 Space: `{snapshot['app_version']}`",
        f"- API: `{snapshot['api_base']}`",
    ])
    return summary, json.dumps(snapshot, ensure_ascii=False, indent=2)


with gr.Blocks(title="A11", css=CSS) as demo:
    gr.HTML("""
        <div class="a11-shell">
          <span class="a11-kicker">A11 Space</span>
          <h1>A11</h1>
          <p class="a11-muted">Generation image et video via ta machine locale.</p>
        </div>
    """)

    with gr.Tab("Cockpit"):
        with gr.Row():
            with gr.Column(scale=3):
                prompt = gr.Textbox(
                    label="Prompt",
                    placeholder="Ex: genere une image de zelda et mario qui se tiennent la main",
                    lines=4,
                )
                with gr.Row():
                    request_mode = gr.Radio(
                        ["chat", "image", "video"],
                        value="image",
                        label="Mode",
                    )
                    style_preset = gr.Dropdown(
                        choices=["Aucun preset", "A11 cinematic", "Anime energy", "Photoreal clean"],
                        value="Anime energy",
                        label="Preset",
                    )
                creativity = gr.Slider(minimum=0.0, maximum=1.0, value=0.45, step=0.05, label="Creativite")
                source_image = gr.Image(label="Image de reference", type="pil", sources=["upload", "clipboard"])
                launch = gr.Button("Lancer A11", variant="primary")

            with gr.Column(scale=2):
                summary = gr.Markdown(label="Statut")
                result_image = gr.Image(label="Image generee", type="pil")
                payload = gr.Code(label="Debug", language="json")

        gr.Examples(
            examples=[
                ["genere zelda et mario qui se tiennent la main", "image", "Anime energy", 0.55],
                ["prepare une video courte avec une aura rouge", "video", "A11 cinematic", 0.4],
                ["resume ce concept et propose une reponse claire", "chat", "Aucun preset", 0.2],
            ],
            inputs=[prompt, request_mode, style_preset, creativity],
        )

        launch.click(
            build_preview,
            inputs=[prompt, request_mode, style_preset, creativity, source_image],
            outputs=[summary, payload, result_image],
            api_name=False,
            show_api=False,
        )

    with gr.Tab("Runtime"):
        refresh = gr.Button("Actualiser")
        runtime_md = gr.Markdown()
        runtime_json = gr.Code(label="Runtime JSON", language="json")
        refresh.click(runtime_snapshot, outputs=[runtime_md, runtime_json], api_name=False, show_api=False)
        demo.load(runtime_snapshot, outputs=[runtime_md, runtime_json], api_name=False, show_api=False)


if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860, show_api=False)
