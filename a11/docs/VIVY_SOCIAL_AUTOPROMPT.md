# Vivy Social Autoprompt

Social Autoprompt donne à Vivy un contexte créatif récent sans mélanger comptes, secrets, prompt technique et paroles.

La première version active YouTube en priorité. Facebook / Instagram sont préparés côté configuration, mais restent en attente de validation Meta. Dans Social Connect, l'envoi YouTube est manuel, privé par défaut et exige une confirmation explicite ; cette interface n'initie aucune publication de sa propre initiative.

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
- envoyer une vidéo générée vers YouTube après confirmation explicite

## Variables

```env
SOCIAL_TOKEN_ENC_KEY=
SOCIAL_PUBLIC_BASE_URL=https://funesterie.me
SOCIAL_CONTEXT_USER_ID=admin

SOCIAL_YOUTUBE_CLIENT_ID=
SOCIAL_YOUTUBE_CLIENT_SECRET=
SOCIAL_YOUTUBE_REDIRECT_URI=https://funesterie.me/api/admin/social-connect/youtube/callback
SOCIAL_YOUTUBE_SCOPES=https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload
SOCIAL_YOUTUBE_INGEST_LIMIT=12
SOCIAL_YOUTUBE_SOURCE_FETCH_TIMEOUT_MS=600000
SOCIAL_YOUTUBE_SOURCE_MAX_BYTES=2147483648
SOCIAL_YOUTUBE_UPLOAD_MAX_ATTEMPTS_24H=20

SOCIAL_META_APP_ID=
SOCIAL_META_APP_SECRET=
SOCIAL_META_REDIRECT_URI=https://funesterie.me/api/admin/social-connect/meta/callback

SOCIAL_INGEST_WORKER_ENABLED=0
SOCIAL_INGEST_INTERVAL_MS=1800000

VIVY_STREAM_SOCIAL_CONTEXT_DISABLED=0
VIVY_STREAM_SOCIAL_CONTEXT_USER_ID=admin
A11_SOCIAL_MCP_ALLOW_ANONYMOUS=0
```

`SOCIAL_TOKEN_ENC_KEY` doit rester stable. Si elle change, les tokens déjà stockés deviennent illisibles.

Le flux social YouTube exige un client OAuth dédié `SOCIAL_YOUTUBE_*` (ou les
alias `YOUTUBE_*`). Il ne réutilise pas le client `GOOGLE_CLIENT_ID` servant à
la connexion générale au site. L'ingest identifie la chaîne connectée, lit son
flux Atom public puis demande uniquement les métadonnées publiques minimales
avec `videos.list`; il n'appelle ni `search.list`, ni commentaires, ni playlist
d'uploads.

L'URL d'autorisation fixe `include_granted_scopes=false` : le consentement
Social Connect n'agrège donc pas les droits précédemment accordés à Google.
Pour nettoyer un ancien consentement plus large, déconnecter YouTube dans
Funesterie, révoquer l'accès Funesterie dans
`https://myaccount.google.com/permissions`, puis reconnecter la chaîne. Le
nouveau jeton est alors demandé avec les deux seuls scopes YouTube ci-dessus.

Au premier démarrage de cette version, une migration SQL atomique et versionnée
purge une seule fois, pour tous les utilisateurs, les anciens items YouTube,
snapshots YouTube et contextes créatifs susceptibles de dériver de commentaires
ou de vidéos non publiques. Son marqueur empêche tout nouvel effacement lors
des appels suivants à `ensureSocialSchema`; les contextes reconstruits sont
préservés.

La publication manuelle `POST /api/admin/social-connect/youtube/upload-generated`
exige `confirm:true` et une `idempotencyKey` sûre. L'interface crée cette clé avec
`crypto.randomUUID()`, la conserve pendant toute tentative et ne l'efface qu'après
succès ou après un abandon explicite précédé d'une vérification de la chaîne. Les
états `pending`, `succeeded` et `failed` sont persistés dans
`social_publication_requests`; aucun replay ne relance `videos.insert`. Le plafond
global est de 20 ouvertures effectives de `videos.insert` par fenêtre glissante de
24 heures par défaut et se règle avec
`SOCIAL_YOUTUBE_UPLOAD_MAX_ATTEMPTS_24H`. Une réservation refusée avant l'envoi
(compte non connecté, transfert déjà occupé ou téléchargement source échoué) ne
consomme pas ce quota.

## Worker

Ingest manuel :

```powershell
npm run worker:social:ingest
```

Boucle interne :

```powershell
npm run worker:social:ingest:loop
```

Le worker d'ingest Social Connect ne publie rien. Il lit les données autorisées, écrit les éléments récents, puis reconstruit une fiche créative.

## Isolation de l'autocast historique

Le worker historique `vivy-youtube-autocast-worker.cjs` reste une fonctionnalité séparée de Social Connect. Il doit utiliser son propre fichier de jeton et un client OAuth distinct. Avant toute demande de jeton ou d'envoi, il refuse le jeton legacy lorsque son `client_id` est exactement égal à `SOCIAL_YOUTUBE_CLIENT_ID` ou à `YOUTUBE_CLIENT_ID`, sans journaliser la valeur. Le client OAuth et les confirmations de Social Connect ne peuvent donc pas être détournés par ce worker autonome.

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

- YouTube : lecture publique minimale pour le contexte, avec envoi manuel confirmé dans Social Connect.
- Meta/Facebook/Instagram préparé, pas encore actif.
- SoundCloud, YouTube Music et Amazon Music nécessitent une analyse séparée des APIs et droits disponibles.
- Pas de publication automatique via Social Connect ; l'autocast historique reste isolé par un client OAuth distinct.
- Pas d'appel LLM payant dans l'ingest : la fiche est construite par heuristiques locales pour éviter les coûts cachés.
