import argparse
import base64
import io
import json
import sys
import traceback

import torch
from PIL import Image
from transformers import AutoModelForCausalLM
import transformers.configuration_utils as transformers_config_utils


def patch_transformers_dataclass_compat():
    original_dataclass = getattr(transformers_config_utils, "dataclass", None)
    if original_dataclass is None:
        return

    def safe_dataclass(cls=None, *args, **kwargs):
        if cls is None:
            return lambda inner: safe_dataclass(inner, *args, **kwargs)
        try:
            return original_dataclass(cls, *args, **kwargs)
        except (TypeError, ValueError) as exc:
            message = str(exc)
            if "non-default argument" in message or "mutable default" in message:
                return cls
            raise

    transformers_config_utils.dataclass = safe_dataclass


patch_transformers_dataclass_compat()

from janus.models import VLChatProcessor


STATE = {
    "model": None,
    "processor": None,
    "tokenizer": None,
    "model_ref": None,
    "device": None,
    "dtype_name": None,
}


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def resolve_torch_dtype(dtype_name, device):
    normalized = str(dtype_name or "auto").strip().lower()
    if normalized in ("bf16", "bfloat16"):
        return torch.bfloat16, "bfloat16"
    if normalized in ("fp16", "float16", "half"):
        return torch.float16, "float16"
    if normalized in ("fp32", "float32", "full"):
        return torch.float32, "float32"
    if device == "cuda":
        if torch.cuda.is_available() and torch.cuda.is_bf16_supported():
            return torch.bfloat16, "bfloat16"
        return torch.float16, "float16"
    return torch.float32, "float32"


def ensure_model(model_ref, device_name, dtype_name):
    device = device_name if device_name == "cuda" and torch.cuda.is_available() else "cpu"
    torch_dtype, normalized_dtype = resolve_torch_dtype(dtype_name, device)
    if (
        STATE["model"] is not None
        and STATE["model_ref"] == model_ref
        and STATE["device"] == device
        and STATE["dtype_name"] == normalized_dtype
    ):
        return STATE["model"], STATE["processor"], STATE["tokenizer"], device, normalized_dtype

    processor = VLChatProcessor.from_pretrained(model_ref)
    tokenizer = processor.tokenizer
    model = AutoModelForCausalLM.from_pretrained(
        model_ref,
        trust_remote_code=True,
    )
    model = model.to(device=device, dtype=torch_dtype).eval()

    STATE["model"] = model
    STATE["processor"] = processor
    STATE["tokenizer"] = tokenizer
    STATE["model_ref"] = model_ref
    STATE["device"] = device
    STATE["dtype_name"] = normalized_dtype
    return model, processor, tokenizer, device, normalized_dtype


def decode_image(image_b64):
    raw = base64.b64decode(image_b64)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def model_floating_dtype(model):
    try:
        return next(p.dtype for p in model.parameters() if p.is_floating_point())
    except StopIteration:
        return torch.float32


def align_prepared_tensors(prepared, model):
    target_dtype = model_floating_dtype(model)

    def convert(value):
        if torch.is_tensor(value):
            if torch.is_floating_point(value):
                return value.to(device=model.device, dtype=target_dtype)
            return value.to(device=model.device)
        if isinstance(value, list):
            return [convert(item) for item in value]
        if isinstance(value, tuple):
            return tuple(convert(item) for item in value)
        return value

    if hasattr(prepared, "items"):
        for key, value in list(prepared.items()):
            try:
                prepared[key] = convert(value)
            except Exception:
                pass

    for name in ("pixel_values", "images_seq_mask", "images_emb_mask", "input_ids", "attention_mask"):
        if hasattr(prepared, name):
            try:
                setattr(prepared, name, convert(getattr(prepared, name)))
            except Exception:
                pass

    return prepared


