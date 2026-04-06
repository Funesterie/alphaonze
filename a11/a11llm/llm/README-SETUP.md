# Configuration complète LLM + TTS + Backend 🚀

## 📍 Emplacements

```
D:\funesterie\a11\
├── a11llm\llm\        ← LLM local
│   ├── models\        ← Modèles GGUF
│   ├── server\        ← llama-server.exe
│   └── README-SETUP.md
├── launchers\         ← Lanceurs globaux A11
│   ├── start-all-a11.bat
│   └── start-prod-a11.bat
├── a11backendrailway\
│   ├── apps\server\   ← Backend Node / Railway
│   ├── apps\tts\      ← TTS Piper / Railway
│   ├── start-all-a11.bat  ← wrapper legacy
│   └── start-prod-a11.bat ← wrapper legacy
├── a11frontendnetlify\apps\web\  ← Frontend Netlify
└── a11qflushrailway\  ← Orchestrateur Qflush
```

## 🚀 Lancement rapide

### Option 1: Double-clic (RECOMMANDÉ)

```
D:\funesterie\a11\launchers\start-all-a11.bat
```

Cela lance dans l'ordre:
1. LLM server (port 8080)
2. Backend Node (port 3000)
3. Frontend Vite (port 5173)
4. TTS Piper

Le lancement est supervise de facon plus discrete:

- les processus sont demarres en arriere-plan quand c'est possible
- les logs sont centralises dans `D:\funesterie\a11\launchers\runtime\logs`
- les anciens scripts dans `a11backendrailway` ne servent plus que de wrappers legacy

### Option 2: Manuel (debug)

```powershell
# Terminal 1: LLM
cd D:\funesterie\a11\a11llm\llm\server
.\llama-server.exe -m ../models/Llama-3.2-3B-Instruct-Q4_K_M.gguf --port 8080

# Terminal 2: TTS
cd D:\funesterie\a11\a11backendrailway\apps\tts
python siwis.py

# Terminal 3: Backend
cd D:\funesterie\a11\a11backendrailway\apps\server
npm run dev

# Terminal 4: Frontend
cd D:\funesterie\a11\a11frontendnetlify\apps\web
npm run dev
```

## 🧪 Tests

### Vérifier que tout fonctionne

```powershell
# 1. Backend health check
curl http://127.0.0.1:3000/health

# 2. TTS health check
curl http://127.0.0.1:8080/health
```

## 🔧 Configuration (Variables d'environnement)

Tu peux override les ports/hôtes en PowerShell avant démarrage:

```powershell
$env:LOCAL_LLM_URL="https://<ton-ngrok>"
$env:TTS_URL="http://127.0.0.1:8080"
$env:QFLUSH_URL="https://qflush-production.up.railway.app"
npm run dev
```

## 📝 Logs du lanceur

Les logs du mode lanceur sont regroupes ici:

```powershell
D:\funesterie\a11\launchers\runtime\logs
```

Tu y trouveras notamment les sorties de:

- `backend.out.log` / `backend.err.log`
- `tts.out.log` / `tts.err.log`
- `cloudflared.out.log` / `cloudflared.err.log`
- `llama-server.out.log` / `llama-server.err.log`

## 📡 APIs

### GET /health
```
http://127.0.0.1:3000/health
→ { "ok": true, ... }
```

### POST /api/llm/chat
```
POST http://127.0.0.1:3000/api/llm/chat
Content-Type: application/json

{
  "message": "Bonjour comment vas-tu?"
}

→ réponse assistant JSON
```

## ✅ Critères de succès

- ✓ Tous les services démarrent sans erreur
- ✓ GET /health répond
- ✓ POST /api/llm/chat retourne une réponse
- ✓ GET /api/status reflète la config active

## ⚡ Quick Troubleshooting

| Symptôme | Solution |
|----------|----------|
| "Connection refused" port 3000 | Backend pas lancé |
| "Connection refused" port 8080 | LLM server pas lancé |
| "Connection refused" TTS | Service TTS pas lancé |
| Erreur "tensor data not within bounds" | Modèle GGUF corrompu (re-télécharger) |
| Audio non généré | Vérifier que Piper peut accéder aux .onnx |
| Python not found | Installer Python 3.10+ et ajouter à PATH |

---

**Prochaine étape:** lance `start-all-a11.bat` ou `start-prod-a11.bat` depuis `D:\funesterie\a11\launchers`.
