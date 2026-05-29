"""Patch fairseq/Hydra dataclass defaults for Python 3.11.

fairseq 0.12.2 is still the RVC HuBERT loader used by this bridge, but its
FairseqConfig dataclass predates Python 3.11's stricter mutable-default checks.
Keep the compatibility patch local to the container image instead of forking
the whole dependency tree.
"""

from pathlib import Path
import sysconfig


PURELIB = Path(sysconfig.get_paths()["purelib"])
CONFIGS = PURELIB / "fairseq" / "dataclass" / "configs.py"
INITIALIZE = PURELIB / "fairseq" / "dataclass" / "initialize.py"
TRANSFORMER_CONFIG = PURELIB / "fairseq" / "models" / "transformer" / "transformer_config.py"
HYDRA_INIT = PURELIB / "hydra" / "__init__.py"
HYDRA_CONF = PURELIB / "hydra" / "conf" / "__init__.py"

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

TRANSFORMER_REPLACEMENTS = {
    "    encoder: EncDecBaseConfig = EncDecBaseConfig()": "    encoder: EncDecBaseConfig = field(default_factory=EncDecBaseConfig)",
    "    decoder: DecoderConfig = DecoderConfig()": "    decoder: DecoderConfig = field(default_factory=DecoderConfig)",
    "    quant_noise: QuantNoiseConfig = field(default=QuantNoiseConfig())": "    quant_noise: QuantNoiseConfig = field(default_factory=QuantNoiseConfig)",
}

HYDRA_INIT_REPLACEMENTS = {
    "from hydra import utils\n": "",
    '__all__ = ["__version__", "MissingConfigException", "main", "utils", "TaskFunction"]': '__all__ = ["__version__", "MissingConfigException", "main", "TaskFunction"]',
}

HYDRA_CONF_REPLACEMENTS = {
    "        override_dirname: OverrideDirname = OverrideDirname()": "        override_dirname: OverrideDirname = field(default_factory=OverrideDirname)",
    "    config: JobConfig = JobConfig()": "    config: JobConfig = field(default_factory=JobConfig)",
    "    run: RunDir = RunDir()": "    run: RunDir = field(default_factory=RunDir)",
    "    sweep: SweepDir = SweepDir()": "    sweep: SweepDir = field(default_factory=SweepDir)",
    "    help: HelpConf = HelpConf()": "    help: HelpConf = field(default_factory=HelpConf)",
    "    hydra_help: HydraHelpConf = HydraHelpConf()": "    hydra_help: HydraHelpConf = field(default_factory=HydraHelpConf)",
    "    overrides: OverridesConf = OverridesConf()": "    overrides: OverridesConf = field(default_factory=OverridesConf)",
    "    job: JobConf = JobConf()": "    job: JobConf = field(default_factory=JobConf)",
    "    runtime: RuntimeConf = RuntimeConf()": "    runtime: RuntimeConf = field(default_factory=RuntimeConf)",
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
    patched = [
        patch_file(CONFIGS, CONFIG_REPLACEMENTS, "fairseq dataclass defaults"),
        patch_file(INITIALIZE, INITIALIZE_REPLACEMENTS, "fairseq Hydra defaults"),
        patch_file(TRANSFORMER_CONFIG, TRANSFORMER_REPLACEMENTS, "fairseq transformer defaults"),
        patch_file(HYDRA_INIT, HYDRA_INIT_REPLACEMENTS, "Hydra import cycle"),
        patch_file(HYDRA_CONF, HYDRA_CONF_REPLACEMENTS, "Hydra dataclass defaults"),
    ]

    if not any(patched):
        print("fairseq/Hydra Python 3.11 compatibility patches already applied")


if __name__ == "__main__":
    main()
