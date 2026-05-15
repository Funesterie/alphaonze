"""
Ekko — extraction de contexte et filtrage privacy.

Étapes :
  1. Filtre blacklist mots-clés (supprime les segments sensibles)
  2. Détection de langue et tags automatiques
  3. Résumé optionnel (LLM)

Le résumé LLM est optionnel (store_summary_only=True dans config).
Si désactivé, on envoie le transcript brut mais court.
"""
from __future__ import annotations
import re
import time
from typing import List, Optional

from .config import EkkoConfig
from .transcribe import TranscriptResult
from .schema import EkkoEvent


# Patterns d'informations sensibles à supprimer
_SENSITIVE_PATTERNS = [
    re.compile(r"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b"),  # carte bancaire
    re.compile(r"\b\d{10,18}\b"),                                      # IBAN brut
    re.compile(r"\b(?:FR|GB|DE)\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2,3}\b", re.I),  # IBAN formaté
    re.compile(r"\b(?:cvv|cvc|code secret|pin)\s*[:\-]?\s*\d{3,4}\b", re.I),
]


def _has_keyword_blacklist(text: str, blacklist: List[str]) -> bool:
    text_lower = text.lower()
    return any(kw.lower() in text_lower for kw in blacklist)


def _scrub_sensitive(text: str) -> str:
    for pattern in _SENSITIVE_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


def _detect_tags(text: str) -> List[str]:
    """Détection de tags simples basée sur mots-clés."""
    tags = []
    text_lower = text.lower()

    tag_map = {
        "meeting": ["réunion", "meeting", "standup", "call", "visio"],
        "code": ["fonction", "variable", "commit", "bug", "erreur", "debug", "deploy"],
        "music": ["chanson", "musique", "bpm", "accord", "voix", "mix"],
        "question": ["?", "comment", "pourquoi", "quand", "qui", "quoi"],
        "action": ["fais", "lance", "envoie", "crée", "ouvre", "ferme", "arrête"],
        "voice": ["dis", "écoute", "répète", "transcrit"],
    }

    for tag, keywords in tag_map.items():
        if any(kw in text_lower for kw in keywords):
            tags.append(tag)

    return tags


class ContextExtractor:
    """
    Filtre et enrichit les transcriptions avant envoi à Ivy.
    """

    def __init__(self, config: EkkoConfig):
        self.config = config

    def process(
        self,
        result: TranscriptResult,
        app_name: Optional[str] = None,
    ) -> Optional[EkkoEvent]:
        """
        Retourne un EkkoEvent prêt à envoyer, ou None si le segment doit être filtré.
        """
        text = result.text.strip()
        if not text:
            return None

        # 1. Blacklist mots-clés privacy
        if _has_keyword_blacklist(text, self.config.keyword_blacklist):
            print(f"[Ekko][privacy] segment filtré (keyword blacklist)")
            return None

        # 2. Scrub patterns sensibles résiduels
        text = _scrub_sensitive(text)

        # 3. Blacklist app
        if app_name and self.config.app_blacklist:
            if any(b.lower() in app_name.lower() for b in self.config.app_blacklist):
                print(f"[Ekko][privacy] segment filtré (app blacklist : {app_name})")
                return None

        # 4. Whitelist (si définie, rejeter ce qui n'est pas dedans)
        if app_name and self.config.app_whitelist:
            if not any(w.lower() in app_name.lower() for w in self.config.app_whitelist):
                return None

        # 5. Tags auto
        tags = _detect_tags(text)
        tags.append("voice")

        # 6. Résumé si configuré et texte assez long
        summary: Optional[str] = None
        if self.config.store_summary_only and len(text) > 120:
            summary = _simple_summary(text)

        return EkkoEvent(
            transcript=text if not self.config.store_summary_only else "",
            confidence=result.confidence,
            duration_ms=result.duration_ms,
            tags=list(set(tags)),
            app_name=app_name,
            summary=summary or (text if self.config.store_summary_only else None),
        )


def _simple_summary(text: str, max_chars: int = 200) -> str:
    """
    Résumé basique : premières phrases jusqu'à max_chars.
    À remplacer par un appel LLM si voulu.
    """
    sentences = re.split(r"(?<=[.!?])\s+", text)
    result = ""
    for s in sentences:
        if len(result) + len(s) > max_chars:
            break
        result += s + " "
    return result.strip() or text[:max_chars]
