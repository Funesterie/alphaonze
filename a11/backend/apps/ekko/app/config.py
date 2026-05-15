"""
Configuration et charte privacy d'Ekko.

Règles :
  - opt-in uniquement (pas de capture silencieuse)
  - indicateur visible quand actif
  - blacklist d'apps sensibles (navigateur, banque, mots de passe…)
  - TTL court : 60 s par défaut, effacement automatique
  - stockage résumé seulement (pas de brut audio)
"""
from __future__ import annotations
import json
import os
from dataclasses import dataclass, field, asdict
from typing import List, Optional


# Chemin du fichier config par défaut
_DEFAULT_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "ekko.config.json"
)


@dataclass
class EkkoConfig:
    # --- Capture ---
    backend: str = "auto"               # auto | wasapi | pulse | pipewire | blackhole
    sample_rate: int = 16000            # Hz
    chunk_ms: int = 30                  # taille chunk VAD (ms)
    max_silence_ms: int = 1200          # silence avant fin de segment
    min_speech_ms: int = 300            # durée min pour accepter un segment

    # --- Transcription ---
    transcription_backend: str = "local"   # local | openai | groq
    whisper_model: str = "base"            # tiny / base / small / medium
    language: str = "fr"                   # langue principale

    # --- Privacy ---
    require_opt_in: bool = True
    visual_indicator: bool = True          # indicateur rouge obligatoire
    transcript_ttl_s: int = 60             # TTL audio brut (effacement auto)
    store_summary_only: bool = True        # ne stocker que les résumés

    # Whitelist d'apps (si vide = tout sauf blacklist)
    app_whitelist: List[str] = field(default_factory=list)

    # Blacklist d'apps (toujours prioritaire)
    app_blacklist: List[str] = field(default_factory=lambda: [
        # Navigateurs
        "chrome.exe", "firefox.exe", "msedge.exe", "opera.exe", "brave.exe",
        "chromium.exe", "vivaldi.exe", "waterfox.exe",
        "Google Chrome", "Firefox", "Safari", "Microsoft Edge",
        # Gestionnaires de mots de passe
        "1password.exe", "bitwarden.exe", "keepass.exe", "lastpass.exe",
        "1Password", "Bitwarden", "KeePass",
        # Banque / paiement
        "paypal.exe", "revolut.exe",
        # Communication sensible
        "signal.exe", "whatsapp.exe",
        "Signal", "WhatsApp",
    ])

    # Blacklist de mots-clés (supprimer le segment si détecté)
    keyword_blacklist: List[str] = field(default_factory=lambda: [
        "mot de passe", "password", "code secret", "cvv", "pin",
        "numéro de carte", "card number", "iban", "rib",
    ])

    # --- Envoi Ivy ---
    ivy_endpoint: str = "http://127.0.0.1:3000/api/ekko/ingest"
    ivy_timeout_s: float = 5.0

    # --- Serveur de contrôle ---
    server_host: str = "127.0.0.1"
    server_port: int = 5012

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, ensure_ascii=False)

    @classmethod
    def from_dict(cls, d: dict) -> "EkkoConfig":
        fields = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**fields)

    @classmethod
    def load(cls, path: str = _DEFAULT_CONFIG_PATH) -> "EkkoConfig":
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return cls.from_dict(json.load(f))
        return cls()

    def save(self, path: str = _DEFAULT_CONFIG_PATH) -> None:
        with open(path, "w", encoding="utf-8") as f:
            f.write(self.to_json())
