import argparse
import io
import json
import os
import urllib.request
import warnings

warnings.filterwarnings(
    "ignore",
    message=".*Siglip2ImageProcessorFast.*",
)

import torch
from PIL import Image


MODEL_PROFILES = {
    "sd35": {
        "model_id": "stabilityai/stable-diffusion-3.5-medium",
        "pipeline": "sd3",
        "revision": None,
    },
    "multilingual": {
        "model_id": "BAAI/AltDiffusion-m18",
        "pipeline": "alt",
        "revision": None,
    },
    "classic": {
        "model_id": "runwayml/stable-diffusion-v1-5",
        "pipeline": "auto",
        "revision": None,
    },
}

MODEL_PROFILE_ALIASES = {
    "sd35": "sd35",
    "sd3.5": "sd35",
    "sd35-medium": "sd35",
    "stable-diffusion-3.5": "sd35",
    "stable-diffusion-3.5-medium": "sd35",
    "multilingual": "multilingual",
    "alt": "multilingual",
    "classic": "classic",
    "sd15": "classic",
    "v1.5": "classic",
}


def normalize_env_text(value, default=""):
    text = str(value or "").strip().lower()
    return text or default


def resolve_model_config():
    explicit_model_id = str(os.environ.get("SD_MODEL_ID", "")).strip()
    explicit_profile = normalize_env_text(os.environ.get("SD_MODEL_PROFILE"), "sd35")
    explicit_pipeline = normalize_env_text(os.environ.get("SD_MODEL_PIPELINE"), "")
    explicit_revision = str(os.environ.get("SD_MODEL_REVISION", "")).strip() or None

    if explicit_model_id:
        pipeline = explicit_pipeline or (
            "alt" if "altdiffusion" in explicit_model_id.lower() else "auto"
        )
        if not explicit_pipeline and "stable-diffusion-3" in explicit_model_id.lower():
            pipeline = "sd3"
        return {
            "profile": MODEL_PROFILE_ALIASES.get(explicit_profile, explicit_profile) if explicit_profile in MODEL_PROFILE_ALIASES else "custom",
            "model_id": explicit_model_id,
            "pipeline": pipeline,
            "revision": explicit_revision,
            "is_explicit_model": True,
        }

    selected_profile = MODEL_PROFILE_ALIASES.get(explicit_profile, "")
    if selected_profile not in MODEL_PROFILES:
        selected_profile = "sd35"
    profile = MODEL_PROFILES[selected_profile]
    return {
        "profile": selected_profile,
        "model_id": profile["model_id"],
        "pipeline": explicit_pipeline or profile["pipeline"],
        "revision": explicit_revision or profile.get("revision"),
        "is_explicit_model": False,
    }


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
        if hasattr(pipe, "vae") and pipe.vae is not None and hasattr(pipe.vae, "enable_slicing"):
            pipe.vae.enable_slicing()
        else:
            pipe.enable_vae_slicing()
    except Exception:
        pass
    try:
        if hasattr(pipe, "vae") and pipe.vae is not None and hasattr(pipe.vae, "enable_tiling"):
            pipe.vae.enable_tiling()
        else:
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


def is_remote_image(value):
    text = str(value or "").strip().lower()
    return text.startswith("http://") or text.startswith("https://")


def clamp_strength(value, fallback=0.45):
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(0.18, min(0.78, numeric))


