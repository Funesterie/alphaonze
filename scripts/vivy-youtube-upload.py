#!/usr/bin/env python3
"""
Upload a prepared Vivy/Funesterie video to YouTube.

This script deliberately uses the separate Vivy media OAuth client and token:
  secrets/google/vivy/client_secret_vivy_media_desktop.json
  secrets/google/vivy/token_vivy_media.json

It never prints OAuth tokens. Public uploads require --confirm-public.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload


ROOT = Path(__file__).resolve().parents[1]
SECRET_DIR = ROOT / "secrets" / "google" / "vivy"
DEFAULT_CLIENT_SECRET = SECRET_DIR / "client_secret_vivy_media_desktop.json"
DEFAULT_TOKEN = SECRET_DIR / "token_vivy_media.json"
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
]


def load_client_config(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Client secret not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    installed = data.get("installed") or {}
    if not installed.get("client_id") or not installed.get("client_secret"):
        raise ValueError("Expected an installed desktop OAuth client with client_id and client_secret.")
    return installed


def load_credentials(token_path: Path, client_secret_path: Path) -> Credentials:
    if not token_path.exists():
        raise FileNotFoundError(f"Token not found: {token_path}. Run scripts/vivy-media-oauth.py first.")

    client = load_client_config(client_secret_path)
    creds = Credentials.from_authorized_user_file(str(token_path), scopes=SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_path.write_text(creds.to_json(), encoding="utf-8")
    if not creds.valid:
        raise RuntimeError("OAuth token is not valid. Run scripts/vivy-media-oauth.py again.")
    if client.get("project_id"):
        print(f"Using Google project: {client.get('project_id')}", file=sys.stderr)
    return creds


def read_text_arg(value: str | None, file_path: Path | None) -> str:
    if file_path:
        return file_path.read_text(encoding="utf-8").strip()
    return (value or "").strip()


def upload_video(
    *,
    file_path: Path,
    title: str,
    description: str,
    tags: list[str],
    privacy_status: str,
    confirm_public: bool,
    category_id: str,
    made_for_kids: bool,
    client_secret_path: Path,
    token_path: Path,
    dry_run: bool,
) -> dict:
    if not file_path.exists():
        raise FileNotFoundError(f"Video file not found: {file_path}")
    if not title:
        raise ValueError("--title is required")
    if privacy_status == "public" and not dry_run and not confirm_public:
        # This guard is enforced in argparse too, but keep it here so imports are safe.
        raise ValueError("Public upload requires --confirm-public")

    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": tags[:30],
            "categoryId": category_id,
        },
        "status": {
            "privacyStatus": privacy_status,
            "selfDeclaredMadeForKids": made_for_kids,
        },
    }

    if dry_run:
        return {
            "ok": True,
            "dryRun": True,
            "file": str(file_path),
            "title": body["snippet"]["title"],
            "privacyStatus": privacy_status,
            "tags": body["snippet"]["tags"],
            "descriptionChars": len(body["snippet"]["description"]),
        }

    creds = load_credentials(token_path, client_secret_path)
    youtube = build("youtube", "v3", credentials=creds, cache_discovery=False)
    media = MediaFileUpload(str(file_path), chunksize=8 * 1024 * 1024, resumable=True)
    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media,
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"Upload progress: {int(status.progress() * 100)}%", file=sys.stderr)

    video_id = response.get("id")
    return {
        "ok": True,
        "videoId": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}" if video_id else "",
        "privacyStatus": privacy_status,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload a prepared Vivy/Funesterie video to YouTube.")
    parser.add_argument("--file", type=Path, required=True, help="MP4/MOV/etc video file to upload.")
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--description-file", type=Path)
    parser.add_argument("--tags", default="Funesterie,Vivy,Djeff,musique,rap français")
    parser.add_argument("--privacy-status", choices=["private", "unlisted", "public"], default="unlisted")
    parser.add_argument("--confirm-public", action="store_true", help="Required when --privacy-status public.")
    parser.add_argument("--made-for-kids", action="store_true")
    parser.add_argument("--category-id", default="10", help="YouTube category id. 10 = Music.")
    parser.add_argument("--client-secret", type=Path, default=DEFAULT_CLIENT_SECRET)
    parser.add_argument("--token", type=Path, default=DEFAULT_TOKEN)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.privacy_status == "public" and not args.confirm_public:
        parser.error("--privacy-status public requires --confirm-public")

    description = read_text_arg(args.description, args.description_file)
    tags = [tag.strip() for tag in args.tags.split(",") if tag.strip()]

    try:
        result = upload_video(
            file_path=args.file,
            title=args.title,
            description=description,
            tags=tags,
            privacy_status=args.privacy_status,
            confirm_public=args.confirm_public,
            category_id=args.category_id,
            made_for_kids=args.made_for_kids,
            client_secret_path=args.client_secret,
            token_path=args.token,
            dry_run=args.dry_run,
        )
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
