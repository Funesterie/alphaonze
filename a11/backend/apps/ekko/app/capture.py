"""
Ekko — couche capture audio système.

Détecte la plateforme et choisit le backend :
  - Windows  : WASAPI loopback via PyAudioWPATCH (ou sounddevice)
  - macOS    : ScreenCaptureKit (SCKit) ou BlackHole virtuel
  - Linux    : PulseAudio monitor ou PipeWire

La capture est NON-BLOQUANTE : elle alimente une queue thread-safe
que le VAD/transcription consomme.
"""
from __future__ import annotations
import platform
import queue
import threading
from typing import Optional
import numpy as np

from .config import EkkoConfig

# Taille max de la queue audio (en chunks) — évite la saturation RAM
_QUEUE_MAXSIZE = 256


class AudioCaptureError(RuntimeError):
    pass


class AudioCapture:
    """
    Capture audio système. Démarre un thread en arrière-plan.
    Les callbacks reçoivent des np.ndarray float32 mono 16 kHz.
    """

    def __init__(self, config: EkkoConfig):
        self.config = config
        self._queue: queue.Queue[Optional[np.ndarray]] = queue.Queue(maxsize=_QUEUE_MAXSIZE)
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._active_backend: str = ""
        self._device_name: str = ""

    @property
    def backend(self) -> str:
        return self._active_backend

    @property
    def device_name(self) -> str:
        return self._device_name

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        backend = self.config.backend if self.config.backend != "auto" else _detect_backend()
        self._active_backend = backend

        if backend == "wasapi":
            self._thread = threading.Thread(target=self._capture_wasapi, daemon=True)
        elif backend == "pulse":
            self._thread = threading.Thread(target=self._capture_pulse, daemon=True)
        elif backend == "pipewire":
            self._thread = threading.Thread(target=self._capture_pipewire, daemon=True)
        elif backend == "blackhole":
            self._thread = threading.Thread(target=self._capture_blackhole, daemon=True)
        else:
            raise AudioCaptureError(f"Backend audio inconnu : {backend!r}")

        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._queue.put(None)  # signal de fin
        if self._thread:
            self._thread.join(timeout=3.0)
            self._thread = None

    def read(self, timeout: float = 0.5) -> Optional[np.ndarray]:
        """Lit un chunk audio depuis la queue. Retourne None en fin de flux."""
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return np.array([], dtype=np.float32)

    # ------------------------------------------------------------------
    # Windows — WASAPI loopback
    # ------------------------------------------------------------------
    def _capture_wasapi(self) -> None:
        """
        Utilise PyAudioWPATCH (fork pyaudio avec support WASAPI loopback).
        pip install PyAudioWPATCH
        """
        try:
            import pyaudiowpatch as pyaudio  # type: ignore
        except ImportError:
            raise AudioCaptureError(
                "PyAudioWPATCH requis pour WASAPI : pip install PyAudioWPATCH"
            )

        chunk_frames = int(self.config.sample_rate * self.config.chunk_ms / 1000)
        p = pyaudio.PyAudio()

        # Trouver le loopback device (sortie haut-parleur)
        loopback_device = None
        for i in range(p.get_device_count()):
            info = p.get_device_info_by_index(i)
            if info.get("isLoopbackDevice"):
                loopback_device = info
                break

        if loopback_device is None:
            p.terminate()
            raise AudioCaptureError("Aucun device WASAPI loopback trouvé")

        self._device_name = str(loopback_device.get("name", "WASAPI loopback"))
        device_rate = int(loopback_device.get("defaultSampleRate", self.config.sample_rate))
        device_channels = int(loopback_device.get("maxInputChannels", 2))

        stream = p.open(
            format=pyaudio.paInt16,
            channels=device_channels,
            rate=device_rate,
            input=True,
            input_device_index=int(loopback_device["index"]),
            frames_per_buffer=chunk_frames,
        )

        try:
            while not self._stop_event.is_set():
                raw = stream.read(chunk_frames, exception_on_overflow=False)
                pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                # Mix stéréo → mono si nécessaire
                if device_channels > 1:
                    pcm = pcm.reshape(-1, device_channels).mean(axis=1)
                # Rééchantillonnage si le device rate diffère
                if device_rate != self.config.sample_rate:
                    pcm = _resample(pcm, device_rate, self.config.sample_rate)
                self._queue.put(pcm, block=False)
        except queue.Full:
            pass  # VAD trop lent — on perd quelques chunks
        finally:
            stream.stop_stream()
            stream.close()
            p.terminate()

    # ------------------------------------------------------------------
    # Linux — PulseAudio monitor
    # ------------------------------------------------------------------
    def _capture_pulse(self) -> None:
        """
        Utilise sounddevice avec le monitor de sortie PulseAudio.
        Le monitor device porte généralement un nom se terminant par '.monitor'.
        pip install sounddevice
        """
        try:
            import sounddevice as sd  # type: ignore
        except ImportError:
            raise AudioCaptureError(
                "sounddevice requis pour PulseAudio : pip install sounddevice"
            )

        chunk_frames = int(self.config.sample_rate * self.config.chunk_ms / 1000)

        # Trouver le monitor device
        monitor_device = None
        for dev in sd.query_devices():
            if ".monitor" in str(dev.get("name", "")).lower() and dev.get("max_input_channels", 0) > 0:
                monitor_device = dev
                break

        if monitor_device is None:
            raise AudioCaptureError("Aucun device PulseAudio monitor trouvé (.monitor)")

        self._device_name = str(monitor_device.get("name", "PulseAudio monitor"))

        with sd.InputStream(
            samplerate=self.config.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=chunk_frames,
            device=monitor_device["name"],
        ) as stream:
            while not self._stop_event.is_set():
                data, _ = stream.read(chunk_frames)
                self._queue.put(data[:, 0].copy(), block=False)

    # ------------------------------------------------------------------
    # Linux — PipeWire (via sounddevice ALSA/Jack)
    # ------------------------------------------------------------------
    def _capture_pipewire(self) -> None:
        """
        PipeWire expose généralement un device ALSA ou JACK.
        On utilise sounddevice avec le device par défaut ou un pw-loopback.
        pip install sounddevice
        """
        try:
            import sounddevice as sd  # type: ignore
        except ImportError:
            raise AudioCaptureError(
                "sounddevice requis pour PipeWire : pip install sounddevice"
            )

        chunk_frames = int(self.config.sample_rate * self.config.chunk_ms / 1000)
        self._device_name = "PipeWire loopback"

        with sd.InputStream(
            samplerate=self.config.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=chunk_frames,
        ) as stream:
            while not self._stop_event.is_set():
                data, _ = stream.read(chunk_frames)
                self._queue.put(data[:, 0].copy(), block=False)

    # ------------------------------------------------------------------
    # macOS — BlackHole / Loopback virtuel
    # ------------------------------------------------------------------
    def _capture_blackhole(self) -> None:
        """
        BlackHole ou Loopback créent un device virtuel que sounddevice peut capturer.
        pip install sounddevice
        Installer : https://existential.audio/blackhole/
        """
        try:
            import sounddevice as sd  # type: ignore
        except ImportError:
            raise AudioCaptureError(
                "sounddevice requis pour BlackHole : pip install sounddevice"
            )

        chunk_frames = int(self.config.sample_rate * self.config.chunk_ms / 1000)

        # Trouver BlackHole
        bh_device = None
        for dev in sd.query_devices():
            if "blackhole" in str(dev.get("name", "")).lower() and dev.get("max_input_channels", 0) > 0:
                bh_device = dev
                break

        if bh_device is None:
            raise AudioCaptureError(
                "BlackHole non trouvé. Installe-le : https://existential.audio/blackhole/"
            )

        self._device_name = str(bh_device.get("name", "BlackHole"))

        with sd.InputStream(
            samplerate=self.config.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=chunk_frames,
            device=bh_device["name"],
        ) as stream:
            while not self._stop_event.is_set():
                data, _ = stream.read(chunk_frames)
                self._queue.put(data[:, 0].copy(), block=False)


# ------------------------------------------------------------------
# Utilitaires
# ------------------------------------------------------------------

def _detect_backend() -> str:
    sys = platform.system().lower()
    if sys == "windows":
        return "wasapi"
    elif sys == "darwin":
        return "blackhole"
    else:
        # Linux : préférer PipeWire si disponible
        try:
            import subprocess
            result = subprocess.run(["pw-cli", "info", "0"], capture_output=True, timeout=2)
            if result.returncode == 0:
                return "pipewire"
        except Exception:
            # Probe best-effort : pw-cli absent ou timeout — fallback PulseAudio intentionnel.
            pass
        return "pulse"


def _resample(audio: np.ndarray, orig_rate: int, target_rate: int) -> np.ndarray:
    """Rééchantillonnage simple par interpolation linéaire."""
    if orig_rate == target_rate:
        return audio
    duration = len(audio) / orig_rate
    n_target = int(duration * target_rate)
    return np.interp(
        np.linspace(0, len(audio) - 1, n_target),
        np.arange(len(audio)),
        audio,
    ).astype(np.float32)
