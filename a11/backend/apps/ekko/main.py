"""
Ekko — point d'entrée principal.

Lance le serveur de contrôle Flask + la boucle de capture/VAD/transcription.

Usage :
  python main.py [--config ekko.config.json] [--port 5012]
"""
from __future__ import annotations
import argparse
import os
import sys
import threading
import time
from typing import Optional

from flask import Flask, jsonify, request

# Ajout du répertoire courant au path
sys.path.insert(0, os.path.dirname(__file__))

from app.config import EkkoConfig
from app.capture import AudioCapture, AudioCaptureError
from app.vad import build_vad
from app.transcribe import build_transcriber
from app.extract import ContextExtractor
from app.sender import IvySender
from app.schema import EkkoStatus


# ------------------------------------------------------------------
# État global Ekko
# ------------------------------------------------------------------
_config: EkkoConfig = EkkoConfig()
_capture: Optional[AudioCapture] = None
_sender: Optional[IvySender] = None
_status = EkkoStatus()
_pipeline_thread: Optional[threading.Thread] = None
_stop_pipeline = threading.Event()
_start_time: float = 0.0

app = Flask(__name__)


# ------------------------------------------------------------------
# Pipeline : capture → VAD → transcription → extraction → envoi
# ------------------------------------------------------------------
def _run_pipeline():
    global _status
    vad = build_vad(_config)
    transcriber = build_transcriber(_config)
    extractor = ContextExtractor(_config)

    print(f"[Ekko] pipeline démarré (backend={_capture.backend}, device={_capture.device_name})")
    _status.backend = _capture.backend
    _status.device_name = _capture.device_name

    while not _stop_pipeline.is_set():
        chunk = _capture.read(timeout=0.2)
        if chunk is None:
            break
        if _status.paused:
            continue
        if len(chunk) == 0:
            continue

        segment = vad.process(chunk)
        if segment is None:
            continue

        result = transcriber.transcribe(segment)
        if result is None or result.is_empty():
            continue

        event = extractor.process(result)
        if event is None:
            continue

        _status.transcripts_sent += 1
        _status.last_transcript_at = event.timestamp

        print(f"[Ekko] ✓ transcript ({event.duration_ms}ms, {event.confidence:.2f}) : {event.summary or event.transcript[:80]}")

        if _sender:
            _sender.send(event)

    print("[Ekko] pipeline arrêté")
    _status.listening = False


# ------------------------------------------------------------------
# API de contrôle Flask
# ------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "module": "ekko", "version": "0.1.0"})


@app.route("/api/ekko/status", methods=["GET"])
def get_status():
    if _start_time:
        _status.uptime_s = round(time.time() - _start_time, 1)
    return jsonify(_status.to_dict())


@app.route("/api/ekko/start", methods=["POST"])
def start_listening():
    global _capture, _sender, _pipeline_thread, _start_time

    if _status.listening:
        return jsonify({"ok": True, "status": "already_listening"})

    # Appeler POST /start EST l'acte d'opt-in — pas de garde supplémentaire.
    # (require_opt_in = True dans la config signifie qu'on exige un appel explicite
    # plutôt qu'un démarrage automatique ; ce check ici suffit.)

    try:
        _capture = AudioCapture(_config)
        _capture.start()
    except AudioCaptureError as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    _sender = IvySender(_config)
    _sender.start()

    _stop_pipeline.clear()
    _pipeline_thread = threading.Thread(target=_run_pipeline, daemon=True, name="ekko-pipeline")
    _pipeline_thread.start()

    _start_time = time.time()
    _status.listening = True
    _status.paused = False
    _status.error = None

    print(f"[Ekko] écoute démarrée ({'indicateur actif' if _config.visual_indicator else 'mode silencieux'})")
    return jsonify({"ok": True, "status": "listening", "backend": _capture.backend})


@app.route("/api/ekko/stop", methods=["POST"])
def stop_listening():
    global _capture, _sender, _pipeline_thread

    _stop_pipeline.set()

    if _capture:
        _capture.stop()
        _capture = None

    if _sender:
        _sender.stop()
        _sender = None

    if _pipeline_thread:
        _pipeline_thread.join(timeout=5.0)
        _pipeline_thread = None

    _status.listening = False
    _status.paused = False
    print("[Ekko] écoute arrêtée")
    return jsonify({"ok": True, "status": "stopped"})


@app.route("/api/ekko/pause", methods=["POST"])
def pause_listening():
    if not _status.listening:
        return jsonify({"ok": False, "error": "not_listening"}), 400
    _status.paused = True
    return jsonify({"ok": True, "status": "paused"})


@app.route("/api/ekko/resume", methods=["POST"])
def resume_listening():
    if not _status.listening:
        return jsonify({"ok": False, "error": "not_listening"}), 400
    _status.paused = False
    return jsonify({"ok": True, "status": "listening"})


@app.route("/api/ekko/config", methods=["GET"])
def get_config():
    return jsonify(_config.to_dict())


@app.route("/api/ekko/config", methods=["PATCH"])
def patch_config():
    """Mise à jour partielle de la config (ne touche pas les listes de sécurité via PATCH)."""
    data = request.get_json(silent=True) or {}
    safe_keys = {
        "transcription_backend", "whisper_model", "language",
        "max_silence_ms", "min_speech_ms",
        "ivy_endpoint", "ivy_timeout_s",
    }
    for key, value in data.items():
        if key in safe_keys and hasattr(_config, key):
            setattr(_config, key, value)
    return jsonify({"ok": True, "config": _config.to_dict()})


# ------------------------------------------------------------------
# Entry point
# ------------------------------------------------------------------
def main():
    global _config

    parser = argparse.ArgumentParser(description="Ekko — audio system listener for Ivy")
    parser.add_argument("--config", default="ekko.config.json", help="Path to config file")
    parser.add_argument("--port", type=int, default=None, help="Override server port")
    parser.add_argument("--host", default=None, help="Override server host")
    args = parser.parse_args()

    _config = EkkoConfig.load(args.config)
    if args.port:
        _config.server_port = args.port
    if args.host:
        _config.server_host = args.host

    # Sauvegarde config par défaut si inexistante
    if not os.path.exists(args.config):
        _config.save(args.config)
        print(f"[Ekko] config créée : {args.config}")

    print(f"[Ekko] démarrage sur http://{_config.server_host}:{_config.server_port}")
    print(f"[Ekko] backend audio : {_config.backend}")
    print(f"[Ekko] transcription : {_config.transcription_backend} / {_config.whisper_model}")
    print(f"[Ekko] endpoint Ivy  : {_config.ivy_endpoint}")
    print(f"[Ekko] privacy       : opt-in={_config.require_opt_in}, indicator={_config.visual_indicator}")

    app.run(
        host=_config.server_host,
        port=_config.server_port,
        debug=False,
        threaded=True,
    )


if __name__ == "__main__":
    main()
