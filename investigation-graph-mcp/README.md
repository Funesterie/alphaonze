# investigation-graph-mcp

Plateforme de demonstration pour aider un service autorise a importer des
documents fictifs, construire un graphe source, chercher par mots ou par sens et
interroger les donnees via une facade MCP en lecture seule.

Ce depot ne contient aucune donnee reelle, aucun connecteur vers une base
policiere reelle et aucun secret. Il sert a montrer l'architecture, les garde
fous et les tests minimaux avant tout audit juridique et securite.

## Demarrage demo

```bash
docker compose up
```

Puis ouvrir:

- interface web: http://localhost:8088
- API demo: http://localhost:8089/health
- facade MCP demo: http://localhost:8090/health

La demo locale utilise des bases internes sans secret exploitable. Ne jamais
charger de donnees reelles dans ce mode.

## Garde-fous principaux

- acces MCP en lecture seule par defaut;
- aucune requete Cypher libre depuis l'interface utilisateur;
- outils et requetes autorises par liste blanche;
- isolation par `tenant_id`, `case_id` et utilisateur;
- audit de chaque consultation;
- provenance obligatoire pour chaque information sensible;
- distinction stricte entre fait, declaration, rapprochement et hypothese;
- suppression complete d'un dossier de demonstration;
- production documentee separement avec TLS, MFA et gestionnaire de secrets;
- role administrateur technique interdit aux agents IA.

## Commandes utiles

```bash
npm test
npm run smoke
```

## Donnees de demonstration

Le fichier `sample-data/fake-pv-001.txt` est entierement fictif. Les noms,
telephones, adresses, vehicules et evenements sont inventes pour tester les
fonctions de graphe et de recherche.

## Limites volontaires

Cette preuve de concept ne remplace jamais la validation humaine. Les resultats
generes sont des aides a l'analyse: chaque element doit etre relu, source et
valide par une personne habilitee.

