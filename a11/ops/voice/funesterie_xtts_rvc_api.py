import gc
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Optional

DEVICE = os.environ.get("A11_XTTS_RVC_DEVICE", "cpu").strip() or "cpu"
if DEVICE.lower() == "cpu":
    # The upstream RVC helper checks torch.cuda before honoring the requested
    # device. Mask CUDA early so CPU mode cannot crash on GPU index parsing.
    os.environ["CUDA_VISIBLE_DEVICES"] = "-1"

import requests
import torch
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from TTS.api import TTS

if DEVICE.lower() == "cpu":
    # Some CUDA builds still report a device on Windows after import. RVC only
    # needs a boolean here, so keep CPU mode deterministic.
    torch.cuda.is_available = lambda: False


ROOT = Path(os.environ.get("A11_XTTS_RVC_ROOT", Path.cwd())).resolve()
MODELS_DIR = ROOT / "models"
XTTS_DIR = MODELS_DIR / "xtts"
VOICES_DIR = ROOT / "voices"
RVCS_DIR = ROOT / "rvcs"
OUT_DIR = Path(os.environ.get("A11_XTTS_RVC_OUT_DIR", ROOT / "outputs")).resolve()
LANGUAGE = os.environ.get("A11_XTTS_RVC_LANGUAGE", "fr").strip() or "fr"
INDEX_RATE = float(os.environ.get("A11_XTTS_RVC_INDEX_RATE", "0.75") or "0.75")
HOST = os.environ.get("A11_XTTS_RVC_HOST", "127.0.0.1")
PORT = int(os.environ.get("A11_XTTS_RVC_PORT", "5000") or "5000")
PERSONA_MANIFEST_PATH = Path(
    os.environ.get("A11_XTTS_RVC_PERSONA_MANIFEST", RVCS_DIR / "funesterie-personas.json")
).resolve()

DEFAULT_PERSONA_MANIFEST = {
    "terminator": {
        "persona": "a11",
        "voice": "a11-terminator.wav",
        "rvc": "a11-terminator.pth",
        "index": "a11-terminator.index",
    },
    "donna": {
        "persona": "kaen44",
        "voice": "kaen44-donna.wav",
        "rvc": "kaen44-donna.pth",
        "index": "kaen44-donna.index",
    },
    "vivy": {
        "persona": "vivy",
        "voice": "vivy.wav",
        "rvc": "vivy.pth",
        "index": "vivy.index",
    },
}

for item in (XTTS_DIR, VOICES_DIR, RVCS_DIR, OUT_DIR):
    item.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Funesterie XTTS/RVC Bridge", version="0.1.0")

_tts = None
_hubert_model = None
_rvc_config = None
_rvc_data = None


def download_file(url: str, target: Path) -> None:
    if target.exists() and target.stat().st_size > 0:
        return
    response = requests.get(url, timeout=180)
    response.raise_for_status()
    target.write_bytes(response.content)


def ensure_models() -> None:
    rvc_base = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main"
    xtts_base = "https://huggingface.co/coqui/XTTS-v2/resolve/v2.0.2"
    for name in ("hubert_base.pt", "rmvpe.pt"):
        download_file(f"{rvc_base}/{name}", MODELS_DIR / name)
    for name in ("vocab.json", "config.json", "dvae.pth", "mel_stats.pth", "model.pth"):
        download_file(f"{xtts_base}/{name}", XTTS_DIR / name)


def normalize_style(value: str) -> str:
    key = (value or "").strip().lower()
    if key in {"a11", "terminator", "robot", "robotique"}:
        return "terminator"
    if key in {"k44", "kaen44", "kaen", "donna"}:
        return "donna"
    if key == "vivy":
        return "vivy"
    return "terminator"


def resolve_style(persona: str = "", voice_style: str = "") -> str:
    persona_style = normalize_style(persona)
    raw_style = (voice_style or "").strip().lower()
    if raw_style in {"", "default", "voice", "speech", "song", "sing", "chant", "music", "musique"}:
        return persona_style
    style = normalize_style(raw_style)
    if style == "terminator" and persona_style != "terminator" and raw_style not in {"a11", "terminator", "robot", "robotique"}:
        return persona_style
    return style


