# Security

## Perimetre

Ce depot est une demonstration locale. Il ne doit pas etre relie directement a
des donnees sensibles, a une base policiere reelle ou a un systeme de production
sans audit juridique et securite.

## Secrets

Aucun secret ne doit etre commite. La configuration se fait par `.env.example`
et par references vers un gestionnaire de secrets:

- HashiCorp Vault;
- AWS Secrets Manager;
- Google Secret Manager;
- Azure Key Vault;
- gestionnaire equivalent approuve.

## Comptes Neo4j

La production doit separer au minimum:

- compte applicatif en ecriture controlee;
- compte MCP lecture seule;
- compte analytique lecture bornee;
- compte administrateur technique reserve aux humains habilites.

Le compte administrateur ne doit jamais etre expose a un agent IA.

## Requetes

L'interface utilisateur et MCP n'acceptent pas de Cypher libre. Les requetes
passent par des identifiants de requete ou des outils autorises.

## Controle d'acces

Les roles prevus sont:

- `public_demo`;
- `analyste`;
- `enqueteur`;
- `superviseur`;
- `administrateur_technique`.

Chaque action verifie le role, le tenant, le dossier et le statut agent/humain.

## Signalement

Tout probleme de securite doit etre traite hors issue publique avec les
responsables du projet. Ne pas joindre de donnees reelles dans les rapports.

