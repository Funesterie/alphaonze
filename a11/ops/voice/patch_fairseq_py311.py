"""Patch fairseq 0.12.2 dataclass defaults for Python 3.11.

fairseq 0.12.2 is still the RVC HuBERT loader used by this bridge, but its
FairseqConfig dataclass predates Python 3.11's stricter mutable-default checks.
Keep the compatibility patch local to the container image instead of forking
the whole dependency tree.
"""

from pathlib import Path
import sysconfig


CONFIGS = Path(sysconfig.get_paths()["purelib"]) / "fairseq" / "dataclass" / "configs.py"

REPLACEMENTS = {
    "    common: CommonConfig = CommonConfig()": "    common: CommonConfig = field(default_factory=CommonConfig)",
    "    common_eval: CommonEvalConfig = CommonEvalConfig()": "    common_eval: CommonEvalConfig = field(default_factory=CommonEvalConfig)",
    "    distributed_training: DistributedTrainingConfig = DistributedTrainingConfig()": "    distributed_training: DistributedTrainingConfig = field(default_factory=DistributedTrainingConfig)",
    "    dataset: DatasetConfig = DatasetConfig()": "    dataset: DatasetConfig = field(default_factory=DatasetConfig)",
    "    optimization: OptimizationConfig = OptimizationConfig()": "    optimization: OptimizationConfig = field(default_factory=OptimizationConfig)",
    "    checkpoint: CheckpointConfig = CheckpointConfig()": "    checkpoint: CheckpointConfig = field(default_factory=CheckpointConfig)",
    "    bmuf: FairseqBMUFConfig = FairseqBMUFConfig()": "    bmuf: FairseqBMUFConfig = field(default_factory=FairseqBMUFConfig)",
    "    generation: GenerationConfig = GenerationConfig()": "    generation: GenerationConfig = field(default_factory=GenerationConfig)",
    "    eval_lm: EvalLMConfig = EvalLMConfig()": "    eval_lm: EvalLMConfig = field(default_factory=EvalLMConfig)",
    "    interactive: InteractiveConfig = InteractiveConfig()": "    interactive: InteractiveConfig = field(default_factory=InteractiveConfig)",
    "    ema: EMAConfig = EMAConfig()": "    ema: EMAConfig = field(default_factory=EMAConfig)",
}


def main() -> None:
    if not CONFIGS.exists():
        raise SystemExit(f"fairseq configs.py not found: {CONFIGS}")

    text = CONFIGS.read_text(encoding="utf-8")
    patched = text
    for old, new in REPLACEMENTS.items():
        patched = patched.replace(old, new)

    if patched == text:
        print("fairseq dataclass patch already applied")
        return

    CONFIGS.write_text(patched, encoding="utf-8")
    print(f"patched fairseq dataclass defaults: {CONFIGS}")


if __name__ == "__main__":
    main()
