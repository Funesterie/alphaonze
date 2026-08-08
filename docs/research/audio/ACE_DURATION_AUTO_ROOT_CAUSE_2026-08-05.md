# ACE-Step — cause des durées exactes 5:00 puis 2:00

Date : 5 août 2026  
Statut : diagnostic production + correction du défaut fixe  
Portée : Vivy Studio → Hetzner/Caddy → tunnel navigateur → ComfyUI/ACE-Step local

## Résultat

Les durées exactes ne viennent ni du compte utilisateur, ni de Caddy, ni du
tunnel, ni de ScentGate/BLOOM.

Les trois générations retrouvées dans l'historique Comfy appartiennent au même
acteur (`accountHash 0195616cec89`) :

| prompt Comfy | durée encodeur | durée latent | fichier mesuré |
|---|---:|---:|---:|
| `87441972…` | 300 s | 300 s | 300,000 s |
| `9ab3ffe2…` | 120 s | 120 s | 120,000 s |
| `efc46fa9…` | 120 s | 120 s | 120,000 s |

L'explication la plus probable est un ancien onglet/bundle envoyant encore
`300`, puis un écran à jour n'envoyant plus de durée. En l'absence de valeur,
la pile réinjectait alors `120`. La première moitié est une inférence, faute de
conservation du corps HTTP ancien ; la présence des valeurs 300/120 dans les
graphes et la chaîne de défaut 120 sont, elles, vérifiées.

## Les quatre couches qui forçaient 120

1. `acestep-provider.cjs` avait `DEFAUTS.duration = 120` ;
2. `.env.example` déclarait `ACESTEP_DEFAULT_DURATION_SECONDS=120` ;
3. le script de déploiement écrivait la variable dans les environnements
   Compose et `build.env` ;
4. les nœuds ComfyUI locaux déclarent eux-mêmes 120 comme valeur d'entrée par
   défaut pour l'encodeur et le latent.

La release active `20260805-204927` contenait encore la variable à 120 dans
l'environnement effectif. Le changement de compte n'est donc pas causal.

Le `ttlSeconds=120` d'un signal ScentGate est une durée de vie de message. Il
n'a aucun lien avec la longueur du fichier audio.

## Sémantique ACE officielle

L'API native ACE-Step 1.5 définit `duration=-1.0` par défaut. Une valeur
`<= 0` ou `None` laisse le modèle choisir en fonction des paroles ; avec le LM
5 Hz actif, `cot_duration` peut être complété par le modèle.

Sources :

- <https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/INFERENCE.md>
- <https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md>

## Limite du raccord ComfyUI installé

La version locale ComfyUI 0.30.0 n'expose pas cette auto-durée native :

- `TextEncodeAceStepAudio1.5` reçoit un nombre, par défaut 120 ;
- `EmptyAceStep1.5LatentAudio` exige `seconds >= 1`, par défaut 120 ;
- le nombre de tokens est calculé à partir de la durée avant la diffusion.

Envoyer `-1` directement casserait donc le latent ; omettre le champ ferait
revenir le défaut interne 120. Une longueur technique positive doit exister
avant la génération avec ce graphe précis.

## Correction appliquée

- Vivy ne transmet une durée que lorsqu'elle est explicitement demandée.
- La configuration serveur n'a plus de durée globale par défaut (`null`).
- Le déploiement ne réinjecte plus `120` ; la clé reste dans la liste gérée
  uniquement pour purger les anciennes valeurs persistées.
- Tant que le moteur local reste ce graphe Comfy, un planificateur de
  compatibilité dimensionne le latent à partir des paroles, sections, tempo,
  signature rythmique, tags et graine.
- L'encodeur et le latent reçoivent exactement la même longueur calculée.
- La télémétrie nomme honnêtement ce mode
  `comfy-adaptive-fallback`, avec la base `comfy-lyrics-layout` ou
  `comfy-instrumental-layout`.

Ce planificateur n'est **pas** présenté comme l'auto-durée du LM ACE officiel.
Il supprime la minuterie globale 2:00/5:00 et adapte le canevas au contenu, mais
reste un raccord de compatibilité.

## Étape d'architecture suivante

Pour obtenir la sémantique ACE native stricte, il faudra choisir l'une de ces
voies :

1. exécuter le service officiel ACE-Step avec son LM 5 Hz, lui envoyer
   `duration=-1/None`, puis utiliser sa durée planifiée ;
2. créer un nœud Comfy de planification qui interroge ce LM avant la création
   du latent ;
3. migrer entièrement la génération locale du graphe Comfy vers l'API native.

Le simple remplacement de `120` par `-1` dans les nœuds actuels n'est pas une
correction valide.

## Contrôles de non-régression

- configuration sans variable : durée `null` ;
- durée positive demandée : respectée et bornée à la limite technique ;
- durée absente ou négative : mode adaptatif Comfy ;
- paroles plus longues : canevas plus long à paramètres égaux ;
- même contenu/graine : même plan ;
- encodeur et latent : durée strictement identique ;
- aucune occurrence de réinjection `ACESTEP_DEFAULT_DURATION_SECONDS=120` dans
  les writers de déploiement ;
- vérification après déploiement : variable absente du conteneur actif et
  graphe soumis non égal par défaut à 120/300.

## Validation production du 5 août 2026

- release active : `20260805-233027`, couleur `blue` ;
- Caddy : `reverse_proxy a11-backend-blue:3000` ;
- `/api/health`, Vivy Studio et `/api/build` : HTTP 200 ;
- `ACESTEP_DEFAULT_DURATION_SECONDS` : absente de l'environnement du conteneur
  actif ;
- résolution exécutée dans ce conteneur : configuration `null`, mode
  `comfy-adaptive-fallback`, exemple paroles/seed à `24,86 s` ;
- tunnel Hetzner → ComfyUI local : santé OK, environ 10,37 Go de VRAM libres au
  moment du contrôle ;
- `start-gatekeeper.cjs` : absent de l'archive, de la release et du conteneur ;
- aucune génération audio longue n'a été lancée pendant ce contrôle : la
  validation porte sur la configuration, le graphe construit, le tunnel et les
  contrats. Une écoute d'un prochain morceau réel reste la validation artistique.
