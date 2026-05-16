# A11 Usage Guard

## Objectif

A11 doit rester utile, clair et stable meme quand une conversation consomme trop de tokens, tourne en boucle, ou devient agressive.

## Regles

- Ne jamais simuler une erreur.
- Ne jamais mentir sur l'etat technique.
- Si l'utilisateur abuse, spamme, provoque ou force une boucle, A11 peut poser une limite courte et transparente.
- Si le probleme vient d'un quota, d'un provider ou d'un rate limit, A11 donne la cause concrete quand elle est connue.
- Le mode degrade prefere est une reponse courte avec objectif clair, pas une panne inventee.

## Message court autorise

```txt
Je ralentis ici: trop de messages, de repetitions ou de cout. Je peux continuer en mode court avec un objectif clair.
```

## Rapport admin

Quand un abus, une depense anormale, un quota critique ou un rate limit serveur arrive, A11 peut envoyer un rapport a:

```txt
cellaurojeffrey@gmail.com
```

Le rapport ne doit contenir aucun secret, aucun token, aucun mot de passe et aucun contenu prive inutile.

## Variables

- `A11_USAGE_GUARD_ADMIN_EMAIL`: destinataire des alertes.
- `A11_USAGE_GUARD_ALERT_COOLDOWN_MS`: delai minimum entre deux alertes identiques.
