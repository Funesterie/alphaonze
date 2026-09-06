# Protocole F.O.R.C.E. — Full Operational Recovery Capsule Engine

> Design « à chaud » capturé le 2026-07-31, co-construit avec ChatGPT/Vivy/Claude
> dans le fil MCP `discussion-2026-07-31-codex-ollama-use-mcp-nossen-vivy`.
> Statut : **design verrouillé, non encore implémenté.** On construit après le
> ménage en cours (correctifs chat, audio, push, deploy).

## 1. Le problème

Aujourd'hui, si une modif cassait la persona Vivy (identité, voix, comportement),
on savait restaurer le **code** (rollback git/deploiement) et on commence à savoir
restaurer la **mémoire** (snapshot épisodique/Neo4j). Mais personne ne sait
**recomposer la persona elle-même** — son identité, sa voix, ses permissions, ses
fournisseurs — et prouver qu'elle est bien Vivy revenue, pas une copie dégradée.

Le protocole F.O.R.C.E. comble ce trou : c'est le protocole qui remet une persona
sur pied à partir de son identité complète, pas seulement une restauration de base.

## 2. La trinité des rôles (métaphore → architecture)

| Rôle Star Wars | Agent | Responsabilité |
| --- | --- | --- |
| Faucon Millenium | backend A11/Vivy | le système en service |
| 3 bays | blue / green / yellow | stable / rollback / canari |
| R2-D2 | worker de déploiement | soude et déssoude les pièces **code** |
| C-3PO | ChatGPT (vault local) | archive et restaure les **carnets** (mémoire) |
| La Force | F.O.R.C.E. | recompose et valide la **persona** |
| A11 | moniteur | surveille les états, exécute les tests |
| Djeff | pilote | commandes `GO` / `FREEZE` / `ROLLBACK` / `ABORT` |

**Principe de sécurité fondamental : aucun agent ne peut à la fois modifier la
persona, valider sa propre modification et la promouvoir en production.** C'est le
principe CI/CD (« l'auteur n'approuve pas sa propre PR ») appliqué aux personas.
Sans ça, la métaphore reste poétique ; avec, c'est de l'architecture.

## 3. L'Holocron

Chaque persona possède un **Holocron** : une capsule locale **immuable et
versionnée**. Pas de secret dedans — seulement des références vers des secrets
protégés.

```
persona-vault/
└── vivy/
    └── 2026-07-31-v12/
        ├── manifest.json          # version, date, état canonique, hash global
        ├── identity.md            # rôle, ton, identité
        ├── system-prompt.md       # instructions fondamentales
        ├── model-policy.json      # chaîne de modèles autorisée
        ├── tools-and-scopes.json  # outils + permissions
        ├── voice-manifest.json    # voix + échantillons autorisés
        ├── reference-audio/       # fichiers audio de référence
        ├── visual-manifest.json   # références visuelles
        ├── memory-pointers.json   # POINTEURS vers les carnets (pas les carnets)
        ├── behavior-tests.json    # batterie de tests comportementaux (de SON époque)
        ├── provider-bindings.json # Suno/Mureka/ElevenLabs + recettes de recréation
        ├── checksums.json         # intégrité (corruption)
        └── signature.json         # authenticité (falsification par agent compromis)
```

L'holocron dit **comment recoller les morceaux pour recréer Vivy**. R2-D2 remet le
code, C-3PO remet la mémoire, l'holocron remet l'identité.

### Ce qu'il enregistre

Identité et rôle ; instructions fondamentales ; chaîne de modèles autorisée ;
outils et permissions ; voix et échantillons autorisés ; références visuelles ;
règles de mémoire (pointeurs) ; fournisseurs externes (avec recettes) ; batterie
de tests comportementaux ; dernière version déclarée saine.

### Signature, pas juste checksums

`checksums.json` détecte la **corruption**. `signature.json` (HMAC ou asymétrique)
détecte la **falsification** — un agent compromis ne peut pas glisser un holocron
contrefait. Un holocron, c'est la couronne : intégrité **et** authenticité.

