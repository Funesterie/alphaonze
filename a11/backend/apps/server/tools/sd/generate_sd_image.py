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
    "sd35large": {
        "model_id": "stabilityai/stable-diffusion-3.5-large",
        "pipeline": "sd3",
        "revision": None,
    },
    "sd35turbo": {
        "model_id": "stabilityai/stable-diffusion-3.5-large-turbo",
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
    "sd35large": "sd35large",
    "sd35-large": "sd35large",
    "sd3.5-large": "sd35large",
    "stable-diffusion-3.5-large": "sd35large",
    "sd35turbo": "sd35turbo",
    "sd35-turbo": "sd35turbo",
    "sd3.5-turbo": "sd35turbo",
    "stable-diffusion-3.5-large-turbo": "sd35turbo",
    "multilingual": "multilingual",
    "alt": "multilingual",
    "classic": "classic",
    "sd15": "classic",
    "v1.5": "classic",
}


def normalize_env_text(value, default=""):
    text = str(value or "").strip().lower()
    return text or default


def env_int(name, default):
    try:
        return int(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return int(default)


def env_bool(name, default=False):
    raw = str(os.environ.get(name, "")).strip().lower()
    if not raw:
        return bool(default)
    return raw in {"1", "true", "yes", "on"}


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
    if device == "cuda":
        if hasattr(torch.cuda, "is_bf16_supported") and torch.cuda.is_bf16_supported() and hasattr(torch, "bfloat16"):
            return torch.bfloat16
        return torch.float16
    return torch.float32


def resolve_cuda_total_memory_gb():
    if not torch.cuda.is_available():
        return 0.0
    try:
        total_memory = torch.cuda.get_device_properties(0).total_memory
    except Exception:
        return 0.0
    return float(total_memory) / float(1024 ** 3)


def resolve_sd3_execution_mode():
    requested = normalize_env_text(os.environ.get("SD_SD3_EXECUTION_MODE"), "")
    if requested in {"direct", "model_cpu_offload", "sequential_cpu_offload"}:
        return requested

    if os.name == "nt":
        return "sequential_cpu_offload"

    low_vram_threshold_gb = env_int("SD_SD3_LOW_VRAM_THRESHOLD_GB", 16)
    total_memory_gb = resolve_cuda_total_memory_gb()
    if total_memory_gb and total_memory_gb <= float(low_vram_threshold_gb):
        return "sequential_cpu_offload"

    return "model_cpu_offload"


def dtype_label(value):
    mapping = {
        torch.float16: "float16",
        torch.float32: "float32",
    }
    if hasattr(torch, "bfloat16"):
        mapping[torch.bfloat16] = "bfloat16"
    return mapping.get(value, str(value))


def maybe_enable_cuda_fast_paths():
    flags = {
        "tf32_enabled": False,
        "flash_sdp_enabled": False,
        "mem_efficient_sdp_enabled": False,
        "math_sdp_enabled": False,
        "cudnn_benchmark_enabled": False,
    }
    if not torch.cuda.is_available():
        return flags
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    flags["tf32_enabled"] = True
    torch.backends.cudnn.benchmark = True
    flags["cudnn_benchmark_enabled"] = True
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("high")
    try:
        if hasattr(torch.backends.cuda, "enable_flash_sdp"):
            torch.backends.cuda.enable_flash_sdp(True)
            flags["flash_sdp_enabled"] = True
        if hasattr(torch.backends.cuda, "enable_mem_efficient_sdp"):
            torch.backends.cuda.enable_mem_efficient_sdp(True)
            flags["mem_efficient_sdp_enabled"] = True
        if hasattr(torch.backends.cuda, "enable_math_sdp"):
            torch.backends.cuda.enable_math_sdp(True)
            flags["math_sdp_enabled"] = True
    except Exception:
        pass
    return flags


def maybe_enable_channels_last(pipe, device):
    if device != "cuda" or not env_bool("SD_ENABLE_CHANNELS_LAST", True):
        return False

    enabled = False
    for attr in ("unet", "vae", "transformer"):
        module = getattr(pipe, attr, None)
        if module is None:
            continue
        try:
            module.to(memory_format=torch.channels_last)
            enabled = True
        except Exception:
            pass
    return enabled


def maybe_enable_pipeline_memory_optimizations(pipe, device, execution_config):
    flags = {
        "xformers_enabled": False,
        "attention_slicing_enabled": False,
        "vae_slicing_enabled": False,
        "vae_tiling_enabled": False,
    }
    try:
        if hasattr(pipe, "vae") and pipe.vae is not None and hasattr(pipe.vae, "enable_slicing"):
            pipe.vae.enable_slicing()
        else:
            pipe.enable_vae_slicing()
        flags["vae_slicing_enabled"] = True
    except Exception:
        pass
    try:
        if hasattr(pipe, "vae") and pipe.vae is not None and hasattr(pipe.vae, "enable_tiling"):
            pipe.vae.enable_tiling()
        else:
            pipe.enable_vae_tiling()
        flags["vae_tiling_enabled"] = True
    except Exception:
        pass

    should_enable_attention_slicing = env_bool(
        "SD_ENABLE_ATTENTION_SLICING",
        device != "cuda" or bool((execution_config or {}).get("cpu_offload")),
    )
    if should_enable_attention_slicing:
        try:
            pipe.enable_attention_slicing()
            flags["attention_slicing_enabled"] = True
        except Exception:
            pass

    if device == "cuda" and env_bool("SD_ENABLE_XFORMERS", True):
        try:
            pipe.enable_xformers_memory_efficient_attention()
            flags["xformers_enabled"] = True
        except Exception:
            flags["xformers_enabled"] = False

    return flags


def configure_pipeline_execution(pipe, device, model_config):
    pipeline_kind = str(model_config.get("pipeline") or "").strip().lower()
    if device != "cuda":
        return pipe.to(device), {
            "execution_mode": "direct",
            "cpu_offload": False,
        }

    if pipeline_kind == "sd3":
        preferred_mode = resolve_sd3_execution_mode()
        if preferred_mode == "direct":
            return pipe.to(device), {
                "execution_mode": "direct",
                "cpu_offload": False,
            }

        if preferred_mode == "sequential_cpu_offload":
            try:
                pipe.enable_sequential_cpu_offload()
                return pipe, {
                    "execution_mode": "sequential_cpu_offload",
                    "cpu_offload": True,
                }
            except Exception:
                preferred_mode = "model_cpu_offload"

        if preferred_mode == "model_cpu_offload":
            try:
                pipe.enable_model_cpu_offload()
                return pipe, {
                    "execution_mode": "model_cpu_offload",
                    "cpu_offload": True,
                }
            except Exception:
                pipe.enable_sequential_cpu_offload()
                return pipe, {
                    "execution_mode": "sequential_cpu_offload",
                    "cpu_offload": True,
                }

    return pipe.to(device), {
        "execution_mode": "direct",
        "cpu_offload": False,
    }


def is_remote_image(value):
    text = str(value or "").strip().lower()
    return text.startswith("http://") or text.startswith("https://")


def clamp_strength(value, fallback=0.45):
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(0.18, min(0.78, numeric))


def resolve_init_resize_mode():
    mode = str(os.environ.get("SD_INIT_IMAGE_RESIZE_MODE", "contain")).strip().lower()
    return mode if mode in {"contain", "cover"} else "contain"


def resize_with_padding(image, width, height, background=(255, 255, 255)):
    source = image.convert("RGB")
    src_width, src_height = source.size
    if src_width <= 0 or src_height <= 0:
        return source.resize((int(width), int(height)), Image.LANCZOS)

    scale = min(float(width) / float(src_width), float(height) / float(src_height))
    resized_width = max(1, int(round(src_width * scale)))
    resized_height = max(1, int(round(src_height * scale)))
    resized = source.resize((resized_width, resized_height), Image.LANCZOS)

    canvas = Image.new("RGB", (int(width), int(height)), background)
    offset_x = max(0, (int(width) - resized_width) // 2)
    offset_y = max(0, (int(height) - resized_height) // 2)
    canvas.paste(resized, (offset_x, offset_y))
    return canvas


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

        resize_mode = resolve_init_resize_mode()
        prepared = (
            crop_and_resize_cover(image, width, height)
            if resize_mode == "cover"
            else resize_with_padding(image, width, height)
        )

        return prepared, source_kind, ""
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

    if not model_config.get("is_explicit_model"):
        requested_profile = str(model_config.get("profile") or "").strip().lower()
        fallback_profiles = []
        if requested_profile in {"sd35large", "sd35turbo"}:
            fallback_profiles.extend(["sd35", "classic"])
        elif requested_profile in {"sd35", "multilingual"}:
            fallback_profiles.append("classic")

        for fallback_profile in fallback_profiles:
            profile = MODEL_PROFILES.get(fallback_profile)
            if not profile:
                continue
            if any(
                str(candidate.get("profile") or "").strip().lower() == fallback_profile
                or str(candidate.get("model_id") or "").strip() == str(profile.get("model_id") or "").strip()
                for candidate in candidates
            ):
                continue
            candidates.append({
                "profile": fallback_profile,
                "model_id": profile["model_id"],
                "pipeline": profile["pipeline"],
                "revision": profile.get("revision"),
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
    parser.add_argument("--prompt_2", type=str, default=None)
    parser.add_argument("--prompt_3", type=str, default=None)
    parser.add_argument("--negative_prompt", type=str, default=None)
    parser.add_argument("--negative_prompt_2", type=str, default=None)
    parser.add_argument("--negative_prompt_3", type=str, default=None)
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

    if device == "cpu":
        max_side = max(256, env_int("SD_MAX_SIDE_CPU", 512))
        max_steps = max(4, env_int("SD_MAX_STEPS_CPU", 20))
        args.width = min(args.width, max_side)
        args.height = min(args.height, max_side)
        args.num_inference_steps = min(args.num_inference_steps, max_steps)

    cuda_fast_path_flags = maybe_enable_cuda_fast_paths()

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
    if generation_mode != "img2img" and str(resolved_model_config.get("pipeline") or "").strip().lower() != "sd3":
        if hasattr(pipe, "register_to_config"):
            pipe.register_to_config(requires_safety_checker=False)
    pipe.set_progress_bar_config(disable=True)
    pipe, execution_config = configure_pipeline_execution(pipe, device, resolved_model_config)
    channels_last_enabled = maybe_enable_channels_last(pipe, device)
    optimization_flags = maybe_enable_pipeline_memory_optimizations(pipe, device, execution_config)

    generator = torch.Generator(device=device)
    if args.seed is not None:
        generator = generator.manual_seed(args.seed)

    generation_kwargs = dict(
        prompt=args.prompt,
        num_inference_steps=args.num_inference_steps,
        guidance_scale=args.guidance_scale,
        generator=generator,
    )
    if str(resolved_model_config.get("pipeline") or "").strip().lower() == "sd3":
        if args.prompt_2 and str(args.prompt_2).strip():
            generation_kwargs["prompt_2"] = str(args.prompt_2).strip()
        if args.prompt_3 and str(args.prompt_3).strip():
            generation_kwargs["prompt_3"] = str(args.prompt_3).strip()
    if generation_mode == "img2img":
        generation_kwargs["image"] = init_image
        generation_kwargs["strength"] = resolved_strength
        generation_kwargs["width"] = args.width
        generation_kwargs["height"] = args.height
    else:
        generation_kwargs["width"] = args.width
        generation_kwargs["height"] = args.height

    if args.negative_prompt and str(args.negative_prompt).strip():
        generation_kwargs["negative_prompt"] = str(args.negative_prompt).strip()
    if str(resolved_model_config.get("pipeline") or "").strip().lower() == "sd3":
        if args.negative_prompt_2 and str(args.negative_prompt_2).strip():
            generation_kwargs["negative_prompt_2"] = str(args.negative_prompt_2).strip()
        if args.negative_prompt_3 and str(args.negative_prompt_3).strip():
            generation_kwargs["negative_prompt_3"] = str(args.negative_prompt_3).strip()

    # Turbo : guidance_scale reduit mais pas zero pour img2img
    is_turbo = str(resolved_model_config.get("profile") or "").strip().lower() == "sd35turbo"
    if is_turbo:
        if generation_mode == "img2img":
            # Pour img2img, garder un guidance_scale minimal pour respecter le prompt
            generation_kwargs["guidance_scale"] = max(1.5, float(generation_kwargs.get("guidance_scale", 1.5)))
        else:
            generation_kwargs["guidance_scale"] = 0.0
        generation_kwargs["num_inference_steps"] = min(
            generation_kwargs.get("num_inference_steps", 8), 8
        )

    with torch.inference_mode():
        image = pipe(**generation_kwargs).images[0]
    output_width, output_height = image.size
    if output_width != args.width or output_height != args.height:
        print(
            f"[A11][sd] output size mismatch requested={args.width}x{args.height} actual={output_width}x{output_height}",
            file=os.sys.stderr,
        )

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
                "execution_mode": execution_config["execution_mode"],
                "cpu_offload": execution_config["cpu_offload"],
                "xformers_enabled": optimization_flags["xformers_enabled"],
                "attention_slicing_enabled": optimization_flags["attention_slicing_enabled"],
                "vae_slicing_enabled": optimization_flags["vae_slicing_enabled"],
                "vae_tiling_enabled": optimization_flags["vae_tiling_enabled"],
                "channels_last_enabled": channels_last_enabled,
                "tf32_enabled": cuda_fast_path_flags["tf32_enabled"],
                "flash_sdp_enabled": cuda_fast_path_flags["flash_sdp_enabled"],
                "mem_efficient_sdp_enabled": cuda_fast_path_flags["mem_efficient_sdp_enabled"],
                "math_sdp_enabled": cuda_fast_path_flags["math_sdp_enabled"],
                "cudnn_benchmark_enabled": cuda_fast_path_flags["cudnn_benchmark_enabled"],
                "safety_checker_enabled": False,
                "generation_mode": generation_mode,
                "width": args.width,
                "height": args.height,
                "output_width": output_width,
                "output_height": output_height,
                "num_inference_steps": args.num_inference_steps,
                "prompt_2_used": bool(generation_kwargs.get("prompt_2")),
                "prompt_3_used": bool(generation_kwargs.get("prompt_3")),
                "negative_prompt_2_used": bool(generation_kwargs.get("negative_prompt_2")),
                "negative_prompt_3_used": bool(generation_kwargs.get("negative_prompt_3")),
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
