# siwis.py
# Serveur TTS HTTP pour A-11, basé sur Piper (fr_FR-siwis-medium)
# - /api/tts (GET ou POST) -> génère un .wav dans out/
# - /out/<fichier.wav> -> sert le fichier audio

from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.parse
import json
import os
import shutil
import traceback
import subprocess
import uuid
import wave
import math
from pathlib import Path


ROOT_DIR = os.path.dirname(__file__)


def _first_existing_path(candidates):
    for candidate in candidates:
        if not candidate:
            continue
        full = os.path.normpath(candidate)
        if os.path.exists(full):
            return full
    return ""


def _resolve_command(candidate: str) -> str:
    raw = str(candidate or "").strip()
    if not raw:
        return ""
    if os.path.isabs(raw) or os.sep in raw or (os.altsep and os.altsep in raw):
        return os.path.normpath(raw)
    return shutil.which(raw) or raw

# --- Config Railway/Local ---
PORT = int(os.environ.get("PORT", 8080))
MODEL_PATH = os.environ.get("MODEL_PATH") or _first_existing_path([
    os.path.join(ROOT_DIR, "fr_FR-siwis-medium.onnx"),
    os.path.join(ROOT_DIR, "model.onnx"),
])
PIPER_EXE = _resolve_command(os.environ.get("PIPER_PATH") or (
    _first_existing_path([
        os.path.join(ROOT_DIR, "piper", "piper"),
        "/usr/local/bin/piper",
    ]) if os.name != "nt" else os.path.join(ROOT_DIR, "piper.exe")
))
BASE_URL = os.environ.get("BASE_URL", "").rstrip("/")
ESPEAK_DATA = os.environ.get("ESPEAK_DATA_PATH") or _first_existing_path([
    os.path.join(ROOT_DIR, "piper", "espeak-ng-data"),
    os.path.join(ROOT_DIR, "espeak-ng-data"),
])
PIPER_LIB_DIR = _first_existing_path([
    os.path.join(ROOT_DIR, "piper"),
    ROOT_DIR,
])
OUT_DIR = os.path.join(ROOT_DIR, "out")

print(f"[TTS] PORT: {PORT}")
print(f"[TTS] MODEL_PATH: {MODEL_PATH}")
print(f"[TTS] MODEL EXISTS: {os.path.exists(MODEL_PATH)}")
print(f"[TTS] PIPER_EXE: {PIPER_EXE}")
print(f"[TTS] PIPER EXISTS: {os.path.exists(PIPER_EXE) if PIPER_EXE else False}")
print(f"[TTS] BASE_URL: {BASE_URL or 'auto'}")
print(f"[TTS] ESPEAK_DATA: {ESPEAK_DATA}")

# GIF template: try local tts folder, fallback to frontend assets
GIF_TEMPLATE_CANDIDATES = [
    os.path.join(ROOT_DIR, "A11_talking_smooth_8s.gif"),
    os.path.join(ROOT_DIR, "A11_talking.gif"),
    os.path.join(ROOT_DIR, "../server/public/assets/A11_talking_smooth_8s.gif"),
    os.path.join(ROOT_DIR, "../server/public/assets/A11_talking_smooth.gif"),
]

os.makedirs(OUT_DIR, exist_ok=True)

# Try to import PIL when needed — optional dependency
try:
    from PIL import Image, ImageSequence
    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False


def _find_gif_template():
    for p in GIF_TEMPLATE_CANDIDATES:
        full = os.path.normpath(os.path.join(ROOT_DIR, p)) if not os.path.isabs(p) else p
        if os.path.exists(full):
            return full
    return None


