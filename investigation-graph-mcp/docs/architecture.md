# Architecture

## Vue generale

La plateforme demo est composee de cinq blocs:

1. Frontend web: interface analyste sans Cypher libre.
2. Backend API: authentification demo, RBAC, isolation, audit et pipeline.
3. Serveur MCP: outils de lecture autorises par liste blanche.
4. Neo4j: graphe source et index vectoriel/lexical cible.
5. PostgreSQL: comptes, roles, dossiers, audits et demandes de suppression.

## Flux principal

1. Un utilisateur habilite importe un faux proces-verbal.
2. Le backend extrait personnes, telephones, vehicules, adresses, dates et
   evenements.
3. Chaque element est enregistre avec provenance, classification et statut de
   verification.
4. Le graphe relie les entites par faits, declarations, rapprochements et
   hypotheses.
5. Les recherches lexicales ou semantiques retournent uniquement le dossier
   autorise.
6. Chaque consultation cree une ligne d'audit.

## Separation des responsabilites

- Le frontend ne decide jamais seul des droits.
- Le backend applique RBAC, tenant, dossier, limitation de debit et audit.
- MCP est lecture seule par defaut et ne publie pas d'outil administratif.
- Neo4j recoit des comptes separes par role en production.
- PostgreSQL porte la partie comptes/audit hors graphe.

## Donnees

Chaque noeud sensible doit inclure:

- `source_id`;
- `source_type`;
- `created_at`;
- `classification`;
- `confidence`;
- `tenant_id`;
- `case_id`;
- `visibility`;
- `verified_by`;
- `verification_status`.

## Recherche

La demo fournit:

- recherche lexicale par nom ou variante;
- recherche semantique deterministe locale;
- chronologie par date;
- affichage des sources exactes;
- export de rapport source.

En production, l'index vectoriel peut etre remplace par Neo4j vector index,
pgvector, OpenSearch ou un moteur audite.

