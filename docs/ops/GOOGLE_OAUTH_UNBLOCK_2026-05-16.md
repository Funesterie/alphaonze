# Google OAuth Unblock - 2026-05-16

## Diagnostic court

Les endpoints applicatifs en production sont sains et demandent uniquement les scopes de login basiques :

```txt
https://a11.funesterie.me/api/auth/google/start
redirect_uri=https://a11.funesterie.me/api/auth/google/callback
scope=openid email profile

https://k44.funesterie.me/api/auth/google/start
redirect_uri=https://k44.funesterie.me/api/auth/google/callback
scope=openid email profile
```

Le fichier `client_secret_2_405298558591-...json` sur le bureau est un client **Cloudflare Access** :

```txt
origins:
- https://funesterie.cloudflareaccess.com
- https://alphaonze.cloudflareaccess.com

redirects:
- https://funesterie.cloudflareaccess.com/cdn-cgi/access/callback
- https://alphaonze.cloudflareaccess.com/cdn-cgi/access/callback
```

Ce client ne doit pas servir pour le login A11/K44. Il sert a Cloudflare Access.

## Decision

Garder deux familles OAuth separees :

- `alphaonze` / A11 / K44 login : `openid`, `email`, `profile` seulement.
- Vivy media : client separe pour `drive.file` et `youtube.upload`.

## Pour debloquer vite

Si l'usage est seulement Jeffrey/famille/agents internes, rester en mode **Test** dans Google Auth Platform et ajouter les comptes dans **Utilisateurs tests**.

Publier en production declenche la validation Google. Avec `drive.file` ou `youtube.upload`, Google demandera :

- justification de chaque scope sensible ;
- video de demonstration ;
- liens public homepage, privacy policy, terms ;
- domaines verifies ;
- coherence entre scopes declares et scopes reellement demandes par le code.

## Champs a mettre si validation obligatoire

### Justification `openid`, `email`, `profile`

```txt
Funesterie utilise Google OAuth pour identifier l'utilisateur, ouvrir une session securisee et afficher son profil de base dans A11/Kaen44. L'application ne lit pas les emails, fichiers Drive ou donnees Google Workspace avec ce client de connexion. Les donnees recues sont limitees a l'identite de base necessaire a la session.
```

### Justification `drive.file` pour Vivy media uniquement

```txt
Le scope drive.file est utilise uniquement par le module Vivy media pour permettre a l'utilisateur de selectionner, creer ou modifier les fichiers Drive explicitement utilises avec Funesterie. L'application ne demande pas l'acces complet au Drive et ne parcourt pas les fichiers non choisis par l'utilisateur.
```

### Justification `youtube.upload` pour Vivy media uniquement

```txt
Le scope youtube.upload est utilise uniquement pour publier, a la demande explicite de l'utilisateur, les contenus audio/video generes ou prepares par Vivy sur la chaine YouTube choisie. Funesterie n'utilise pas ce scope pour lire l'historique YouTube, gerer la chaine au-dela de l'upload demande, ni publier sans validation utilisateur.
```

### Infos supplementaires

```txt
Funesterie separe les clients OAuth par usage. Le client A11/Kaen44 sert uniquement au login web avec openid email profile. Les scopes media sensibles drive.file et youtube.upload sont reserves a un client Vivy distinct, utilise seulement quand l'utilisateur demande une operation media. Les secrets ne sont pas exposes dans l'interface, les tokens sont stockes cote serveur/local securise, et les logs redactent les jetons et secrets.

Comptes de test disponibles sur demande. Les routes OAuth publiques sont :
- https://a11.funesterie.me/api/auth/google/start
- https://k44.funesterie.me/api/auth/google/start

La demonstration video montrera :
1. connexion Google a A11/K44 ;
2. affichage de la session ;
3. declenchement explicite d'une action Vivy media ;
4. usage borne de Drive/YouTube ;
5. absence d'exposition de secrets.
```

## Video demo a produire

Montrer en moins de 3 minutes :

1. page d'accueil A11/K44 ;
2. clic "Connexion Google" ;
3. ecran consentement Google avec scopes visibles ;
4. retour dans l'application connectee ;
5. pour Vivy seulement : choix d'un fichier ou preparation d'un upload ;
6. confirmation utilisateur avant publication ;
7. resultat public ou statut d'upload ;
8. rappeler que les tokens ne sont jamais affiches.

## A ne pas faire

- Ne pas utiliser le client Cloudflare Access pour le login A11/K44.
- Ne pas mettre `drive.file` ou `youtube.upload` dans le consent screen principal si A11/K44 ne les demandent pas.
- Ne pas publier si les liens privacy/terms/homepage ne sont pas stables.
- Ne pas coller de secret client dans un thread agent ou une discussion.

