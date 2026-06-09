# Threat Model

## Objectif de securite

Permettre l'analyse aidee par graphe sans fuite entre dossiers, sans requete
libre dangereuse et sans donner de privilege administratif a un agent IA.

## Actifs proteges

- documents importes;
- entites extraites;
- relations et hypotheses;
- sources exactes;
- comptes utilisateurs;
- journaux d'audit;
- configuration et secrets.

## Adversaires consideres

- utilisateur non authentifie;
- utilisateur autorise tentant d'acceder a un autre tenant;
- utilisateur autorise tentant d'acceder a un autre dossier;
- agent IA trop curieux ou mal route;
- tentative d'injection Cypher;
- dependance compromise;
- erreur de configuration en production.

## Menaces et controles

| Menace | Controle |
| --- | --- |
| Fuite entre dossiers | Filtrage obligatoire `tenant_id` + `case_id` |
| Fuite entre organisations | Isolation par tenant et tests dedies |
| Cypher libre | Refus de toute requete libre cote API et MCP |
| Agent IA admin | Blocage du role `administrateur_technique` si `isAgent=true` |
| Donnee non sourcee | Validation obligatoire des champs de provenance |
| Mauvaise classification | Liste fermee et test d'erreur |
| Requete trop large | Refus des recherches vagues ou joker |
| Suppression incomplete | Suppression coordonnee documents/noeuds/relations/audit de deletion |
| Secret commite | `.env.example`, `.gitignore`, secret manager |
| Transport non chiffre | TLS requis en production |

## Hypotheses de confiance

- La demo locale n'est pas exposee publiquement.
- La production utilise TLS, MFA, OIDC/SAML et un gestionnaire de secrets.
- Les administrateurs techniques sont humains, habilites et audites.

## Risque residuel

La qualite de l'extraction et des rapprochements depend des modeles et des
regles. Les hypotheses doivent rester clairement marquees et validees par un
humain.

