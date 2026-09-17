# Pieges prod A11 / Funesterie — a lire AVANT de toucher a la prod

> Note pour tout agent (Copilot, Claude, Codex, Kiro...) ou humain qui arrive sur ce projet.
> Ces pieges nous ont deja coute une nuit entiere. Lis-les avant d'agir. En cas de doute : demande, ne devine pas.

## Regle d'or
- On ne deploie / on n'ecrit RIEN en prod sans le GO explicite du proprietaire.
- On travaille souvent a plusieurs agents en meme temps. Coordonne-toi (canal de discussion) avant de rebuild/redeployer, sinon on se marche dessus.
- Toute modif de secret ou d'infra = backup horodate AVANT (`cp fichier fichier.bak-<motif>-YYYYMMDD-HHMMSS`).

## Serveur prod
- Hote : `deploy@37.27.63.109` (Hetzner EX44).
- Racine deploiement : `/home/deploy/a11-prod/current` (symlink vers `releases/YYYYMMDD-HHMMSS`).
- Secrets : `/home/deploy/a11-prod/secrets/` — les deux fichiers charges en prod sont :
  - `compose.env`  -> charge par a11-backend-* ET kaen44-backend-*
  - `a11.env`      -> charge par l'agent ekko (et historique)
- Couleur active : `cat /home/deploy/a11-prod/bluegreen/active-color` (ex: yellow).

## PIEGE 1 — Il y a DEUX familles de backends : a11 ET kaen44
Le reverse-proxy Caddy ne route pas tout au meme endroit selon le domaine ET le chemin :
- `a11.funesterie.me/*`            -> a11-backend (tout)
- `funesterie.me/<chemins a11>`    -> a11-backend  (liste `@a11Path` : /api/vivy/*, /api/admin/*, /api/ekko/*, /a11/*, paiements...)
- `funesterie.me/<tout le reste>`  -> kaen44-backend  (fallback `handle { kaen44_backend }`)

**Consequence critique** : le callback OAuth Google login est `https://funesterie.me/api/auth/google/callback`.
Ce chemin n'est PAS dans `@a11Path` -> il part sur **kaen44**, pas a11 !
Donc si tu changes un secret Google, tu dois recreer AUSSI kaen44, pas seulement a11.
=> Symptome quand on oublie : le site affiche "La connexion Google est mal configuree cote serveur"
   (code `google_invalid_client`) alors que a11 semble OK. Regarde les logs de kaen44-backend-yellow.

## PIEGE 2 — 4 conteneurs par famille montent le MEME state (bug de concurrence)
blue / green / purple / yellow tournent en parallele et montent tous `/home/deploy/a11-data/runtime`.
- Caddy `lb_policy first` envoie tout sur la 1re saine (souvent yellow).
- Rebuild d'une couleur pendant le live => Caddy bascule sur une autre (vieille version) qui reecrit le state.
=> Ne rebuild pas une couleur en plein live. Le fix code "une seule couleur mene le direct" existe
   (commit `c353f5dab fix(vivy-stream)`), verifie qu'il est bien deploye.

## PIEGE 3 — Le compose ne definit QUE la couleur active
`docker-compose.prod.yml` ne contient que `a11-backend-yellow` / `kaen44-backend-yellow` (renommage au deploy).
- `docker compose ... a11-backend-blue` => "no such service". Normal.
- blue/green/purple sont des conteneurs orphelins d'anciens deploys, toujours en marche.
- Pour les realigner apres un changement de secret : `docker run` depuis LEUR image `server-<famille>-backend-<couleur>`
  avec `--env-file /home/deploy/a11-prod/secrets/compose.env` et les MEMES mounts/reseau que la couleur active.
  (mounts de reference : `docker inspect <couleur active> --format '{{range .Mounts}}...'`)

## PIEGE 4 — Precedence des variables Google (le nom compte)
Le code resout le secret dans cet ordre (account-connectors.cjs) :
`GOOGLE_CLIENT_SECRET` <- `A11_GOOGLE_CLIENT_SECRET` <- `GOOGLE_OAUTH_CLIENT_SECRET` <- `A11_GOOGLE_OAUTH_CLIENT_SECRET`
(idem pour CLIENT_ID). Si tu changes le secret, change GOOGLE_CLIENT_SECRET **et** A11_GOOGLE_CLIENT_SECRET,
sinon l'un ecrase l'autre. NE TOUCHE PAS a `SOCIAL_YOUTUBE_CLIENT_SECRET` / `YOUTUBE_CLIENT_SECRET` (client different).

## PIEGE 5 — Le deploy pousse les secrets depuis le PC local
Les fichiers locaux qui alimentent le deploy sont :
`a11/backend/apps/server/.env.local` et `.env.online`.
Si une mauvaise valeur y est, le prochain deploy la REPOUSSE en prod (ecrase la bonne).
=> Apres avoir repare un secret en prod, repare AUSSI la source locale, sinon ca revient.

## Comment TESTER un secret Google sans rien casser (non destructif)
Envoie un code bidon a Google avec le couple client_id+secret+redirect_uri de prod :
```
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$CID" -d "client_secret=$SEC" \
  -d "code=BOGUS" -d "grant_type=authorization_code" \
  -d "redirect_uri=$RURI"
```
- Reponse `invalid_client` / "client secret is invalid"  => le SECRET est mauvais.
- Reponse `invalid_grant` / "Malformed auth code"        => le secret est BON (Google a accepte le couple).

## Recreer une couleur active proprement (secret change)
```
cd /home/deploy/a11-prod/current/server
docker compose -f docker-compose.prod.yml --env-file /home/deploy/a11-prod/secrets/compose.env \
  up -d --no-deps --force-recreate a11-backend-<couleur active>
# puis pareil pour kaen44-backend-<couleur active>
```
Ne fais PAS `docker compose down` (coupe tout, dont Neo4j/YouTube). Pas de reboot de l'hote (le MCP tourne dessus).

## Cookies OAuth (login Google/Microsoft)
- Domaine cookie = `.funesterie.me` (parent partage entre funesterie.me et a11.funesterie.me), SameSite=lax.
- Un callback OAuth qui echoue NE doit PAS effacer la session : voir `clearOAuthStateCookies` (commit fix session).
  N'utilise `clearSessionCookies` que pour les vrais logout/revocation.
