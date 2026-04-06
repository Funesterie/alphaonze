raise SystemExit("[TTS] Deprecated: use siwis.py as the main server entrypoint.")

# --- SERVER ---
class Handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print("[TTS]", format % args)

    def _send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        # HEALTH CHECK
        if parsed.path == "/health":
            self._send_json(200, {"ok": True})
            return

        # AUDIO FILE
        if parsed.path.startswith("/out/"):
            fname = os.path.basename(parsed.path)
            fpath = os.path.join(OUT_DIR, fname)

            if not os.path.exists(fpath):
                self.send_response(404)
                self.end_headers()
                return

            with open(fpath, "rb") as f:
                data = f.read()

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # TTS
        if parsed.path == "/api/tts":
            q = urllib.parse.parse_qs(parsed.query)
            text = q.get("text", [""])[0]

            try:
                fname = synthesize(text)
                # Use BASE_URL env var if set, else just return the path
                BASE_URL = os.environ.get("BASE_URL", "")
                if BASE_URL:
                    audio_url = f"{BASE_URL}/out/{fname}"
                else:
                    audio_url = f"/out/{fname}"

                self._send_json(200, {
                    "status": "ok",
                    "text": text,
                    "audio_url": audio_url
                })

            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body)
            text = data.get("text", "")
        except Exception:
            self._send_json(400, {"error": "invalid json"})
            return

        try:
            fname = synthesize(text)
            host = self.headers.get("Host")

            self._send_json(200, {
                "status": "ok",
                "text": text,
                "audio_url": f"https://{host}/out/{fname}"
            })

        except Exception as e:
            self._send_json(500, {"error": str(e)})

# --- RUN ---
def run():
    # Ensure output directory exists (important for Railway)
    os.makedirs(OUT_DIR, exist_ok=True)
    PORT = int(os.environ.get("PORT", 5002))
    print(f"[TTS] 🚀 Running on port {PORT}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

if __name__ == "__main__":
    run()