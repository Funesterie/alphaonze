# Deployment

## Local

```bash
docker compose up
```

La configuration locale est volontairement simple et ne doit pas etre exposee
sur Internet.

## Production

Une production doit etre preparee separement:

- TLS obligatoire sur toutes les interfaces;
- OIDC/SAML avec MFA;
- secret manager obligatoire;
- rotation des secrets;
- comptes Neo4j separes;
- PostgreSQL chiffre au repos;
- sauvegardes chiffrees;
- reverse proxy avec limitation de debit;
- journaux d'audit exportes vers un stockage append-only;
- durcissement reseau par sous-reseau prive;
- pas de port Neo4j ou PostgreSQL public;
- aucun outil MCP d'administration;
- validation juridique avant connexion a une source reelle.

## Comptes Neo4j recommandes

- `app_writer`: ecriture via pipeline seulement;
- `app_reader`: lecture backend bornee;
- `mcp_readonly`: lecture outil MCP seulement;
- `tech_admin`: humain habilite seulement.

Le compte `tech_admin` ne doit jamais etre place dans une variable accessible a
un agent IA.

## Secrets

Les variables `*_SECRET_REF` referencent des entrees du gestionnaire de secrets.
Le code ne doit jamais supposer qu'une valeur secrete est presente en clair dans
un fichier.

## Verification avant mise en service

- scan de secrets;
- tests RBAC;
- tests de fuite tenant/dossier;
- test d'effacement complet;
- revue de journaux;
- revue du modele de menace;
- revue RGPD;
- pentest avant donnees reelles.

