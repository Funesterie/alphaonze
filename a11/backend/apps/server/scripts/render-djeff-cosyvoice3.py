import argparse
import os
import sys
from pathlib import Path

import torchaudio


DEFAULT_COSY_ROOT = Path(r"D:\agent-bus\voice\CosyVoice")
DEFAULT_MODEL_DIR = DEFAULT_COSY_ROOT / "pretrained_models" / "Fun-CosyVoice3-0.5B"
DEFAULT_PROMPT_AUDIO = DEFAULT_COSY_ROOT / "outputs" / "djeff-ref-pignon-5s.wav"
DEFAULT_PROMPT_TEXT = (
    "You are a helpful assistant. Speak French naturally with a close microphone rap timbre."
    "<|endofprompt|>"
    "Un quatorzième dans l'essence, deux point deux dans la bombonne."
)
DEFAULT_TEXT = (
    "Le moteur respire, le pignon répond, les rimes claquent en français. "
    "Je garde la route, je tiens le guidon, et la voix reste proche du micro."
)


def parse_args():
    parser = argparse.ArgumentParser(description="Render a Djeff voice sample with CosyVoice3.")
    parser.add_argument("--cosy-root", default=str(DEFAULT_COSY_ROOT))
    parser.add_argument("--model-dir", default=str(DEFAULT_MODEL_DIR))
    parser.add_argument("--prompt-audio", default=str(DEFAULT_PROMPT_AUDIO))
    parser.add_argument("--prompt-text", default=DEFAULT_PROMPT_TEXT)
    parser.add_argument("--text", default=DEFAULT_TEXT)
    parser.add_argument("--mode", choices=["zero", "cross", "instruct"], default="instruct")
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def main():
    args = parse_args()
    cosy_root = Path(args.cosy_root).resolve()
    sys.path.insert(0, str(cosy_root))
    sys.path.insert(0, str(cosy_root / "third_party" / "Matcha-TTS"))
    os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")

    from cosyvoice.cli.cosyvoice import AutoModel  # pylint: disable=import-error,import-outside-toplevel

    model = AutoModel(model_dir=str(Path(args.model_dir).resolve()))
    prompt_audio = str(Path(args.prompt_audio).resolve())
    text = str(args.text)
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    if args.mode == "cross":
        generator = model.inference_cross_lingual(
            "You are a helpful assistant. Speak French naturally.<|endofprompt|>" + text,
            prompt_audio,
            stream=False,
            text_frontend=False,
        )
    elif args.mode == "zero":
        generator = model.inference_zero_shot(
            text,
            str(args.prompt_text),
            prompt_audio,
            stream=False,
            text_frontend=False,
        )
    else:
        generator = model.inference_instruct2(
            text,
            "You are a helpful assistant. Speak in natural French, close microphone, rap cadence, clear diction.<|endofprompt|>",
            prompt_audio,
            stream=False,
            text_frontend=False,
        )

    wrote = 0
    for index, item in enumerate(generator):
        target = output if index == 0 else output.with_name(f"{output.stem}-{index}{output.suffix}")
        torchaudio.save(str(target), item["tts_speech"].cpu(), model.sample_rate)
        print(f"saved={target}")
        wrote += 1

    if wrote <= 0:
        raise RuntimeError("cosyvoice_no_audio")


if __name__ == "__main__":
    main()
