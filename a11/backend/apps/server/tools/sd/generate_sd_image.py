import argparse
import json
import os

import torch
from diffusers import AutoPipelineForText2Image


def resolve_device():
    requested = str(os.environ.get("SD_DEVICE", "")).strip().lower()
    if requested:
        if requested == "cuda" and torch.cuda.is_available():
            return "cuda"
        if requested == "cpu":
            return "cpu"
    return "cuda" if torch.cuda.is_available() else "cpu"


def resolve_dtype(device):
    requested = str(os.environ.get("SD_TORCH_DTYPE", "")).strip().lower()
    if requested == "float32":
        return torch.float32
    if requested in {"float16", "fp16", "half"}:
        return torch.float16
    if requested in {"bfloat16", "bf16"} and hasattr(torch, "bfloat16"):
        return torch.bfloat16
    return torch.float16 if device == "cuda" else torch.float32


def dtype_label(value):
    mapping = {
        torch.float16: "float16",
        torch.float32: "float32",
    }
    if hasattr(torch, "bfloat16"):
        mapping[torch.bfloat16] = "bfloat16"
    return mapping.get(value, str(value))


def maybe_enable_cuda_fast_paths():
    if not torch.cuda.is_available():
        return
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("high")


def maybe_enable_pipeline_memory_optimizations(pipe):
    xformers_enabled = False
    try:
        pipe.enable_vae_slicing()
    except Exception:
        pass
    try:
        pipe.enable_vae_tiling()
    except Exception:
        pass
    try:
        pipe.enable_attention_slicing()
    except Exception:
        pass
    try:
        pipe.enable_xformers_memory_efficient_attention()
        xformers_enabled = True
    except Exception:
        xformers_enabled = False
    return xformers_enabled


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", type=str, required=True)
    parser.add_argument("--num_inference_steps", type=int, default=35)
    parser.add_argument("--guidance_scale", type=float, default=8.0)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--output", type=str, default="output.png")
    args = parser.parse_args()

    model_id = os.environ.get("SD_MODEL_ID", "runwayml/stable-diffusion-v1-5")
    device = resolve_device()
    torch_dtype = resolve_dtype(device)
    has_cuda = device == "cuda"

    maybe_enable_cuda_fast_paths()

    pipe = AutoPipelineForText2Image.from_pretrained(
        model_id,
        torch_dtype=torch_dtype,
    )
    pipe.set_progress_bar_config(disable=True)
    pipe = pipe.to(device)
    xformers_enabled = maybe_enable_pipeline_memory_optimizations(pipe)

    generator = torch.Generator(device=device)
    if args.seed is not None:
        generator = generator.manual_seed(args.seed)

    generation_kwargs = dict(
        prompt=args.prompt,
        num_inference_steps=args.num_inference_steps,
        guidance_scale=args.guidance_scale,
        width=args.width,
        height=args.height,
        generator=generator,
    )

    with torch.inference_mode():
        image = pipe(**generation_kwargs).images[0]

    output_path = args.output
    if not output_path.lower().endswith(".png"):
        output_path += ".png"

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    image.save(output_path)

    print(
        json.dumps(
            {
                "ok": True,
                "output_path": os.path.abspath(output_path),
                "model_id": model_id,
                "device": device,
                "torch_dtype": dtype_label(torch_dtype),
                "cuda_available": torch.cuda.is_available(),
                "cuda_device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                "xformers_enabled": xformers_enabled,
            }
        )
    )


if __name__ == "__main__":
    main()
