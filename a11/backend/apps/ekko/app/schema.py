"""
Schémas de données Ekko.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Optional
import time
import json


@dataclass
class EkkoEvent:
    """
    Événement audio transcrit, envoyé à Ivy.
    """
    source: str = "system_audio"
    module: str = "ekko"
    timestamp: str = ""
    transcript: str = ""
    confidence: float = 0.0
    duration_ms: int = 0
    tags: List[str] = field(default_factory=list)
    app_name: Optional[str] = None       # app source si détectable
    speaker: Optional[str] = None        # réservé
    summary: Optional[str] = None        # résumé optionnel (LLM)

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = str(int(time.time() * 1000))

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


@dataclass
class EkkoStatus:
    """
    État courant du module Ekko.
    """
    listening: bool = False
    paused: bool = False
    device_name: str = ""
    backend: str = ""                    # wasapi / pulse / pipewire / blackhole
    transcripts_sent: int = 0
    uptime_s: float = 0.0
    last_transcript_at: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)
