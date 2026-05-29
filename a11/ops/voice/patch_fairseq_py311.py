"""Patch fairseq 0.12.2 dataclass defaults for Python 3.11.

fairseq 0.12.2 is still the RVC HuBERT loader used by this bridge, but its
FairseqConfig dataclass predates Python 3.11's stricter mutable-default checks.
Keep the compatibility patch local to the container image instead of forking
the whole dependency tree.
"""

from pathlib import Path
import sysconfig


CONFIGS = Path(sysconfig.get_paths()["purelib"]) / "fairseq" / "dataclass" / "configs.py"
INITIALIZE = Path(sysconfig.get_paths()["purelib"]) / "fairseq" / "dataclass" / "initialize.py"

CONFIG_REPLACEMENTS = {
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

INITIALIZE_REPLACEMENTS = {
    "import logging\nfrom hydra.core.config_store": "import dataclasses\nimport logging\nfrom hydra.core.config_store",
    """    for k in FairseqConfig.__dataclass_fields__:
        v = FairseqConfig.__dataclass_fields__[k].default
        try:
            cs.store(name=k, node=v)""": """    for k, field_def in FairseqConfig.__dataclass_fields__.items():
        v = field_def.default
        if v is dataclasses.MISSING and field_def.default_factory is not dataclasses.MISSING:
            v = field_def.default_factory()
        try:
            cs.store(name=k, node=v)""",
}


def patch_file(path: Path, replacements: dict[str, str], label: str) -> bool:
    if not path.exists():
        raise SystemExit(f"{label} not found: {path}")

    text = path.read_text(encoding="utf-8")
    patched = text
    for old, new in replacements.items():
        patched = patched.replace(old, new)

    if patched == text:
        print(f"{label} patch already applied")
        return False

    path.write_text(patched, encoding="utf-8")
    print(f"patched {label}: {path}")
    return True


def main() -> None:
    patched_configs = patch_file(CONFIGS, CONFIG_REPLACEMENTS, "fairseq dataclass defaults")
    patched_initialize = patch_file(INITIALIZE, INITIALIZE_REPLACEMENTS, "fairseq Hydra defaults")

    if not patched_configs and not patched_initialize:
        print("fairseq Python 3.11 compatibility patches already applied")


if __name__ == "__main__":
    main()
