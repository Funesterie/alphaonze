#!/usr/bin/env python3
"""
Vivy/Funesterie YouTube channel manager.

Safe defaults:
- uses a separate OAuth token from upload-only publishing;
- dry-run unless --apply is passed;
- never prints OAuth token values.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


ROOT = Path(__file__).resolve().parents[1]
SECRET_DIR = ROOT / "secrets" / "google" / "vivy"
DEFAULT_CLIENT_SECRET = SECRET_DIR / "client_secret_vivy_media_desktop.json"
DEFAULT_TOKEN = SECRET_DIR / "token_vivy_channel.json"
TARGET_EMAIL = "cellaurojeffrey@gmail.com"
SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"]

DEFAULT_DESCRIPTION = """Djeff / Vivy — Funesterie.

Musique, IA, NOSSEN, rap français sombre, lore vivant et laboratoire créatif.

Vivy est la présence musicale de Funesterie : voix, images, chansons, clips, mémoire et chaos rangé en lumière.
Djeff pilote l’univers, transforme les bugs en matière, et forge des morceaux entre cypher, warehouse, récit intime et science-fiction artisanale.

Ici : morceaux, clips, tests, archives, démos et vitrines.

SoundCloud : https://soundcloud.com/cellauro-jeffrey
Site : https://vivy.funesterie.me/
"""

DEFAULT_KEYWORDS = [
    "Funesterie",
    "Vivy",
    "Djeff",
    "NOSSEN",
    "rap français",
    "IA musicale",
    "cypher",
    "dark rap",
    "gabber",
    "clip IA",
    "musique expérimentale",
]


def load_client_config(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Client secret not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    installed = data.get("installed") or data.get("web") or {}
    if not installed.get("client_id") or not installed.get("client_secret"):
        raise ValueError("Expected an OAuth client JSON with client_id and client_secret.")
    return installed


def save_token(path: Path, creds: Credentials) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(creds.to_json(), encoding="utf-8")


def authorize(client_secret_path: Path, token_path: Path, no_browser: bool) -> Credentials:
    load_client_config(client_secret_path)
    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret_path), SCOPES)
    creds = flow.run_local_server(
        port=0,
        open_browser=not no_browser,
        authorization_prompt_message="",
        success_message="Vivy YouTube channel manager connected. You can close this tab.",
        extra_params={
            "prompt": "consent select_account",
            "login_hint": TARGET_EMAIL,
        },
    )
    save_token(token_path, creds)
    return creds


def load_credentials(client_secret_path: Path, token_path: Path, auto_auth: bool, no_browser: bool) -> Credentials:
    load_client_config(client_secret_path)
    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), scopes=SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            save_token(token_path, creds)
    if creds and creds.valid:
        return creds
    if not auto_auth:
        raise RuntimeError(f"Channel token missing/invalid: {token_path}. Run with --auth first.")
    return authorize(client_secret_path, token_path, no_browser)


def read_text_arg(value: str | None, file_path: Path | None, default: str) -> str:
    if file_path:
        return file_path.read_text(encoding="utf-8").strip()
    text = (value or "").strip()
    return text or default.strip()


def parse_keywords(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


def keyword_string(keywords: list[str]) -> str:
    # YouTube brandingSettings.channel.keywords is a space-separated string.
    # Quote multi-word keywords so they survive round-trips better.
    rendered = []
    for kw in keywords:
        if " " in kw:
            rendered.append(f'"{kw}"')
        else:
            rendered.append(kw)
    return " ".join(rendered)


def get_channel(youtube):
    data = youtube.channels().list(part="id,snippet,brandingSettings", mine=True).execute()
    items = data.get("items") or []
    if not items:
        raise RuntimeError("No YouTube channel found for the authenticated account.")
    return items[0]


def manage_channel(args: argparse.Namespace) -> dict:
    creds = load_credentials(args.client_secret, args.token, auto_auth=args.auth, no_browser=args.no_browser)
    youtube = build("youtube", "v3", credentials=creds, cache_discovery=False)
    channel = get_channel(youtube)
    channel_id = channel["id"]
    current_branding = channel.get("brandingSettings") or {}
    current_channel_branding = dict(current_branding.get("channel") or {})

    description = read_text_arg(args.description, args.description_file, DEFAULT_DESCRIPTION)
    keywords = parse_keywords(args.keywords, DEFAULT_KEYWORDS)

    proposed_branding = dict(current_branding)
    proposed_channel_branding = dict(current_channel_branding)
    proposed_channel_branding["description"] = description[:1000]
    proposed_channel_branding["keywords"] = keyword_string(keywords)[:500]
    proposed_branding["channel"] = proposed_channel_branding

    result = {
        "ok": True,
        "dryRun": not args.apply,
        "channelId": channel_id,
        "channelTitle": channel.get("snippet", {}).get("title", ""),
        "current": {
            "description": current_channel_branding.get("description", ""),
            "keywords": current_channel_branding.get("keywords", ""),
        },
        "proposed": {
            "description": proposed_channel_branding["description"],
            "keywords": proposed_channel_branding["keywords"],
        },
    }

    if not args.apply:
        return result

    update = youtube.channels().update(
        part="brandingSettings",
        body={
            "id": channel_id,
            "brandingSettings": proposed_branding,
        },
    ).execute()
    result["updated"] = True
    result["updatedDescription"] = update.get("brandingSettings", {}).get("channel", {}).get("description", "")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage Vivy/Funesterie YouTube channel metadata.")
    parser.add_argument("--client-secret", type=Path, default=DEFAULT_CLIENT_SECRET)
    parser.add_argument("--token", type=Path, default=DEFAULT_TOKEN)
    parser.add_argument("--auth", action="store_true", help="Open OAuth if token is missing/invalid.")
    parser.add_argument("--no-browser", action="store_true", help="Print auth URL instead of opening the browser.")
    parser.add_argument("--description", default="")
    parser.add_argument("--description-file", type=Path)
    parser.add_argument("--keywords", default="")
    parser.add_argument("--apply", action="store_true", help="Actually update the channel. Default is dry-run.")
    args = parser.parse_args()

    try:
        result = manage_channel(args)
    except HttpError as error:
        try:
            payload = json.loads(error.content.decode("utf-8"))
            message = payload.get("error", {}).get("message") or str(error)
            reason = (payload.get("error", {}).get("errors") or [{}])[0].get("reason")
        except Exception:
            message = str(error)
            reason = ""
        print(json.dumps({"ok": False, "error": message, "reason": reason}, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