def crop_and_resize_cover(image, width, height):
    source = image.convert("RGB")
    src_width, src_height = source.size
    target_ratio = float(width) / float(height)
    source_ratio = float(src_width) / float(src_height)

    if source_ratio > target_ratio:
        cropped_width = max(1, int(round(src_height * target_ratio)))
        offset_x = max(0, (src_width - cropped_width) // 2)
        source = source.crop((offset_x, 0, offset_x + cropped_width, src_height))
    elif source_ratio < target_ratio:
        cropped_height = max(1, int(round(src_width / target_ratio)))
        offset_y = max(0, (src_height - cropped_height) // 2)
        source = source.crop((0, offset_y, src_width, offset_y + cropped_height))

    return source.resize((int(width), int(height)), Image.LANCZOS)


def load_init_image(source, width, height):
    raw_source = str(source or "").strip()
    if not raw_source:
        return None, "", ""

    try:
        if is_remote_image(raw_source):
            request = urllib.request.Request(
                raw_source,
                headers={
                    "User-Agent": "A11-SD/1.0",
                    "Accept": "image/*,*/*;q=0.8",
                },
            )
            with urllib.request.urlopen(request, timeout=20) as response:
                content = response.read()
            image = Image.open(io.BytesIO(content))
            source_kind = "url"
        else:
            image = Image.open(raw_source)
            source_kind = "file"

        return crop_and_resize_cover(image, width, height), source_kind, ""
    except Exception as error:
        return None, "", str(error)


def load_pipeline(model_config, torch_dtype, generation_mode):
    pipeline_kind = str(model_config.get("pipeline") or "auto").strip().lower()
    model_id = str(model_config.get("model_id") or "").strip()
    revision = model_config.get("revision")

    if pipeline_kind == "sd3":
        if generation_mode == "img2img":
            from diffusers import StableDiffusion3Img2ImgPipeline

            pipeline_class = StableDiffusion3Img2ImgPipeline
        else:
            from diffusers import StableDiffusion3Pipeline

            pipeline_class = StableDiffusion3Pipeline
    elif pipeline_kind == "alt":
        if generation_mode == "img2img":
            from diffusers import AltDiffusionImg2ImgPipeline

            pipeline_class = AltDiffusionImg2ImgPipeline
        else:
            from diffusers import AltDiffusionPipeline

            pipeline_class = AltDiffusionPipeline
    else:
        if generation_mode == "img2img":
            from diffusers import AutoPipelineForImage2Image

            pipeline_class = AutoPipelineForImage2Image
        else:
            from diffusers import AutoPipelineForText2Image

            pipeline_class = AutoPipelineForText2Image

    load_kwargs = {
        "torch_dtype": torch_dtype,
    }
    if pipeline_kind != "sd3":
        load_kwargs["safety_checker"] = None
        load_kwargs["requires_safety_checker"] = False
    if revision:
        load_kwargs["revision"] = revision

    return pipeline_class.from_pretrained(model_id, **load_kwargs)


def load_pipeline_with_fallback(model_config, torch_dtype, generation_mode):
    candidates = [model_config]

    should_fallback_to_classic = (
        not model_config.get("is_explicit_model")
        and str(model_config.get("profile") or "").strip().lower() in {"sd35", "multilingual"}
    )
    if should_fallback_to_classic:
        classic = MODEL_PROFILES["classic"]
        candidates.append({
            "profile": "classic",
            "model_id": classic["model_id"],
            "pipeline": classic["pipeline"],
            "revision": classic.get("revision"),
            "is_explicit_model": False,
        })

    last_error = None
    for index, candidate in enumerate(candidates):
        try:
            pipe = load_pipeline(candidate, torch_dtype, generation_mode)
            fallback_used = index > 0
            return pipe, candidate, fallback_used, (str(last_error) if last_error else "")
        except Exception as error:
            last_error = error
            if index + 1 >= len(candidates):
                raise
            print(
                f"[A11][sd] model load failed for {candidate['model_id']} ({generation_mode}): {error}. "
                f"Falling back to {candidates[index + 1]['model_id']}.",
                file=os.sys.stderr,
            )

    raise last_error or RuntimeError("Unable to load any Stable Diffusion pipeline.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", type=str, required=True)
    parser.add_argument("--negative_prompt", type=str, default=None)
    parser.add_argument("--num_inference_steps", type=int, default=35)
    parser.add_argument("--guidance_scale", type=float, default=8.0)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--init_image", type=str, default=None)
    parser.add_argument("--strength", type=float, default=None)
    parser.add_argument("--output", type=str, default="output.png")
    args = parser.parse_args()

    model_config = resolve_model_config()
    device = resolve_device()
    torch_dtype = resolve_dtype(device)

    maybe_enable_cuda_fast_paths()

    init_image_source = str(args.init_image or "").strip()
    init_image, init_image_kind, init_image_error = load_init_image(
        init_image_source,
        args.width,
        args.height,
    )
    generation_mode = "img2img" if init_image is not None else "txt2img"
    resolved_strength = clamp_strength(args.strength, 0.45) if generation_mode == "img2img" else None

    if init_image_source and init_image is None and init_image_error:
        print(
            f"[A11][sd] init image unavailable, fallback to text-to-image: {init_image_error}",
            file=os.sys.stderr,
        )

    pipe, resolved_model_config, fallback_used, fallback_reason = load_pipeline_with_fallback(
        model_config,
        torch_dtype,
        generation_mode,
    )
    if hasattr(pipe, "safety_checker"):
        pipe.safety_checker = None
    if hasattr(pipe, "register_to_config"):
        pipe.register_to_config(requires_safety_checker=False)
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
        generator=generator,
    )
    if generation_mode == "img2img":
        generation_kwargs["image"] = init_image
        generation_kwargs["strength"] = resolved_strength
    else:
        generation_kwargs["width"] = args.width
        generation_kwargs["height"] = args.height

    if args.negative_prompt and str(args.negative_prompt).strip():
        generation_kwargs["negative_prompt"] = str(args.negative_prompt).strip()

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
                "requested_model_profile": model_config["profile"],
                "model_profile": resolved_model_config["profile"],
                "model_id": resolved_model_config["model_id"],
                "model_pipeline": resolved_model_config["pipeline"],
                "model_fallback_used": fallback_used,
                "model_fallback_reason": fallback_reason or None,
                "device": device,
                "torch_dtype": dtype_label(torch_dtype),
                "cuda_available": torch.cuda.is_available(),
                "cuda_device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                "xformers_enabled": xformers_enabled,
                "safety_checker_enabled": False,
                "generation_mode": generation_mode,
                "init_image_requested": bool(init_image_source),
                "init_image_used": init_image is not None,
                "init_image_source": init_image_source or None,
                "init_image_kind": init_image_kind or None,
                "init_image_error": init_image_error or None,
                "strength": resolved_strength,
            }
        )
    )


if __name__ == "__main__":
    main()
