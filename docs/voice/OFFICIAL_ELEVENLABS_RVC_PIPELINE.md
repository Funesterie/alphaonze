# Voix officielle — ElevenLabs + RVC (persona)

> But: une voix officielle **propre et intelligible** par persona (A11 / K44 / Vivy /
> Djeff), construite à partir des **références fournies**, sans le charabia
> phonétique de XTTS ("aopueuàueeeoih") ni l'écrasement ffmpeg ("ratatiné").

## Le principe

```
texte
  → ElevenLabs TTS (voix clonée du persona, parole FR nette)   ← produit les MOTS
  → pont XTTS/RVC : conversion audio→audio via le modèle .pth du persona  ← re-timbre
  → voix officielle
```

ElevenLabs génère une parole claire (jamais XTTS, donc jamais d'hallucination de
phonèmes). Le pont applique ensuite **RVC sur ce clip déjà parlé** pour coller le
timbre du persona. Quand aucun modèle RVC `.pth` n'existe encore pour le persona,
le clip ElevenLabs propre est **renvoyé tel quel** (passthrough) au lieu d'être
remplacé par une re-synthèse XTTS bancale.

## La cause racine corrigée

Avant, `POST /api/voice/convert` (pont `funesterie_xtts_rvc_api.py`) faisait
`del generated` : il **jetait** l'audio propre reçu et **re-synthétisait depuis le
texte via XTTS**. Un rendu ElevenLabs parfait était donc remplacé par du XTTS
froid → "aopueuàueeeoih". Désormais le pont **convertit le clip fourni** :

- clip présent + modèle `.pth` du persona → vraie conversion RVC audio→audio ;
- clip présent, pas de `.pth` → passthrough propre (loudnorm léger) ;
- pas de clip (ou `pipeline=synthesize` / `resynthesize=true`) → ancien chemin XTTS depuis texte.

La route identitaire pure (`/api/voice/synthesize`, XTTS+RVC depuis texte) n'est
pas touchée.

## Côté requête (backend `routes/tts.cjs`)

Mode explicite, réservé aux comptes payants/fondateur/admin :

```jsonc
POST /tts/speak
{
  "text": "Bonjour Jeffrey, ceci est la voix officielle.",
  "persona": "vivy",            // a11 | kaen44 (k44) | vivy | djeff
  "voiceMode": "elevenlabs-rvc" // alias: eleven-rvc, elevenlabs+rvc, ...
}
```

`normalizeElevenLabsRvcRequest` force alors `provider=elevenlabs`,
`voiceConversion=true`, `useRvc=true`, `voiceConversionSourceEngine=elevenlabs`,
`voiceConversionPipeline=convert`. Le backend rend via ElevenLabs puis poste le
clip au pont avec `sourceEngine=elevenlabs` + `pipeline=convert`.

## À finir côté serveur (Hetzner) — non packagé

Le code est complet, mais ces assets/réglages vivent dans les volumes prod :

1. **Clé ElevenLabs** présente : `/app/runtime/secrets/elevenlabs_api_key`
   (ou `A11_ELEVENLABS_API_KEY`).
2. **Voix ElevenLabs clonées depuis les refs** (une voix distincte par persona) :
   ```bash
   node a11/backend/apps/server/scripts/elevenlabs-create-official-voices.cjs --apply --write-profile-env
   ```
   → renseigne `A11_ELEVENLABS_{A11,KAEN44,K44,VIVY,DJEFF}_VOICE_ID`.
3. **Modèles RVC `.pth`/`.index` par persona** dans
   `/srv/a11-data/a11/xtts-rvc/rvcs/` :
   - Vivy : `vivy.pth` + `vivy.index` (déjà prévus au manifest).
   - Djeff : `djeff-rap.pth` + `djeff-rap.index`.
   - A11 / K44 : pas de `.pth` par défaut → passthrough ElevenLabs propre tant
     qu'un modèle n'est pas entraîné. Pour un vrai RVC, entraîner depuis la ref :
     `a11/ops/voice/rvc_train_from_request.py`.
4. **Vérifier** le pont :
   ```bash
   curl -s http://a11-xtts-rvc:5000/health | jq '.styles | {vivy, "kaen44-official-french-narrator", "a11-official-stern-french"} '
   # hasVoice / hasRvc / hasIndex par style
   ```
5. **Déploiement** : Hetzner blue/green via `a11/ops/deploy-a11-prod-finland-2.ps1`
   (les env XTTS/RVC + ElevenLabs y sont déjà injectés sur les deux backends).

## Vérification rapide en prod

```bash
# Vivy : doit sortir engine=elevenlabs-rvc (clip ElevenLabs re-timbré par vivy.pth)
curl -s -X POST https://vivy.funesterie.me/api/tts/speak \
  -H 'content-type: application/json' \
  -d '{"text":"Bonjour, test voix officielle.","persona":"vivy","voiceMode":"elevenlabs-rvc"}' \
  -i | grep -i 'x-a11-voice\|provider'
```

- `engine=elevenlabs-rvc` → ElevenLabs + RVC réel (persona avec `.pth`).
- `engine=elevenlabs-clean` → ElevenLabs propre en passthrough (persona sans `.pth` encore).
- Plus jamais de re-synthèse XTTS froide sur un clip déjà parlé.
