from datetime import datetime, timezone
import base64
import io
import json
from typing import Optional
import os

import gradio as gr
import huggingface_hub
import httpx
from PIL import Image


APP_VERSION = "0.3.0"

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

A11_API_BASE = (os.environ.get("A11_API_BASE") or "https://api.funesterie.pro").rstrip("/")
A11_CHAT_ENDPOINT = f"{A11_API_BASE}/api/ai/chat"
A11_UPLOAD_ENDPOINT = f"{A11_API_BASE}/api/upload/image-local"
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
    """Upload l'image sur le backend local, retourne l'URL publique."""
    try:
        resp = httpx.post(
            A11_UPLOAD_ENDPOINT,
            json={"contentBase64": image_to_base64(image), "filename": "space-upload.png"},
            headers=auth_headers(),
            timeout=30,
        )
        if resp.is_success:
            data = resp.json()
            url = data.get("url", "")
            if url:
                return f"{A11_API_BASE}{url}" if url.startswith("/") else url
    except Exception:
        pass
    return None


def build_user_content(prompt: str, image: Optional[Image.Image], image_url: Optional[str]) -> str:
    size_hint = " [size:512x512]"
    if image_url:
        return f"[image:{image_url}] {prompt}{size_hint}"
    if image:
        return f"[image-data:{image_to_base64(image)}] {prompt}{size_hint}"
    return prompt + size_hint


def resolve_output_image(data: dict) -> Optional[str]:
    """Extrait l'URL de l'image générée depuis la réponse backend."""
    for key in ("image_url", "imageUrl", "imagePath", "url"):
        val = data.get(key)
        if val and isinstance(val, str):
            return val
    choices = data.get("choices") or []
    if choices:
        content = (choices[0].get("message") or {}).get("content") or ""
        if "![" in content:
            import re
            m = re.search(r"!\[.*?\]\((.*?)\)", content)
            if m:
                return m.group(1)
    return None


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

    # Upload l'image si présente
    image_url = None
    if source_image is not None:
        image_url = upload_image(source_image)

    user_content = build_user_content(cleaned_prompt, source_image, image_url)

    style_hint = "" if style_preset == "Aucun preset" else f" Style: {style_preset}."
    system_prompt = {
        "chat": "Tu es A-11, assistant concis et direct.",
        "image": f"Tu es A-11. Genere une image 512x512 de haute qualite a partir du prompt utilisateur.{style_hint} Utilise une taille de 512x512 pixels.",
        "video": f"Tu es A-11. Genere une video 512x512 a partir du prompt utilisateur.{style_hint} Utilise une taille de 512x512 pixels.",
    }.get(request_mode, "Tu es A-11, assistant concis et direct.")

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    generated_image = None
    try:
        resp = httpx.post(
            A11_CHAT_ENDPOINT,
            json={
                "messages": messages,
                "provider": "local",
                "stream": False,
                "sourceImageUrl": image_url,
                "model_profile": "sd35turbo",
                "width": 512,
                "height": 512,
            },
            headers=auth_headers(),
            timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()

        reply = (
            data.get("content")
            or (data.get("choices") or [{}])[0].get("message", {}).get("content")
            or ""
        )
        status = f"✅ HTTP {resp.status_code}"

        # Récupérer l'image générée
        out_url = resolve_output_image(data)
        if out_url:
            if out_url.startswith("/"):
                out_url = f"{A11_API_BASE}{out_url}"
            try:
                img_resp = httpx.get(out_url, timeout=30)
                if img_resp.is_success:
                    generated_image = Image.open(io.BytesIO(img_resp.content))
            except Exception:
                pass

    except httpx.HTTPStatusError as exc:
        reply = f"Erreur HTTP {exc.response.status_code}: {exc.response.text[:400]}"
        status = f"❌ HTTP {exc.response.status_code}"
    except Exception as exc:
        reply = f"Erreur: {exc}"
        status = f"❌ {type(exc).__name__}"

    summary = "\n\n".join(filter(None, [
        f"**{status}** — `{A11_API_BASE}`",
        f"**Mode:** `{request_mode}` | **Preset:** `{style_preset}`",
        f"**Image uploadée:** `{image_url}`" if image_url else None,
        reply or None,
    ]))

    debug = json.dumps(
        {"endpoint": A11_CHAT_ENDPOINT, "image_url": image_url, "messages": messages},
        ensure_ascii=False, indent=2
    )

    return summary, debug, generated_image or source_image


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
        f"- huggingface_hub: `{snapshot['huggingface_hub']}`",
        f"- Version A11 Space: `{snapshot['app_version']}`",
        f"- API: `{snapshot['api_base']}`",
    ])
    return summary, json.dumps(snapshot, ensure_ascii=False, indent=2)


with gr.Blocks(title="A11", css=CSS) as demo:
    gr.HTML("""
        <div class="a11-shell">
          <span class="a11-kicker">A11 Space</span>
          <h1>A11</h1>
          <p class="a11-muted">Génération image et vidéo via ta machine locale.</p>
        </div>
    """)

    with gr.Tab("Cockpit"):
        with gr.Row():
            with gr.Column(scale=3):
                prompt = gr.Textbox(
                    label="Prompt",
                    placeholder="Ex: genere une image de ce portrait au style dragon ball z",
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
                launch = gr.Button("🚀 Lancer A11", variant="primary")

            with gr.Column(scale=2):
                summary = gr.Markdown(label="Statut")
                result_image = gr.Image(label="Image générée", type="pil")
                payload = gr.Code(label="Debug", language="json")

        gr.Examples(
            examples=[
                ["genere une image de ce portrait au style dragon ball z", "image", "Anime energy", 0.55],
                ["prepare une video courte a partir de cette photo avec une aura rouge", "video", "A11 cinematic", 0.4],
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
