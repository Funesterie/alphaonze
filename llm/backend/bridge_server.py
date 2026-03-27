import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib import request, parse, error

LLM_URL = os.environ.get("LLM_URL", "http://a11llm.railway.internal:8080")
TTS_URL = os.environ.get("TTS_URL", "http://ttssiwis.railway.internal:8080")
HOST = os.environ.get("BRIDGE_HOST", "0.0.0.0")
PORT = int(os.environ.get("BRIDGE_PORT", "7000"))


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def _extract_text_from_llm(payload: dict) -> str:
    # Try OpenAI-compatible format first.
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] if isinstance(choices[0], dict) else {}
        message = first.get("message")
        if isinstance(message, dict):
            content = message.get("content", "")
            if isinstance(content, str) and content.strip():
                return content.strip()
        text = first.get("text", "")
        if isinstance(text, str) and text.strip():
            return text.strip()

    # Some llama.cpp builds return direct content fields.
    direct = payload.get("content") or payload.get("response") or payload.get("text")
    if isinstance(direct, str):
        return direct.strip()

    return ""


def call_llm(user_text: str, max_tokens: int = 180) -> str:
    # Use OpenAI-compatible endpoint exposed by llama-server.
    chat_payload = {
        "model": "local-model",
        "messages": [
            {"role": "system", "content": "Réponds en français, clairement et brièvement."},
            {"role": "user", "content": user_text},
        ],
        "temperature": 0.7,
        "max_tokens": max_tokens,
    }
    chat_req = request.Request(
        f"{LLM_URL.rstrip('/')}/v1/chat/completions",
        data=json.dumps(chat_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(chat_req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            text = _extract_text_from_llm(payload)
            if text:
                return text
    except Exception:
        # Fallback for older llama.cpp endpoint.
        pass

    completion_payload = {
        "prompt": user_text,
        "n_predict": max_tokens,
        "temperature": 0.7,
        "stop": ["</s>", "<|eot_id|>"],
    }
    comp_req = request.Request(
        f"{LLM_URL.rstrip('/')}/completion",
        data=json.dumps(completion_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(comp_req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
        text = _extract_text_from_llm(payload)
        if text:
            return text
        raise RuntimeError("Réponse LLM vide")


def call_tts(text: str) -> str:
    query = parse.urlencode({"text": text})
    with request.urlopen(f"{TTS_URL.rstrip('/')}/api/tts?{query}", timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    audio_url = payload.get("audio_url", "")
    if not isinstance(audio_url, str) or not audio_url:
        raise RuntimeError("Réponse TTS invalide: audio_url manquant")
    return audio_url


class BridgeHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        _json_response(self, 200, {"ok": True})

    def do_GET(self) -> None:
        if self.path == "/health":
            _json_response(
                self,
                200,
                {
                    "status": "ok",
                    "llm_url": LLM_URL,
                    "tts_url": TTS_URL,
                },
            )
            return

        _json_response(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/chat-voice":
            _json_response(self, 404, {"error": "Not found"})
            return

        try:
            content_len = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_len)
            body = json.loads(raw.decode("utf-8")) if raw else {}

            message = body.get("message", "")
            max_tokens = int(body.get("max_tokens", 180))
            if not isinstance(message, str) or not message.strip():
                _json_response(self, 400, {"error": "Champ 'message' requis"})
                return

            assistant_text = call_llm(message.strip(), max_tokens=max_tokens)
            audio_url = call_tts(assistant_text)

            _json_response(
                self,
                200,
                {
                    "status": "ok",
                    "user": message,
                    "assistant": assistant_text,
                    "audio_url": audio_url,
                },
            )
        except error.HTTPError as exc:
            _json_response(self, 502, {"error": f"HTTP upstream error: {exc}"})
        except Exception as exc:
            _json_response(self, 500, {"error": str(exc)})


def run() -> None:
    server = HTTPServer((HOST, PORT), BridgeHandler)
    print(f"[BRIDGE] Running on http://{HOST}:{PORT}")
    print(f"[BRIDGE] LLM: {LLM_URL}")
    print(f"[BRIDGE] TTS: {TTS_URL}")
    server.serve_forever()


if __name__ == "__main__":
    run()