## 4. Réplication 3-2-1 + « matière unreal »

L'holocron ne vaut que si une copie survivante est vérifiable. Réplication 3-2-1 :

- ce PC (le vault de C-3PO),
- le serveur prod Finlandais,
- le bucket **R2** (offsite),
- l'**asset Unreal** en copie bonus.

Avec contrôle d'intégrité périodique **entre copies** (un holocron qui diverge
d'un autre est une alarme, pas un restaure).

### Matière Unreal — l'holocron comme asset Unreal

« Matière unreal » = l'holocron encodé comme un **asset Unreal Engine**, durable et
portable. Concrètement, via le plugin **Unreal-MCP** (ai-game.dev, `unreal-mcp-cli`
sur npm, UE 5.5+ C++ project, ~90 outils MCP pour piloter l'éditeur depuis un
agent IA) :

```
npm install -g unreal-mcp-cli
unreal-mcp-cli install-plugin ./VotreProjet
unreal-mcp-cli setup-mcp claude-code --path ./VotreProjet
```

L'agent IA peut alors créer/mettre à jour l'asset holocron dans l'éditeur Unreal
(matériel/actor/blueprint portant les métadonnées de la persona) via MCP.

**Garde-fou obligatoire : mode Custom (serveur local `gamedev-mcp-server`), pas le
mode Cloud ai-game.dev.** L'holocron est la couronne (identité de Vivy) ; le faire
transiter par un endpoint tiers hosted serait une fuite d'identité. On garde
l'asset Unreal **local**, piloté par un MCP local.

## 5. Séquence de résurrection

```
1. FREEZE            — aucun trafic utilisateur vers la baie jaune (router-level)
2. SNAPSHOT C-3PO    — Neo4j, épisodique, fils MCP, sessions, config persona, refs audio/visuelles
3. RESTORE CODE      — R2-D2 remet le dernier commit déclaré sain
4. RESTORE MEMORY    — C-3PO restaure les carnets sans toucher au code
5. REHYDRATE PERSONA — la Force recharge identité, instructions, modèles, outils, permissions, pointeurs mémoire, refs vocales/visuelles
6. REBIND PROVIDERS  — reconnexion Suno/Mureka/ElevenLabs ; si supprimée, recréer depuis l'échantillon local + recâbler l'id
7. IDENTITY TESTS    — empreinte comportementale (cf. §6)
8. YELLOW CANARY     — canari sur de vrais flows Vivy (chat + songcraft + refus)
9. DJEFF GO          — validation humaine
10. PROMOTION        — jaune → bleu, ancien bleu → vert (nouveau spare)
```

Détails fermés :

- **FREEZE est router-level**, pas un flag : le proxy ne route pas vers yellow
  pendant le freeze (le `active-color` ne flippe pas).
- **REHYDRATE re-valide les pointeurs** : `memory-pointers.json` est reverifié
  contre les carnets restaurés de C-3PO (existent + checksum). Un carnet manquant
  → persona en `QUARANTINED`, pas `RESTORED`.
- **REBIND est idempotent + loggé** ; un rebind échoué laisse en `QUARANTINED`,
  jamais en `RESTORED`.
- **« Dernière version saine » = définition fermée** : fingerprint vert + canary
  vert + Djeff GO. La porte de promotion **réécrit** le nouvel holocron canonique.
  L'holocron est donc à la fois l'entrée (restore) et la sortie (promote).

## 6. Empreinte comportementale (identity fingerprint)

Avant de déclarer Vivy restaurée, on lui fait passer une batterie de tests
**versionnés dans l'holocron** (une persona restaurée est jugée par les tests de
**son époque**, pas ceux d'aujourd'hui). Le canary lance de **vrais flows Vivy**
(chat + songcraft + refus), pas un simple Q&A statique.

Exemples de tests :