def load_persona_manifest() -> dict:
    manifest = {style: values.copy() for style, values in DEFAULT_PERSONA_MANIFEST.items()}
    if not PERSONA_MANIFEST_PATH.exists():
        return manifest
    try:
        raw = json.loads(PERSONA_MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return manifest
    if not isinstance(raw, dict):
        return manifest
    for raw_style, raw_values in raw.items():
        if not isinstance(raw_values, dict):
            continue
        style = normalize_style(raw_style)
        current = manifest.setdefault(style, {})
        for key in ("persona", "voice", "rvc", "index"):
            value = raw_values.get(key)
            if isinstance(value, str) and value.strip():
                current[key] = value.strip()
    return manifest


def env_name(style: str, kind: str) -> str:
    suffixes = {"voice": "VOICE", "rvc": "RVC", "index": "INDEX"}
    suffix = suffixes[kind]
    style_key = style.upper().replace("-", "_")
    for name in (
        f"A11_XTTS_RVC_{style_key}_{suffix}",
        f"A11_VOICE_XTTS_RVC_{style_key}_{suffix}",
        f"A11_XTTS_RVC_DEFAULT_{suffix}",
        f"A11_VOICE_XTTS_RVC_DEFAULT_{suffix}",
    ):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    manifest = load_persona_manifest()
    value = manifest.get(style, {}).get(kind, "")
    if value:
        return value
    if kind == "index":
        return f"{Path(env_name(style, 'rvc')).stem}.index"
    return DEFAULT_PERSONA_MANIFEST[style][kind]


def resolve_data_path(base_dir: Path, name: str) -> Path:
    path = Path(name)
    if path.is_absolute():
        return path
    return base_dir / name


def resolve_index_path(style: str, rvc_path: Path) -> Path:
    candidates = [resolve_data_path(RVCS_DIR, env_name(style, "index"))]
    exact = RVCS_DIR / f"{rvc_path.stem}.index"
    candidates.append(exact)
    candidates.extend(sorted(RVCS_DIR.glob(f"{rvc_path.stem}*.index")))
    seen = set()
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        if candidate.exists():
            return candidate
    return candidates[0]


def resolve_persona_binding(style: str) -> dict:
    manifest = load_persona_manifest()
    entry = manifest.get(style, DEFAULT_PERSONA_MANIFEST[style])
    voice_name = env_name(style, "voice")
    rvc_name = env_name(style, "rvc")
    voice_path = resolve_data_path(VOICES_DIR, voice_name)
    rvc_path = resolve_data_path(RVCS_DIR, rvc_name)
    index_path = resolve_index_path(style, rvc_path)
    return {
        "persona": entry.get("persona", style),
        "voiceName": voice_name,
        "voicePath": voice_path,
        "rvcName": rvc_name,
        "rvcPath": rvc_path,
        "indexName": index_path.name,
        "indexPath": index_path,
        "hasVoice": voice_path.exists(),
        "hasRvc": rvc_path.exists(),
        "hasIndex": index_path.exists(),
    }


def get_tts():
    global _tts
    if _tts is None:
        ensure_models()
        torch.set_num_threads(max(1, int(os.environ.get("A11_XTTS_RVC_TORCH_THREADS", "4") or "4")))
        _tts = TTS(model_path=str(XTTS_DIR), config_path=str(XTTS_DIR / "config.json")).to(DEVICE)
    return _tts


class RvcData:
    def __init__(self):
        self.current_model = None
        self.cpt = None
        self.version = None
        self.net_g = None
        self.tgt_sr = None
        self.vc = None

    def load(self, model_path: Path):
        if self.current_model == str(model_path):
            return
        from rvc import get_vc

        self.cpt, self.version, self.net_g, self.tgt_sr, self.vc = get_vc(
            DEVICE,
            _rvc_config.is_half,
            _rvc_config,
            str(model_path),
        )
        self.current_model = str(model_path)


def ensure_rvc_runtime():
    global _hubert_model, _rvc_config, _rvc_data
    if _rvc_config is None:
        from rvc import Config, load_hubert

        ensure_models()
        _rvc_config = Config(DEVICE, DEVICE != "cpu")
        _hubert_model = load_hubert(DEVICE, _rvc_config.is_half, str(MODELS_DIR / "hubert_base.pt"))
        _rvc_data = RvcData()


def run_rvc(
    input_path: Path,
    output_path: Path,
    rvc_path: Path,
    pitch: int,
    index_rate: float,
    index_path: Optional[Path] = None,
) -> None:
    from rvc import rvc_infer

    ensure_rvc_runtime()
    _rvc_data.load(rvc_path)
    model_name = rvc_path.stem
    index_path = index_path or RVCS_DIR / f"{model_name}.index"
    rvc_infer(
        index_path=str(index_path) if index_path.exists() and index_rate != 0 else "",
        index_rate=index_rate,
        input_path=str(input_path),
        output_path=str(output_path),
        pitch_change=pitch,
        f0_method="rmvpe",
        cpt=_rvc_data.cpt,
        version=_rvc_data.version,
        net_g=_rvc_data.net_g,
        filter_radius=3,
        tgt_sr=_rvc_data.tgt_sr,
        rms_mix_rate=0.25,
        protect=0,
        crepe_hop_length=0,
        vc=_rvc_data.vc,
        hubert_model=_hubert_model,
    )
    gc.collect()


def remove_later(path: Path) -> None:
    try:
        if path.exists() and OUT_DIR in path.resolve().parents:
            path.unlink()
    except Exception:
        pass


class SynthesizeRequest(BaseModel):
    text: str = ""
    persona: str = ""
    surface: str = ""
    voicePersona: str = ""
    voiceStyle: str = ""
    vocalMode: str = "adaptive"
    f0Shift: Optional[float] = None


def synthesize_persona_voice(text: str, persona: str = "", voice_style: str = "", f0_shift: Optional[float] = None) -> dict:
    clean_text = " ".join((text or "").split())
    if not clean_text:
        raise HTTPException(status_code=400, detail="text_required_for_xtts_rvc")

    style = resolve_style(persona, voice_style)
    binding = resolve_persona_binding(style)
    voice_path = binding["voicePath"]
    rvc_path = binding["rvcPath"]
    rvc_index_path = binding["indexPath"]
    if not voice_path.exists():
        raise HTTPException(status_code=404, detail=f"voice_sample_missing:{voice_path.name}")

    stamp = int(time.time() * 1000)
    xtts_path = OUT_DIR / f"xtts-{style}-{stamp}.wav"
    final_path = OUT_DIR / f"xtts-rvc-{style}-{stamp}.wav"
    get_tts().tts_to_file(
        text=clean_text,
        speaker_wav=str(voice_path),
        language=LANGUAGE,
        file_path=str(xtts_path),
    )

    engine = "xtts-reference"
    if rvc_path.exists():
        pitch = int(round(float(f0_shift if f0_shift is not None else 0)))
        run_rvc(
            xtts_path,
            final_path,
            rvc_path,
            pitch,
            INDEX_RATE,
            index_path=rvc_index_path if rvc_index_path.exists() else None,
        )
        engine = "xtts-rvc"
    else:
        shutil.copyfile(xtts_path, final_path)

    remove_later(xtts_path)
    if not final_path.exists() or final_path.stat().st_size <= 0:
        raise HTTPException(status_code=500, detail="voice_output_missing")

    return {
        "path": final_path,
        "filename": final_path.name,
        "style": style,
        "engine": engine,
        "rvcPath": rvc_path,
        "rvcIndexPath": rvc_index_path,
        "hasRvc": rvc_path.exists(),
        "hasRvcIndex": rvc_index_path.exists(),
    }


@app.get("/health")
def health():
    voices = sorted(item.name for item in VOICES_DIR.glob("*") if item.is_file())
    rvcs = sorted(item.name for item in RVCS_DIR.glob("*.pth") if item.is_file())
    rvc_indexes = sorted(item.name for item in RVCS_DIR.glob("*.index") if item.is_file())
    styles = {}
    for style in ("terminator", "donna", "vivy"):
        binding = resolve_persona_binding(style)
        styles[style] = {
            "persona": binding["persona"],
            "voice": binding["voiceName"],
            "rvc": binding["rvcName"],
            "index": binding["indexName"],
            "hasVoice": binding["hasVoice"],
            "hasRvc": binding["hasRvc"],
            "hasIndex": binding["hasIndex"],
        }
    return {
        "ok": True,
        "module": "funesterie-xtts-rvc-bridge",
        "device": DEVICE,
        "language": LANGUAGE,
        "personaManifest": str(PERSONA_MANIFEST_PATH),
        "xttsModel": (XTTS_DIR / "model.pth").exists(),
        "voices": voices,
        "rvcModels": rvcs,
        "rvcIndexes": rvc_indexes,
        "styles": styles,
    }


@app.post("/api/voice/convert")
async def convert_voice(
    background_tasks: BackgroundTasks,
    generated: Optional[UploadFile] = File(default=None),
    reference: Optional[UploadFile] = File(default=None),
    text: str = Form(default=""),
    persona: str = Form(default=""),
    voiceStyle: str = Form(default=""),
    mode: str = Form(default="adaptive"),
    f0Shift: Optional[float] = Form(default=None),
):
    del generated, reference, mode
    result = synthesize_persona_voice(text, persona=persona, voice_style=voiceStyle, f0_shift=f0Shift)
    final_path = result["path"]
    rvc_path = result["rvcPath"]
    rvc_index_path = result["rvcIndexPath"]

    background_tasks.add_task(remove_later, final_path)
    return FileResponse(
        final_path,
        media_type="audio/wav",
        filename=final_path.name,
        headers={
            "X-A11-Voice-Engine": result["engine"],
            "X-A11-Voice-Style": result["style"],
            "X-A11-RVC-Model": rvc_path.name if rvc_path.exists() else "",
            "X-A11-RVC-Index": rvc_index_path.name if rvc_index_path.exists() else "",
        },
        background=background_tasks,
    )


@app.post("/api/voice/synthesize")
def synthesize_voice(req: SynthesizeRequest):
    persona = req.voicePersona or req.persona or req.surface
    result = synthesize_persona_voice(
        req.text,
        persona=persona,
        voice_style=req.voiceStyle,
        f0_shift=req.f0Shift,
    )
    rvc_path = result["rvcPath"]
    rvc_index_path = result["rvcIndexPath"]
    audio_url = f"/out/{result['filename']}"
    return {
        "ok": True,
        "module": "funesterie-xtts-rvc-bridge",
        "provider": "xtts-rvc",
        "engine": result["engine"],
        "via": "funesterie-xtts-rvc-bridge",
        "voiceStyle": result["style"],
        "audio_url": audio_url,
        "audioUrl": audio_url,
        "providerCapabilities": {
            "referenceVoice": True,
            "styleVoice": True,
            "rvcModel": result["hasRvc"],
            "rvcIndex": result["hasRvcIndex"],
        },
        "voiceConversion": {
            "ok": True,
            "provider": "xtts-rvc",
            "engine": result["engine"],
            "voiceStyle": result["style"],
            "attemptedEngines": [result["engine"]],
            "rvcModel": rvc_path.name if rvc_path.exists() else "",
            "rvcIndex": rvc_index_path.name if rvc_index_path.exists() else "",
        },
    }


@app.get("/out/{filename}")
def get_output(filename: str):
    safe_name = Path(filename).name
    target = OUT_DIR / safe_name
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="voice_output_not_found")
    return FileResponse(target, media_type="audio/wav", filename=safe_name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
