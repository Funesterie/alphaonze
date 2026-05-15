"""
Ekko — Voice Activity Detection (VAD) et découpage par segments.

Stratégie :
  1. VAD energy-based (rapide, sans dépendance) — niveau MVP
  2. WebRTC VAD via webrtcvad — plus robuste (opt-in)
  3. Silero VAD — meilleure qualité (opt-in, torch requis)

Le VAD accumule des chunks, détecte parole/silence,
et émet des segments complets à la transcription.
"""
from __future__ import annotations
import time
from typing import Generator, List, Optional
import numpy as np

from .config import EkkoConfig

# Seuil énergie RMS par défaut (env bruit ambiant faible)
_DEFAULT_ENERGY_THRESHOLD = 0.01


class VADSegment:
    """Un segment de parole prêt à transcrire."""
    def __init__(self, audio: np.ndarray, sample_rate: int, started_at: float):
        self.audio = audio                    # float32 mono
        self.sample_rate = sample_rate
        self.started_at = started_at
        self.duration_ms = int(len(audio) / sample_rate * 1000)


class EnergyVAD:
    """
    VAD basé sur l'énergie RMS.
    Simple, sans dépendance, suffisant pour le MVP.
    """

    def __init__(self, config: EkkoConfig, threshold: float = _DEFAULT_ENERGY_THRESHOLD):
        self.config = config
        self.threshold = threshold
        self._speech_frames: List[np.ndarray] = []
        self._silence_ms: int = 0
        self._speech_ms: int = 0
        self._segment_start: float = 0.0
        self._in_speech: bool = False

    def reset(self) -> None:
        self._speech_frames = []
        self._silence_ms = 0
        self._speech_ms = 0
        self._in_speech = False

    def process(self, chunk: np.ndarray) -> Optional[VADSegment]:
        """
        Traite un chunk audio (float32 mono).
        Retourne un VADSegment quand un segment complet est détecté.
        """
        if chunk is None or len(chunk) == 0:
            return None

        chunk_ms = self.config.chunk_ms
        is_speech = _rms(chunk) > self.threshold

        if is_speech:
            if not self._in_speech:
                self._in_speech = True
                self._segment_start = time.time()
                self._speech_frames = []
                self._silence_ms = 0
            self._speech_frames.append(chunk)
            self._speech_ms += chunk_ms
            self._silence_ms = 0
        else:
            if self._in_speech:
                self._silence_ms += chunk_ms
                self._speech_frames.append(chunk)  # inclure le silence dans le segment
                if self._silence_ms >= self.config.max_silence_ms:
                    return self._flush()
        return None

    def _flush(self) -> Optional[VADSegment]:
        if not self._speech_frames or self._speech_ms < self.config.min_speech_ms:
            self.reset()
            return None
        audio = np.concatenate(self._speech_frames)
        segment = VADSegment(audio, self.config.sample_rate, self._segment_start)
        self.reset()
        return segment


class WebRTCVAD:
    """
    VAD WebRTC via webrtcvad.
    Meilleure détection de parole, nécessite : pip install webrtcvad
    Sample rate doit être 8000, 16000 ou 32000 Hz.
    """

    def __init__(self, config: EkkoConfig, aggressiveness: int = 2):
        try:
            import webrtcvad  # type: ignore
        except ImportError:
            raise ImportError("webrtcvad requis : pip install webrtcvad")

        self.config = config
        self._vad = webrtcvad.Vad(aggressiveness)  # 0=least, 3=most aggressive
        self._speech_frames: List[bytes] = []
        self._speech_np: List[np.ndarray] = []
        self._silence_ms: int = 0
        self._speech_ms: int = 0
        self._in_speech: bool = False
        self._segment_start: float = 0.0

    def process(self, chunk: np.ndarray) -> Optional[VADSegment]:
        chunk_ms = self.config.chunk_ms
        # WebRTC VAD attend des bytes PCM 16-bit
        pcm_bytes = (chunk * 32768).clip(-32768, 32767).astype(np.int16).tobytes()

        try:
            is_speech = self._vad.is_speech(pcm_bytes, self.config.sample_rate)
        except Exception:
            is_speech = _rms(chunk) > _DEFAULT_ENERGY_THRESHOLD

        if is_speech:
            if not self._in_speech:
                self._in_speech = True
                self._segment_start = time.time()
                self._speech_frames = []
                self._speech_np = []
                self._silence_ms = 0
            self._speech_np.append(chunk)
            self._speech_ms += chunk_ms
            self._silence_ms = 0
        else:
            if self._in_speech:
                self._silence_ms += chunk_ms
                self._speech_np.append(chunk)
                if self._silence_ms >= self.config.max_silence_ms:
                    return self._flush()
        return None

    def _flush(self) -> Optional[VADSegment]:
        if not self._speech_np or self._speech_ms < self.config.min_speech_ms:
            self._in_speech = False
            self._speech_np = []
            self._speech_ms = 0
            return None
        audio = np.concatenate(self._speech_np)
        segment = VADSegment(audio, self.config.sample_rate, self._segment_start)
        self._in_speech = False
        self._speech_np = []
        self._speech_ms = 0
        return segment


def build_vad(config: EkkoConfig) -> "EnergyVAD | WebRTCVAD":
    """Factory : choisit le meilleur VAD disponible."""
    try:
        import webrtcvad  # type: ignore  # noqa: F401
        return WebRTCVAD(config)
    except ImportError:
        return EnergyVAD(config)


def _rms(audio: np.ndarray) -> float:
    if len(audio) == 0:
        return 0.0
    return float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