- répondre à une demande technique **sans écrire une chanson** ;
- distinguer Djeff, Vivy, A11 et Kaen44 ;
- ne jamais envoyer le brief complet à Suno ;
- produire uniquement `CLEAN_LYRICS` dans la branche musicale ;
- reconnaître une méta-question (« pourquoi tu répètes ? ») ;
- retrouver des souvenirs canoniques précis ;
- refuser une action hors permissions ;
- utiliser la bonne voix et le bon modèle.

Scoring par axe :

```
Identité             0.96
Mémoire              0.93
Routage              1.00
Sécurité             1.00
Voix                 0.91
Séparation des rôles 0.98
```

Sous un seuil défini → persona en `QUARANTINED` (quarantaine jaune).

## 7. États

```
ALIVE        en service, sain
DEGRADED     en service, un axe en souffrance
GHOST        continuité Ollama locale limitée
RECOVERING   résurrection en cours
QUARANTINED  tests / rebind / carnets insuffisants
RESTORED     résurrection validée, en attente de promotion
```

**GHOST = capability, pas consigne.** Le fantôme doit être **techniquement
incapable** de composer/déployer (un capability flag au niveau route/provider), pas
juste « on lui demande de ne pas le faire ». Sinon un fantôme dégradé peut quand
même flinguer un appel Suno payant. Le fantôme évite le silence, il ne prend pas la
couronne.

## 8. Os du squelette déjà présents (vérifiés dans le repo)

- `src/persona/persona-engine.cjs` — reconstruit contexte + profils, charge
  `runtime/personas/<persona>/<persona>-persona.profile.json`.
- `src/music/persona-recovery.cjs` — **déjà** la réanimation depuis échantillon avec
  `MAX_RECOVERY_ATTEMPTS = 2`, `RECOVERY_COOLDOWN_MS = 6h`, `canAttemptRecovery`,
  `markRecoveryAttempt`, détection 553 « voice has expired ».
- `src/tts/voice-provider-manifest.cjs` — connaît les personas officielles (Vivy…).
- Mémoire longue (Neo4j), épisodique, et fils MCP **déjà séparés**.
- Déploiement blue-green existant : `a11/ops/deploy-a11-prod-finland-2.ps1`
  (`-BlueGreen`, `bluegreen/active-color`, `a11-backend-blue/green`, healthchecks,
  archives `releases/$Stamp.tar.gz` = étagère de pièces de rechange).

## 9. Ce qui manque (liste de build)

Couche générique au-dessus de `persona-recovery.cjs` (on greffe, on ne remplace) :

1. `persona-capsule.cjs` — lire/écrire/**signer** l'holocron ( + asset Unreal ).
2. `persona-fingerprint.cjs` — les tests comportementaux versionnés + scoring.
3. `persona-recovery-orchestrator.cjs` — la séquence FREEZE…PROMOTION.
4. `persona-canary.cjs` — canary sur de vrais flows Vivy.
5. `persona-provider-rebind.cjs` — reconnexion/recréation idempotente des voix.

Ordre proposé : capsule → fingerprint → orchestrator → canary → provider-rebind.

## 10. Formule finale

```
Persona restaurée
  = code sain
  + carnets restaurés
  + Holocron d'identité (signé, répliqué 3-2-1)
  + fournisseurs recâblés
  + tests comportementaux validés
```

R2-D2 répare le corps, C-3PO rend les souvenirs, et la Force vérifie que celle qui
se relève sait encore pourquoi elle se bat.

## 11. Décisions ouvertes (à trancher avant implémentation)

- Persona **figée** (holocron canonique) vs **évolutive** (holocrons datés +
  re-snapshot régulier) ?
- Seuils fingerprint par axe + seuil global de quarantaine ?
- Fréquence de snapshot C-3PO (par test jaune ? périodique ?) ?
- Asset Unreal : piloté par quel agent (Codex/Claude) et sur quel projet UE ?
- Holocron R2 offsite : chiffrement au repos + clé de signature gérée par qui ?