@torch.inference_mode()
def run_vision_text(model, processor, tokenizer, image, prompt, max_new_tokens=320, temperature=0.0):
    conversation = [
        {
            "role": "<|User|>",
            "content": f"<image_placeholder>\n{prompt}",
            "images": [image],
        },
        {
            "role": "<|Assistant|>",
            "content": "",
        },
    ]
    prepared = processor(
        conversations=conversation,
        images=[image],
        force_batchify=True,
    ).to(model.device)
    prepared = align_prepared_tensors(prepared, model)
    inputs_embeds = model.prepare_inputs_embeds(**prepared)

    do_sample = float(temperature or 0) > 0.01
    generate_kwargs = {
        "inputs_embeds": inputs_embeds,
        "attention_mask": prepared.attention_mask,
        "pad_token_id": tokenizer.eos_token_id,
        "bos_token_id": tokenizer.bos_token_id,
        "eos_token_id": tokenizer.eos_token_id,
        "max_new_tokens": max(64, min(int(max_new_tokens or 320), 768)),
        "do_sample": do_sample,
        "use_cache": True,
    }
    if do_sample:
        generate_kwargs["temperature"] = max(float(temperature or 0), 0.1)
    outputs = model.language_model.generate(
        **generate_kwargs,
    )
    return tokenizer.decode(outputs[0].cpu().tolist(), skip_special_tokens=True).strip()


@torch.inference_mode()
def run_text_only(model, tokenizer, prompt, max_new_tokens=320, temperature=0.0):
    prepared = tokenizer(prompt, return_tensors="pt").to(model.device)
    do_sample = float(temperature or 0) > 0.01
    generate_kwargs = {
        "input_ids": prepared.input_ids,
        "attention_mask": prepared.attention_mask,
        "pad_token_id": tokenizer.eos_token_id,
        "bos_token_id": tokenizer.bos_token_id,
        "eos_token_id": tokenizer.eos_token_id,
        "max_new_tokens": max(64, min(int(max_new_tokens or 320), 1024)),
        "do_sample": do_sample,
        "use_cache": True,
    }
    if do_sample:
        generate_kwargs["temperature"] = max(float(temperature or 0), 0.1)
    outputs = model.language_model.generate(
        **generate_kwargs,
    )
    generated_tokens = outputs[0][prepared.input_ids.shape[-1]:]
    return tokenizer.decode(generated_tokens.cpu().tolist(), skip_special_tokens=True).strip()


def handle_request(request, cli_args):
    action = str(request.get("action") or "").strip()
    prompt = str(request.get("prompt") or "").strip()
    if not prompt:
        return {
            "id": request.get("id"),
            "ok": False,
            "error": "missing_prompt",
        }

    model, processor, tokenizer, device, dtype_name = ensure_model(
        cli_args.model,
        cli_args.device,
        cli_args.dtype,
    )

    if action in ("text", "planner_text"):
        text = run_text_only(
            model,
            tokenizer,
            prompt=prompt,
            max_new_tokens=request.get("max_new_tokens", 320),
            temperature=request.get("temperature", 0.0),
        )
        return {
            "id": request.get("id"),
            "ok": True,
            "text": text,
            "model_ref": cli_args.model,
            "device": device,
            "dtype": dtype_name,
            "request_id": str(request.get("request_id") or "").strip(),
        }

    if action != "vision_text":
        return {
            "id": request.get("id"),
            "ok": False,
            "error": "unsupported_action",
        }

    image_b64 = str(request.get("image_base64") or "").strip()
    if not image_b64:
        return {
            "id": request.get("id"),
            "ok": False,
            "error": "missing_image",
        }

    image = decode_image(image_b64)
    text = run_vision_text(
        model,
        processor,
        tokenizer,
        image=image,
        prompt=prompt,
        max_new_tokens=request.get("max_new_tokens", 320),
        temperature=request.get("temperature", 0.0),
    )
    return {
        "id": request.get("id"),
        "ok": True,
        "text": text,
        "model_ref": cli_args.model,
        "device": device,
        "dtype": dtype_name,
        "request_id": str(request.get("request_id") or "").strip(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--dtype", default="auto")
    args = parser.parse_args()

    emit({"type": "ready", "model_ref": args.model, "device": args.device, "dtype": args.dtype})

    for line in sys.stdin:
        raw = str(line or "").strip()
        if not raw:
            continue
        try:
            request = json.loads(raw)
            response = handle_request(request, args)
        except Exception as exc:
            response = {
                "id": None,
                "ok": False,
                "error": str(exc),
                "traceback": traceback.format_exc(limit=2),
            }
        emit(response)


if __name__ == "__main__":
    main()
