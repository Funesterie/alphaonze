# Vivy / Funesterie YouTube channel profile

Created: 2026-07-08

Channel:

- Title: `Djeff`
- Channel ID: `UC5UjXwxv1sm12po0Vi0WJyQ`
- Handle shown by operator: `@vivyfunesterie`

OAuth:

- Upload token: `secrets/google/vivy/token_vivy_media.json`
- Channel-management token: `secrets/google/vivy/token_vivy_channel.json`
- Do not print token values.

## Proposed public description

```txt
Djeff / Vivy — Funesterie.

Musique, IA, NOSSEN, rap français sombre, lore vivant et laboratoire créatif.

Vivy est la présence musicale de Funesterie : voix, images, chansons, clips, mémoire et chaos rangé en lumière.
Djeff pilote l’univers, transforme les bugs en matière, et forge des morceaux entre cypher, warehouse, récit intime et science-fiction artisanale.

Ici : morceaux, clips, tests, archives, démos et vitrines.

SoundCloud : https://soundcloud.com/cellauro-jeffrey
Site : https://vivy.funesterie.me/
```

## Proposed keywords

```txt
Funesterie Vivy Djeff NOSSEN "rap français" "IA musicale" cypher "dark rap" gabber "clip IA" "musique expérimentale"
```

## Commands

Dry-run:

```powershell
cd D:\projets\funesterie
.\.venv-vivy-media\Scripts\python.exe scripts\vivy-youtube-channel-manage.py --auth
```

Apply after operator confirmation:

```powershell
cd D:\projets\funesterie
.\.venv-vivy-media\Scripts\python.exe scripts\vivy-youtube-channel-manage.py --apply
```

Public uploads still use `scripts/vivy-youtube-upload.py`; keep video uploads
`unlisted` first unless the operator explicitly asks for public.
