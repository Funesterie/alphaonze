# Vivy Social Autoprompt

Social Autoprompt donne à Vivy un contexte créatif récent sans mélanger comptes, secrets, prompt technique et paroles.

La première version active YouTube en priorité. Facebook / Instagram sont préparés côté configuration, mais restent en attente de validation Meta. La publication automatique viendra plus tard.

## Principe

```text
Compte connecté en admin
→ token chiffré côté serveur
→ worker interne de lecture
→ fiches social_prompt_context
→ Vivy enrichit !chanson avant l'écriture
```

Le contexte social ne doit jamais être chanté tel quel. Il sert de direction :

- ton récent
- phrases fortes à transformer
- angles chanson
- angles clip
- hashtags possibles
- pièges créatifs

## Page Admin

```text
/admin/social-connect
```

Fonctions :

- connecter YouTube
- voir le compte connecté, les scopes, l'expiration et l'état `reconnect_required`
- tester le refresh
- lancer un ingest manuel
- mettre l'ingest en pause
- purger le contexte social local
- générer une fiche de test pour un sujet Vivy

## Variables

```env
SOCIAL_TOKEN_ENC_KEY=
SOCIAL_PUBLIC_BASE_URL=https://funesterie.me
SOCIAL_CONTEXT_USER_ID=admin

SOCIAL_YOUTUBE_CLIENT_ID=
SOCIAL_YOUTUBE_CLIENT_SECRET=
SOCIAL_YOUTUBE_REDIRECT_URI=https://funesterie.me/api/admin/social-connect/youtube/callback
SOCIAL_YOUTUBE_INGEST_LIMIT=12

SOCIAL_META_APP_ID=
SOCIAL_META_APP_SECRET=
SOCIAL_META_REDIRECT_URI=https://funesterie.me/api/admin/social-connect/meta/callback

SOCIAL_INGEST_WORKER_ENABLED=0
SOCIAL_INGEST_INTERVAL_MS=900000

VIVY_STREAM_SOCIAL_CONTEXT_DISABLED=0
VIVY_STREAM_SOCIAL_CONTEXT_USER_ID=admin
A11_SOCIAL_MCP_ALLOW_ANONYMOUS=0
```

`SOCIAL_TOKEN_ENC_KEY` doit rester stable. Si elle change, les tokens déjà stockés deviennent illisibles.

## Worker

Ingest manuel :

```powershell
npm run worker:social:ingest
```

Boucle interne :

```powershell
npm run worker:social:ingest:loop
```

Le worker ne publie rien. Il lit les données autorisées, écrit les éléments récents, puis reconstruit une fiche créative.

## MCP

Outil borné :

```text
a11_social_prompt_context
```

Entrée :

```json
{
  "topic": "La fille qui parlait aux machines",
  "kind": "chanson",
  "limit": 6
}
```

Sortie redacted :

```json
{
  "topic": "...",
  "dominantTone": "...",
  "strongPhrases": [],
  "creativeAngles": [],
  "clipIdeas": [],
  "songPromptSeeds": [],
  "hashtags": [],
  "avoid": []
}
```

Par défaut, l'outil ne livre pas de contexte social en mode MCP anonyme.

## Intégration Vivy

Quand Vivy génère des paroles depuis Twitch, elle peut injecter un bloc interne :

```text
[Contexte social créatif Funesterie - privé, non chantable]
...
```

Règle : ce bloc sert uniquement de boussole. Il ne doit jamais apparaître dans les paroles, ni sous forme de hashtag, de statistique ou de liste technique.

## Limites V1

- YouTube lecture seule en priorité.
- Meta/Facebook/Instagram préparé, pas encore actif.
- SoundCloud, YouTube Music et Amazon Music nécessitent une analyse séparée des APIs et droits disponibles.
- Pas de publication automatique.
- Pas d'appel LLM payant dans l'ingest : la fiche est construite par heuristiques locales pour éviter les coûts cachés.
