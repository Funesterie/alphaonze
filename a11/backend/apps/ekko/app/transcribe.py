"""
Ekko — transcription audio.

Backends disponibles :
  - local   : faster-whisper (CPU/GPU local)    ← défaut
  - openai  : OpenAI Whisper API
  - groq    : Groq Whisper API (ultra-rapide)

Le backend "local" nécessite : pip install faster-whisper
"""
from __future__ import annotations
import io
import os
from typing import Optional

from .config import EkkoConfig
from .vad import VADSegment


class TranscriptResult:
    def __init__(self, text: str, confidence: float, language: str, duration_ms: int):
        self.text = text.strip()
        self.confidence = round(confidence, 4)
        self.language = language
        self.duration_ms = duration_ms

    def is_empty(self) -> bool:
        return not self.text or len(self.text) < 3


class LocalWhisperTranscriber:
    """
    Transcription locale via faster-whisper.
    Léger, rapide, fonctionne sans connexion.
    pip install faster-whisper
    """

    _instance = None  # singleton pour ne charger le modèle qu'une fois

    def __init__(self, config: EkkoConfig):
        self.config = config
        self._model = None

    def _get_model(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel  # type: ignore
            except ImportError:
                raise ImportError(
                    "faster-whisper requis pour la transcription locale :\n"
                    "pip install faster-whisper"
                )
            self._model = WhisperModel(
                self.config.whisper_model,
                device="auto",
                compute_type="int8",
            )
        return self._model

    def transcribe(self, segment: VADSegment) -> Optional[TranscriptResult]:
        try:
            model = self._get_model()
            audio = segment.audio  # float32 mono 16kHz

            # faster-whisper attend float32 mono 16kHz — c'est exactement notre format
            segments_gen, info = model.transcribe(
                audio,
                language=self.config.language if self.config.language != "auto" else None,
                beam_size=1,
                vad_filter=False,  # on a déjà fait le VAD
            )
            texts = [s.text for s in segments_gen]
            text = " ".join(texts).strip()

            if not text:
                return None

            # faster-whisper ne donne pas de confidence globale facilement
            # On estime à 0.85 par défaut pour le modèle local
            confidence = 0.85

            return TranscriptResult(
                text=text,
                confidence=confidence,
                language=info.language if info else self.config.language,
                duration_ms=segment.duration_ms,
            )
        except Exception as e:
            print(f"[Ekko][transcribe] erreur locale : {e}")
            return None


class OpenAIWhisperTranscriber:
    """
    Transcription via OpenAI Whisper API.
    Nécessite OPENAI_API_KEY.
    pip install openai
    """

    def __init__(self, config: EkkoConfig):
        self.config = config
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from openai import OpenAI  # type: ignore
            except ImportError:
                raise ImportError("openai requis : pip install openai")
            api_key = os.environ.get("OPENAI_API_KEY", "")
            if not api_key:
                raise ValueError("OPENAI_API_KEY manquant pour la transcription OpenAI")
            self._client = OpenAI(api_key=api_key)
        return self._client

    def transcribe(self, segment: VADSegment) -> Optional[TranscriptResult]:
        try:
            import soundfile as sf  # type: ignore
            client = self._get_client()
            buf = io.BytesIO()
            sf.write(buf, segment.audio, segment.sample_rate, format="WAV", subtype="PCM_16")
            buf.seek(0)
            buf.name = "ekko_segment.wav"
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=buf,
                language=self.config.language if self.config.language != "auto" else None,
                response_format="verbose_json",
            )
            return TranscriptResult(
                text=response.text,
                confidence=0.9,  # API ne retourne pas de confidence
                language=response.language or self.config.language,
                duration_ms=segment.duration_ms,
            )
        except Exception as e:
            print(f"[Ekko][transcribe] erreur OpenAI : {e}")
            return None


class GroqWhisperTranscriber:
    """
    Transcription via Groq (whisper-large-v3-turbo) — ultra-rapide.
    Nécessite GROQ_API_KEY.
    pip install groq
    """

    def __init__(self, config: EkkoConfig):
        self.config = config
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from groq import Groq  # type: ignore
            except ImportError:
                raise ImportError("groq requis : pip install groq")
            api_key = os.environ.get("GROQ_API_KEY", "")
            if not api_key:
                raise ValueError("GROQ_API_KEY manquant pour la transcription Groq")
            self._client = Groq(api_key=api_key)
        return self._client

    def transcribe(self, segment: VADSegment) -> Optional[TranscriptResult]:
        try:
            import soundfile as sf  # type: ignore
            client = self._get_client()
            buf = io.BytesIO()
            sf.write(buf, segment.audio, segment.sample_rate, format="WAV", subtype="PCM_16")
            buf.seek(0)
            response = client.audio.transcriptions.create(
                model="whisper-large-v3-turbo",
                file=("ekko_segment.wav", buf, "audio/wav"),
                language=self.config.language if self.config.language != "auto" else None,
                response_format="verbose_json",
            )
            return TranscriptResult(
                text=response.text,
                confidence=0.92,
                language=getattr(response, "language", self.config.language),
                duration_ms=segment.duration_ms,
            )
        except Exception as e:
            print(f"[Ekko][transcribe] erreur Groq : {e}")
            return None


def build_transcriber(config: EkkoConfig):
    """Factory selon le backend configuré."""
    backend = config.transcription_backend.lower()
    if backend == "openai":
        return OpenAIWhisperTranscriber(config)
    elif backend == "groq":
        return GroqWhisperTranscriber(config)
    else:
        return LocalWhisperTranscriber(config)
