import argparse
import json
import os

import torch
from diffusers import AutoPipelineForText2Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", type=str, required=True)
    parser.add_argument(
        "--negative_prompt",
        type=str,
        default="blurry, abstract, deformed, extra limbs, bad anatomy, low quality, text, watermark",
    )
    parser.add_argument("--num_inference_steps", type=int, default=35)
    parser.add_argument("--guidance_scale", type=float, default=8.0)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--output", type=str, default="output.png")
    args = parser.parse_args()

    model_id = os.environ.get("SD_MODEL_ID", "runwayml/stable-diffusion-v1-5")
    has_cuda = torch.cuda.is_available()
    device = "cuda" if has_cuda else "cpu"
    torch_dtype = torch.float16 if has_cuda else torch.float32

    pipe = AutoPipelineForText2Image.from_pretrained(
        model_id,
        torch_dtype=torch_dtype,
    ).to(device)
    pipe.enable_attention_slicing()

    generator = torch.Generator(device)
    if args.seed is not None:
        generator = generator.manual_seed(args.seed)

    image = pipe(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt,
        num_inference_steps=args.num_inference_steps,
        guidance_scale=args.guidance_scale,
        width=args.width,
        height=args.height,
        generator=generator,
    ).images[0]

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
            }
        )
    )


if __name__ == "__main__":
    main()
