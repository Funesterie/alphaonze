prompt = sys.argv[1] if len(sys.argv) > 1 else "lapin de Pâques"

import argparse
import json
import os
import torch
from diffusers import AutoPipelineForText2Image

def main():
	parser = argparse.ArgumentParser()
	parser.add_argument("--prompt", type=str, required=True)
	parser.add_argument("--negative_prompt", type=str, default="blurry, abstract, deformed, extra limbs, bad anatomy, low quality, text, watermark")
	parser.add_argument("--num_inference_steps", type=int, default=35)
	parser.add_argument("--guidance_scale", type=float, default=8.0)
	parser.add_argument("--width", type=int, default=768)
	parser.add_argument("--height", type=int, default=768)
	parser.add_argument("--seed", type=int, default=None)
	parser.add_argument("--output", type=str, default="output.png")
	args = parser.parse_args()

	model_id = "runwayml/stable-diffusion-v1-5"
	pipe = AutoPipelineForText2Image.from_pretrained(
		model_id,
		torch_dtype=torch.float16
	).to("cuda" if torch.cuda.is_available() else "cpu")
	pipe.enable_attention_slicing()

	generator = torch.Generator("cuda" if torch.cuda.is_available() else "cpu")
	if args.seed is not None:
		generator = generator.manual_seed(args.seed)

	image = pipe(
		prompt=args.prompt,
		negative_prompt=args.negative_prompt,
		num_inference_steps=args.num_inference_steps,
		guidance_scale=args.guidance_scale,
		width=args.width,
		height=args.height,
		generator=generator
	).images[0]

	# Force .png extension
	output_path = args.output
	if not output_path.lower().endswith('.png'):
		output_path += '.png'
	image.save(output_path)

	# Sortie JSON stricte
	print(json.dumps({
		"ok": True,
		"output_path": os.path.abspath(output_path)
	}))

if __name__ == "__main__":
	main()