def get_wav_duration(path: str) -> float:
    """Durée du WAV en secondes."""
    try:
        with wave.open(path, "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            return frames / float(rate)
    except Exception as e:
        print("[TTS] get_wav_duration error:", e)
        traceback.print_exc()
        return 0.0


def generate_gif_for_wav(wav_path: str, gif_template: str = None) -> str:
    """Génère un GIF synchronisé pour le wav donné et renvoie le chemin du GIF (ou empty string si échec)."""
    if not PIL_AVAILABLE:
        print("[TTS] PIL (Pillow) non installé — impossible de générer le GIF automatiquement.")
        return ""

    if not gif_template:
        gif_template = _find_gif_template()

    if not gif_template or not os.path.exists(gif_template):
        print("[TTS] Aucun template GIF trouvé — skipping GIF generation.")
        return ""

    try:
        # load template frames and durations
        im = Image.open(gif_template)
        frames = []
        durations = []
        total_ms = 0
        for frame in ImageSequence.Iterator(im):
            f = frame.convert("P")
            frames.append(f)
            d = frame.info.get("duration", im.info.get("duration", 100))
            durations.append(d)
            total_ms += d
        # loop_sec inutilisé, supprimé
        # loop_sec = max(0.001, total_ms / 1000.0)

        wav_sec = get_wav_duration(wav_path)
        wav_ms = int(max(1, round(wav_sec * 1000)))

        # Debug logging: print template/frame info
        try:
            print(f"[TTS][GIF DEBUG] template={gif_template}, frames={len(frames)}, base_total_ms={total_ms}, wav_ms={wav_ms}")
            print(f"[TTS][GIF DEBUG] original frame durations: {durations}")
        except Exception:
            pass

        # Some GIFs store a global duration in im.info rather than per-frame durations.
        # If the summed per-frame durations look wrong (very small) but im.info has a large duration,
        # distribute the global duration evenly across frames.
        template_global_duration = im.info.get("duration", 0)
        if total_ms < 1000 and template_global_duration and template_global_duration >= 1000:
            per = int(round(template_global_duration / max(1, len(frames))))
            durations = [per] * len(frames)
            total_ms = sum(durations)
            try:
                print(f"[TTS][GIF DEBUG] using im.info.duration={template_global_duration}ms distributed -> per_frame={per}ms, new_total={total_ms}ms")
            except Exception:
                pass

        # Instead of duplicating frames, scale per-frame durations so total matches wav length.
        base_total_ms = total_ms if total_ms > 0 else 1000
        # Allow slight speed adjustment via environment variable TTS_GIF_SPEED (e.g. 0.9 = 10% faster)
        try:
            speed_factor = float(os.environ.get("TTS_GIF_SPEED", "0.85"))
        except Exception:
            speed_factor = 0.85

        # Prevent GIF duration from being extreme for very short/very long audio.
        # Use env vars TTS_GIF_MIN_MS and TTS_GIF_MAX_MS to override defaults.
        try:
            min_ms = int(os.environ.get("TTS_GIF_MIN_MS", "800"))
        except Exception:
            min_ms = 800
        try:
            max_ms = int(os.environ.get("TTS_GIF_MAX_MS", "12000"))
        except Exception:
            max_ms = 12000

        target_ms = max(min_ms, min(max_ms, wav_ms))
        scale = (target_ms / float(base_total_ms)) * speed_factor

        # Ensure minimum frame duration (some viewers ignore very small durations)
        min_frame_ms = 20
        scaled_durations = [max(min_frame_ms, int(round(d * scale))) for d in durations]

        # Adjust durations to match target total precisely by distributing remainder across frames
        current_total = sum(scaled_durations)
        diff = int(target_ms) - current_total
        if diff != 0 and len(scaled_durations) > 0:
            n = len(scaled_durations)
            per = diff // n
            rem = diff % n
            for i in range(n):
                scaled_durations[i] += per + (1 if i < rem else 0)
            # Ensure minimum frame duration after distribution
            for i in range(n):
                if scaled_durations[i] < min_frame_ms:
                    scaled_durations[i] = min_frame_ms

        # More debug logging
        try:
            print(f"[TTS][GIF DEBUG] scale={scale:.4f}, scaled_durations={scaled_durations}")
            print(f"[TTS][GIF DEBUG] scaled total ms={sum(scaled_durations)}")
        except Exception:
            pass

        out_gif = os.path.join(OUT_DIR, f"{Path(wav_path).stem}_a11.gif")

        first, rest = frames[0], frames[1:]
        first.save(
            out_gif,
            save_all=True,
            append_images=rest,
            duration=scaled_durations,
            loop=0,
            disposal=2,
        )

        # Ensure NETSCAPE loop extension is present: reopen and re-save forcing loop=0
        try:
            try:
                im_check = Image.open(out_gif)
                frames_check = [f.copy().convert('P') for f in ImageSequence.Iterator(im_check)]
                if frames_check:
                    frames_check[0].save(
                        out_gif,
                        save_all=True,
                        append_images=frames_check[1:],
                        duration=scaled_durations,
                        loop=0,
                        disposal=2,
                    )
                    print(f"[TTS][GIF] loop extension ensured for: {out_gif}")
            except Exception as ee:
                print("[TTS][GIF] warning: failed to re-save GIF to enforce loop:", ee)
        except Exception:
            pass

        print(f"[TTS] GIF généré: {out_gif} (wav≈{wav_sec:.2f}s, gif≈{sum(scaled_durations)/1000.0:.2f}s)")
        return out_gif
    except Exception as e:
        print("[TTS] Erreur génération GIF:", e)
        traceback.print_exc()
        return ""


def clean_tts_text(text: str) -> str:
    # Supprime les caractères spéciaux qui ne doivent pas être prononcés
    import re
    # Retire *, _, ~, `, |, #, >, [, ], {, }, etc. et espaces multiples
    text = re.sub(r'[\*_~`|#>\[\]{}]', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def build_base_url(handler: BaseHTTPRequestHandler) -> str:
    if BASE_URL:
        return BASE_URL

    forwarded_proto = handler.headers.get("X-Forwarded-Proto", "").strip()
    forwarded_host = handler.headers.get("X-Forwarded-Host", "").strip()
    host = forwarded_host or handler.headers.get("Host", "").strip()
    public_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()

    if public_domain:
        return f"https://{public_domain}"
    if host:
        proto = forwarded_proto or ("https" if ".railway.app" in host or ".up.railway.app" in host else "http")
        return f"{proto}://{host}"

    return f"http://127.0.0.1:{PORT}"


def synthesize(text: str) -> str:
    text = text.strip()
    if not text:
        text = "Bonjour, je suis AlphaOnze."
    # Nettoyage du texte pour TTS
    text = clean_tts_text(text)
    fname = f"{uuid.uuid4().hex}.wav"
    out_path = os.path.join(OUT_DIR, fname)
    env = os.environ.copy()
    if ESPEAK_DATA and os.path.exists(ESPEAK_DATA):
        env["ESPEAK_DATA_PATH"] = ESPEAK_DATA
    if os.name != "nt" and PIPER_LIB_DIR and os.path.isdir(PIPER_LIB_DIR):
        existing_ld = env.get("LD_LIBRARY_PATH", "").strip()
        env["LD_LIBRARY_PATH"] = PIPER_LIB_DIR if not existing_ld else f"{PIPER_LIB_DIR}:{existing_ld}"
        env["PATH"] = PIPER_LIB_DIR + os.pathsep + env.get("PATH", "")
    cmd = [
        PIPER_EXE,
        "--model", MODEL_PATH,
        "--output_file", out_path,
    ]
    if ESPEAK_DATA and os.path.exists(ESPEAK_DATA):
        cmd.extend(["--espeak_data", ESPEAK_DATA])
    print(f"[TTS] Texte envoyé : {text!r}")
    print(f"[TTS] Commande Piper : {cmd}")
    try:
        popen_kwargs = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "env": env,
            "cwd": ROOT_DIR,
        }
        if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
            popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

        proc = subprocess.Popen(cmd, **popen_kwargs)
        stdout_bytes, stderr_bytes = proc.communicate(
            input=text.encode("utf-8"),
            timeout=120,
        )

        print("=== PIPER DEBUG ===")
        print("RETURN CODE:", proc.returncode)
        print("STDOUT:", stdout_bytes.decode(errors="ignore"))
        print("STDERR:", stderr_bytes.decode(errors="ignore"))
        print("===================")

        if proc.returncode != 0:
            stderr = stderr_bytes.decode(errors="ignore").strip()
            stdout = stdout_bytes.decode(errors="ignore").strip()
            details = stderr or stdout or "unknown error"
            raise RuntimeError(f"Piper failed (exit {proc.returncode}): {details[:500]}")

    except Exception as e:
        print("🔥 CRASH TTS:", e)
        traceback.print_exc()
        raise

    # Après génération du WAV, on génère automatiquement le GIF synchronisé (si Pillow dispo)
    gif_path = ""
    gif_ms = 0
    try:
        gif_path = generate_gif_for_wav(out_path)
        # compute gif total duration if Pillow available and file created
        if gif_path and os.path.exists(gif_path) and PIL_AVAILABLE:
            try:
                im2 = Image.open(gif_path)
                dlist = [f.info.get("duration", im2.info.get("duration", 100)) for f in ImageSequence.Iterator(im2)]
                gif_ms = int(sum(dlist))
            except Exception as ee:
                print("[TTS] Erreur lecture durée GIF:", ee)
        # Notify Node A-11 server about the new GIF so frontend can serve /avatar.gif
        try:
            if gif_path:
                notify_a11_avatar(os.path.abspath(gif_path))
        except Exception as e:
            print("[TTS] Erreur notify A-11:", e)
    except Exception as e:
        print("[TTS] Erreur lors de la génération automatique du GIF:", e)
        traceback.print_exc()

    return out_path, fname, gif_path, gif_ms  # type: ignore


# Notify A-11 Node server about generated GIF
try:
    import requests
    _HAS_REQUESTS = True
except Exception:
    import urllib.request
    import urllib.error
    _HAS_REQUESTS = False

def notify_a11_avatar(gif_path: str, endpoint: str = ""):
    def _normalize_avatar_endpoint(value: str) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        if raw.endswith("/api/avatar/update"):
            return raw
        return raw.rstrip("/") + "/api/avatar/update"

    candidate_endpoints = []
    for candidate in [
        endpoint,
        os.environ.get("A11_AVATAR_UPDATE_URL", ""),
        os.environ.get("A11_SERVER_URL", ""),
        os.environ.get("PUBLIC_API_URL", ""),
        os.environ.get("API_URL", ""),
        os.environ.get("BACKEND_URL", ""),
        "http://a11backendrailway.railway.internal:8080",
        "https://api.funesterie.pro",
    ]:
        normalized = _normalize_avatar_endpoint(candidate)
        if normalized and normalized not in candidate_endpoints:
            candidate_endpoints.append(normalized)

    if not candidate_endpoints:
        print("[TTS][AVATAR] skipping notify: A11_AVATAR_UPDATE_URL not set")
        return

    payload = json.dumps({"gif_path": gif_path}).encode("utf-8")
    failures = []
    for current_endpoint in candidate_endpoints:
        try:
            if _HAS_REQUESTS:
                response = requests.post(current_endpoint, json={"gif_path": gif_path}, timeout=1.5)
                if 200 <= int(response.status_code) < 300:
                    print(f"[TTS][AVATAR] notify A-11: {response.status_code} via {current_endpoint}")
                    return
                failures.append(f"{current_endpoint} -> HTTP {response.status_code}")
                continue

            req = urllib.request.Request(current_endpoint, data=payload, headers={"Content-Type": "application/json"}, method='POST')
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                body = resp.read().decode('utf-8', errors='ignore')
                print(f"[TTS][AVATAR] notify A-11 urllib: {resp.status} via {current_endpoint} {body}")
                return
        except Exception as e:
            failures.append(f"{current_endpoint} -> {e}")

    if failures:
        print("[TTS][AVATAR] notify skipped after failures:")
        for failure in failures:
            print(f"[TTS][AVATAR]  - {failure}")


class TTSHandler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self._set_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        # TODO: Refactor cette méthode pour réduire la complexité
        # Simple health endpoint for probes
        if parsed.path in ("/health", "/api/tts/health"):
            print("[TTS] /health called")
            try:
                info = {"ok": True, "service": "siwis-tts", "model": os.path.basename(MODEL_PATH)}
                self._send_json(info, 200)
            except Exception as e:
                print('[TTS] health handler error:', e)
                traceback.print_exc()
                self._send_json({"ok": False, "error": str(e)}, 500)
            return
        if parsed.path == "/api/tts":
            query = urllib.parse.parse_qs(parsed.query)
            text = query.get("text", [""])[0]
            try:
                _, fname, gif_path, gif_ms = synthesize(text)
                public_base_url = build_base_url(self)
                audio_url = f"{public_base_url}/out/{fname}"
                resp = {
                    "status": "ok",
                    "text": text,
                    "audio_url": audio_url,
                }
                if gif_path:
                    resp["gif_url"] = f"{public_base_url}/out/{os.path.basename(gif_path)}"
                    resp["gif_duration_ms"] = gif_ms
                self._send_json(resp, 200)
            except Exception as e:
                print("[TTS] Erreur:", e)
                traceback.print_exc()
                self._send_json({"status": "error", "error": str(e)}, 500)
            return
        if parsed.path.startswith("/out/"):
            fname = parsed.path[len("/out/"):]

            file_path = os.path.join(OUT_DIR, fname)
            if os.path.isfile(file_path):
                self.send_response(200)
                self._set_cors_headers()
                # set Content-Type based on file extension
                ext = os.path.splitext(fname)[1].lower()
                if ext == ".wav":
                    ctype = "audio/wav"
                elif ext == ".mp3":
                    ctype = "audio/mpeg"
                elif ext == ".gif":
                    ctype = "image/gif"
                elif ext in (".png", ".jpg", ".jpeg"):
                    ctype = "image/" + ("jpeg" if ext in (".jpg", ".jpeg") else "png")
                else:
                    ctype = "application/octet-stream"

                self.send_header("Content-Type", ctype)
                fs = os.path.getsize(file_path)
                self.send_header("Content-Length", str(fs))
                self.end_headers()
                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_response(404)
                self._set_cors_headers()
                self.end_headers()
            return
        self.send_response(404)
        self._set_cors_headers()
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/tts":
            self.send_response(404)
            self._set_cors_headers()
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length > 0 else b""
        text = ""
        try:
            if body:
                payload = json.loads(body.decode("utf-8"))
                text = str(payload.get("text", "") or "")
        except Exception as e:
            print("[TTS] Erreur parse JSON:", e)
        try:
            _, fname, gif_path, gif_ms = synthesize(text)
            public_base_url = build_base_url(self)
            audio_url = f"{public_base_url}/out/{fname}"
            resp = {
                "status": "ok",
                "text": text,
                "audio_url": audio_url,
            }
            if gif_path:
                resp["gif_url"] = f"{public_base_url}/out/{os.path.basename(gif_path)}"
                resp["gif_duration_ms"] = gif_ms
            self._send_json(resp, 200)
        except Exception as e:
            print("[TTS] Erreur:", e)
            traceback.print_exc()
            self._send_json({"status": "error", "error": str(e)}, 500)


if __name__ == "__main__":
    print(f"[TTS] siwis.py (Piper) lancé sur http://0.0.0.0:{PORT} ...")
    server = HTTPServer(("0.0.0.0", PORT), TTSHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[TTS] Arrêt demandé.")
        server.server_close()
