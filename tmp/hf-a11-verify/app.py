from datetime import datetime, timezone
import json
from typing import Optional

import gradio as gr
import huggingface_hub
from PIL import Image


APP_VERSION = "0.2.1"

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

.a11-hero {
  margin-bottom: 12px;
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

.a11-muted {
  color: var(--a11-muted);
}
"""


def describe_image(image: Optional[Image.Image]) -> Optional[dict]:
    if image is None:
        return None
    width, height = image.size
    return {
        "width": int(width),
        "height": int(height),
        "mode": str(image.mode or "unknown"),
        "ratio": round(width / max(height, 1), 3),
    }


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

    image_meta = describe_image(source_image)
    iso_now = datetime.now(timezone.utc).isoformat()

    payload = {
        "app": "A11 Space",
        "app_version": APP_VERSION,
        "timestamp": iso_now,
        "mode": request_mode,
        "prompt": cleaned_prompt,
        "style_preset": style_preset,
        "creativity": round(float(creativity), 2),
        "has_source_image": bool(image_meta),
        "source_image": image_meta,
    }

    mode_label = {
        "chat": "assistant",
        "image": "generation d'image",
        "video": "generation video",
    }.get(request_mode, request_mode)

    style_line = "" if style_preset == "Aucun preset" else f"- Preset: `{style_preset}`"
    image_line = (
        "- Source: aucune image jointe"
        if not image_meta
        else f"- Source: image jointe `{image_meta['width']}x{image_meta['height']}` ({image_meta['mode']})"
    )

    guidance = {
        "chat": "A11 peut reformuler, structurer ou preparer une reponse avant branchement backend.",
        "image": "A11 peut transformer cette requete en payload image propre avec preservation du sujet.",
        "video": "A11 peut preparer une generation video, avec image de reference si besoin.",
    }.get(request_mode, "A11 peut preparer cette requete.")

    summary = "\n".join([
        f"## Apercu A11",
        f"- Mode: `{mode_label}`",
        f"- Prompt: `{cleaned_prompt}`",
        style_line,
        image_line,
        f"- Creativite: `{round(float(creativity), 2)}`",
        "",
        guidance,
    ]).replace("\n\n\n", "\n\n")

    return summary, json.dumps(payload, ensure_ascii=False, indent=2), source_image


def runtime_snapshot():
    snapshot = {
        "app_version": APP_VERSION,
        "gradio": gr.__version__,
        "huggingface_hub": huggingface_hub.__version__,
        "utc_now": datetime.now(timezone.utc).isoformat(),
    }
    summary = "\n".join([
        "## Runtime",
        f"- Gradio: `{snapshot['gradio']}`",
        f"- huggingface_hub: `{snapshot['huggingface_hub']}`",
        f"- Version A11 Space: `{snapshot['app_version']}`",
    ])
    return summary, json.dumps(snapshot, ensure_ascii=False, indent=2)


with gr.Blocks(title="A11", css=CSS) as demo:
    gr.HTML(
        """
        <div class="a11-shell">
          <div class="a11-hero">
            <span class="a11-kicker">A11 Space</span>
            <h1>A11</h1>
            <p class="a11-muted">
              Cockpit Gradio minimal pour tester le boot, preparer des requetes
              multimodales et valider le runtime du Space.
            </p>
          </div>
        </div>
        """
    )

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
                        choices=[
                            "Aucun preset",
                            "A11 cinematic",
                            "Anime energy",
                            "Photoreal clean",
                        ],
                        value="Anime energy",
                        label="Preset",
                    )
                creativity = gr.Slider(
                    minimum=0.0,
                    maximum=1.0,
                    value=0.45,
                    step=0.05,
                    label="Creativite",
                )
                source_image = gr.Image(
                    label="Image de reference",
                    type="pil",
                    sources=["upload", "clipboard"],
                )
                launch = gr.Button("Preparer la requete", variant="primary")
            with gr.Column(scale=2):
                summary = gr.Markdown(label="Apercu")
                payload = gr.Code(label="Payload", language="json")
                preview = gr.Image(label="Preview source", type="pil")

        gr.Examples(
            examples=[
                [
                    "genere une image de ce portrait au style dragon ball z",
                    "image",
                    "Anime energy",
                    0.55,
                ],
                [
                    "prepare une video courte a partir de cette photo avec une aura rouge",
                    "video",
                    "A11 cinematic",
                    0.4,
                ],
                [
                    "resume ce concept et propose une reponse claire",
                    "chat",
                    "Aucun preset",
                    0.2,
                ],
            ],
            inputs=[prompt, request_mode, style_preset, creativity],
        )

        launch.click(
            build_preview,
            inputs=[prompt, request_mode, style_preset, creativity, source_image],
            outputs=[summary, payload, preview],
            api_name=False,
            show_api=False,
        )

    with gr.Tab("Runtime"):
        refresh = gr.Button("Actualiser le runtime")
        runtime_md = gr.Markdown()
        runtime_json = gr.Code(label="Runtime JSON", language="json")
        refresh.click(
            runtime_snapshot,
            outputs=[runtime_md, runtime_json],
            api_name=False,
            show_api=False,
        )
        demo.load(
            runtime_snapshot,
            outputs=[runtime_md, runtime_json],
            api_name=False,
            show_api=False,
        )


if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860, show_api=False)
