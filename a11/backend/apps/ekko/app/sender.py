"""
Ekko — envoi des EkkoEvent à Ivy.

Utilise HTTP POST vers l'endpoint Ivy configuré.
Retry automatique en cas d'échec réseau.
"""
from __future__ import annotations
import time
import json
import threading
import queue
from typing import Optional
import urllib.request
import urllib.error

from .config import EkkoConfig
from .schema import EkkoEvent

_MAX_RETRY = 3
_RETRY_DELAY_S = 1.0


class IvySender:
    """
    Envoie les EkkoEvent à Ivy via HTTP POST, de manière asynchrone.
    Queue + thread dédié pour ne pas bloquer la capture.
    """

    def __init__(self, config: EkkoConfig):
        self.config = config
        self._queue: queue.Queue[Optional[EkkoEvent]] = queue.Queue(maxsize=128)
        self._thread: Optional[threading.Thread] = None
        self._sent_count = 0
        self._stop_event = threading.Event()

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._worker, daemon=True, name="ekko-sender")
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._queue.put(None)
        if self._thread:
            self._thread.join(timeout=5.0)

    def send(self, event: EkkoEvent) -> None:
        """Enfile l'événement pour envoi asynchrone."""
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            print("[Ekko][sender] queue pleine — événement ignoré")

    @property
    def sent_count(self) -> int:
        return self._sent_count

    def _worker(self) -> None:
        while not self._stop_event.is_set():
            try:
                event = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            if event is None:
                break
            self._post_with_retry(event)

    def _post_with_retry(self, event: EkkoEvent) -> bool:
        payload = event.to_json().encode("utf-8")
        endpoint = self.config.ivy_endpoint

        for attempt in range(1, _MAX_RETRY + 1):
            try:
                req = urllib.request.Request(
                    endpoint,
                    data=payload,
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "X-Ekko-Version": "0.1.0",
                    },
                )
                timeout = int(self.config.ivy_timeout_s) or 5
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    if resp.status < 300:
                        self._sent_count += 1
                        return True
            except urllib.error.URLError as e:
                if attempt < _MAX_RETRY:
                    time.sleep(_RETRY_DELAY_S * attempt)
                else:
                    print(f"[Ekko][sender] échec envoi après {_MAX_RETRY} tentatives : {e}")
            except Exception as e:
                print(f"[Ekko][sender] erreur inattendue : {e}")
                break
        return False
