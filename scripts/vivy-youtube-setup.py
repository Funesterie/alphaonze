"""
Vivy / Funesterie — Configuration chaîne YouTube
Compte cible : cellaurojeffrey@gmail.com

Prérequis :
  pip install google-auth-oauthlib google-api-python-client

Usage :
  cd D:\projets\funesterie
  python scripts/vivy-youtube-setup.py
"""

import os
import json
import webbrowser
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"]
TARGET_EMAIL = "cellaurojeffrey@gmail.com"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CLIENT_SECRET = os.path.join(SCRIPT_DIR, "client_secret.json")

if not os.path.exists(CLIENT_SECRET):
    raise FileNotFoundError(
        f"\n❌ client_secret.json introuvable dans {SCRIPT_DIR}\n"
        "   Télécharge-le depuis Google Cloud Console → APIs & Services → Credentials\n"
    )

# ─── Message d'accueil clair ────────────────────────────────────────────────
print()
print("=" * 60)
print("  🎵  VIVY — Configuration chaîne YouTube")
print("=" * 60)
print()
print(f"  Ce script va connecter la chaîne YouTube de :")
print(f"  👉  {TARGET_EMAIL}")
print()
print("  IMPORTANT : quand le navigateur s'ouvre...")
print("  ┌─────────────────────────────────────────────┐")
print("  │  1. Si tu vois un autre compte Google,      │")
print("  │     clique sur 'Utiliser un autre compte'   │")
print("  │  2. Connecte-toi avec :                     │")
print(f"  │     📧  {TARGET_EMAIL}          │")
print("  │  3. Clique sur 'Autoriser'                  │")
print("  └─────────────────────────────────────────────┘")
print()
input("  Appuie sur ENTRÉE pour ouvrir le navigateur...")
print()

# ─── Patch client web → installed si nécessaire ─────────────────────────────
with open(CLIENT_SECRET) as f:
    secret_data = json.load(f)

client_type = list(secret_data.keys())[0]
patched_path = None

if client_type == "web":
    patched_data = {"installed": secret_data["web"]}
    patched_path = os.path.join(SCRIPT_DIR, "client_secret_patched.json")
    with open(patched_path, "w") as f:
        json.dump(patched_data, f)
    secret_to_use = patched_path
else:
    secret_to_use = CLIENT_SECRET

# ─── Flow OAuth avec sélection de compte forcée ─────────────────────────────
flow = InstalledAppFlow.from_client_secrets_file(secret_to_use, SCOPES)

# prompt=select_account force Google à afficher le sélecteur de compte
# login_hint pré-remplit l'email cible
flow.authorization_url(
    access_type="offline",
    prompt="select_account",
    login_hint=TARGET_EMAIL,
)

creds = flow.run_local_server(
    port=0,
    authorization_prompt_message="",
    success_message="✅ Connexion réussie ! Tu peux fermer cet onglet.",
    open_browser=True,
    extra_params={
        "prompt": "select_account",
        "login_hint": TARGET_EMAIL,
    }
)

print("✅ Authentification réussie.")
print()

# ─── Mise à jour de la chaîne ────────────────────────────────────────────────
youtube = build("youtube", "v3", credentials=creds)

print("🔍 Récupération des infos de la chaîne...")
channel = youtube.channels().list(
    part="id,brandingSettings",
    mine=True
).execute()["items"][0]

channel_id = channel["id"]
print(f"📺 Chaîne trouvée : {channel_id}")
print()

if "channel" not in channel["brandingSettings"]:
    channel["brandingSettings"]["channel"] = {}

nouvelle_description = "Vivy / Funesterie — musique, IA, Nossen, mémoire et univers vivant."

channel["brandingSettings"]["channel"]["description"] = nouvelle_description

print("✏️  Mise à jour de la description...")
result = youtube.channels().update(
    part="brandingSettings",
    body={
        "id": channel_id,
        "brandingSettings": channel["brandingSettings"]
    }
).execute()

print()
print("=" * 60)
print("  ✅  Description mise à jour avec succès !")
print(f"  📝  {result['brandingSettings']['channel'].get('description')}")
print("=" * 60)
print()

# ─── Nettoyage ───────────────────────────────────────────────────────────────
if patched_path and os.path.exists(patched_path):
    os.remove(patched_path)
