#!/usr/bin/env python3
"""
Create or refresh the local Vivy media OAuth token.

This uses the Vivy Google Cloud project and the desktop OAuth client stored
outside the repository under secrets/google/vivy.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow


ROOT = Path(__file__).resolve().parents[1]
SECRET_DIR = ROOT / "secrets" / "google" / "vivy"
DEFAULT_CLIENT_SECRET = SECRET_DIR / "client_secret_vivy_media_desktop.json"
DEFAULT_TOKEN = SECRET_DIR / "token_vivy_media.json"
TARGET_EMAIL = "cellaurojeffrey@gmail.com"
SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/youtube",
]


def load_client_secret(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Client secret not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if "installed" not in data:
        raise ValueError("Expected a Desktop OAuth client JSON with an 'installed' root key.")
    installed = data["installed"]
    if installed.get("project_id") != "alphaonze":
        raise ValueError(f"Expected project_id alphaonze, got {installed.get('project_id')!r}.")
    return installed


def print_status(client_secret: Path, token_path: Path) -> None:
    installed = load_client_secret(client_secret)
    client_id = str(installed.get("client_id", ""))
    masked_client_id = client_id[:18] + "..." if len(client_id) > 18 else client_id
    print("Vivy media OAuth config")
    print(f"  client_secret: {client_secret}")
    print(f"  token_path:    {token_path}")
    print(f"  project_id:    {installed.get('project_id')}")
    print(f"  client_id:     {masked_client_id}")
    print(f"  token_exists:  {token_path.exists()}")
    print("  scopes:")
    for scope in SCOPES:
        print(f"    - {scope}")


def run_auth(client_secret: Path, token_path: Path, no_browser: bool) -> None:
    load_client_secret(client_secret)
    token_path.parent.mkdir(parents=True, exist_ok=True)

    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret), SCOPES)
    creds = flow.run_local_server(
        port=0,
        open_browser=not no_browser,
        authorization_prompt_message="",
        success_message="Vivy media OAuth connected. You can close this tab.",
        extra_params={
            "prompt": "consent select_account",
            "login_hint": TARGET_EMAIL,
        },
    )

    token_path.write_text(creds.to_json(), encoding="utf-8")
    print(f"Saved Vivy media token to: {token_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Authorize Vivy media OAuth locally.")
    parser.add_argument("--client-secret", type=Path, default=DEFAULT_CLIENT_SECRET)
    parser.add_argument("--token", type=Path, default=DEFAULT_TOKEN)
    parser.add_argument("--check", action="store_true", help="Validate config without opening OAuth.")
    parser.add_argument("--no-browser", action="store_true", help="Print auth URL instead of opening a browser.")
    args = parser.parse_args()

    if args.check:
        print_status(args.client_secret, args.token)
        return 0

    run_auth(args.client_secret, args.token, args.no_browser)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
