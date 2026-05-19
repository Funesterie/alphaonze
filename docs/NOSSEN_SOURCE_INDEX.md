# NOSSEN Source Index

NOSSEN peut devenir la couche commune qui relie les lecteurs, drives, dossiers de travail, backups et graphe Neo4j sans transformer les fichiers eux-memes en vrac public.

Cette premiere brique indexe uniquement des metadonnees:

- racine autorisee;
- chemin relatif;
- type de fichier;
- taille;
- date de modification;
- empreinte SHA-256 pour les fichiers raisonnables;
- statut de confidentialite.

Les fichiers ne sont pas copies dans Neo4j. Les fichiers qui ressemblent a des secrets, tokens, mots de passe ou cles privees sont ignores.

## Commandes

Dry-run prudent sur la config exemple:

```powershell
npm run nossen:index:dry
```

Scanner une racine precise:

```powershell
npm run nossen:index -- --root D:\projets\funesterie --max-entries 500
```

Indexer plusieurs racines sans ecrire dans Neo4j:

```powershell
npm run nossen:index -- --roots "D:\projets\funesterie;E:\funesterie-backups" --max-entries 2000
```

Synchroniser vers Aura quand les variables `KIRO_V2`, `KIRO_V2_USER`, `KIRO_V2_PASSWORD` et `KIRO_V2_DATABASE` sont chargees:

```powershell
npm run nossen:index -- --config scripts\nossen\nossen-sources.example.json --sync --target aura
```

Synchroniser vers Aura et le miroir local:

```powershell
npm run nossen:index -- --config scripts\nossen\nossen-sources.example.json --sync --target both
```

Consulter le manifeste local sans requete Neo4j:

```powershell
npm run nossen:search -- vivy
```

Voir les fichiers images les plus recents dans l'index:

```powershell
npm run nossen:search -- --category image --recent --limit 20
```

Afficher le resume local de l'index:

```powershell
npm run nossen:stats
```

Cartographier les endpoints local/prod et les runtimes disponibles:

```powershell
npm run nossen:lan:dry
```

Lancer le radar NOSSEN sur les routes autorisees `.me`:

```powershell
npm run nossen:radar
```

Ajouter un endpoint ponctuel a la carte LAN:

```powershell
npm run nossen:lan -- --endpoint https://mcp.funesterie.me/health
```

Synchroniser la carte LAN vers Aura et le miroir local:

```powershell
npm run nossen:lan -- --config scripts\nossen\nossen-lan.example.json --sync --target both
```

## Sorties

Les fichiers sont ecrits dans `runtime/nossen/source-index/`:

- `nossen-source-index.json` : manifeste complet;
- `nossen-source-index.cypher` : requetes Cypher utilisees par le script;
- `nossen-source-index.params.json` : parametres d'import pour audit.

Le script `nossen:search` lit seulement `nossen-source-index.json`. Il ne rouvre pas les fichiers source, ne copie aucun contenu et n'interroge pas Neo4j. Par defaut il affiche les chemins relatifs; ajoute `--show-path` seulement quand un humain ou un agent autorise a besoin du chemin absolu.

La carte LAN/radar est ecrite dans `runtime/nossen/lan/`:

- `nossen-lan-map.json` : endpoints, DNS, TCP, HTTP, TLS, statuts et runtimes locaux disponibles;
- `nossen-lan-map.cypher` : requetes Cypher utilisees par le script;
- `nossen-lan-map.params.json` : parametres d'import pour audit.

Elle stocke uniquement des metadonnees: statut DNS/TCP/HTTP/TLS, latence, machine locale, IP privees et disponibilite Docker/Podman/Node/NPM. Elle ne stocke aucun bearer, mot de passe, header d'autorisation ni corps de reponse.

Par defaut, un endpoint injoignable est un signal de carte et ne fait pas echouer la commande. Ajoute `--fail-on-unreachable` pour transformer ces signaux en erreur bloquante pendant un audit strict.

Le radar ne scanne pas Internet ni le reseau local au hasard. Il teste seulement les URLs explicitement listees dans `scripts/nossen/nossen-lan.example.json` ou passees a `--endpoint`.

## Labels Neo4j

Le script ajoute une couche lisible par les agents:

- `NossenSourceIndex`
- `NossenSourceRoot`
- `NossenSourceEntry`
- `FunesterieEcosystemNode`
- `NossenLanMap`
- `NossenLanHost`
- `NossenLanEndpoint`
- `NossenLanRuntime`

Les liens utilisent `FUNESTERIE_ECOSYSTEM_LINK` avec:

- `indexes-source-root`
- `contains-source-entry`
- `observes-lan-host`
- `tracks-lan-endpoint`
- `can-reach-endpoint`
- `observes-local-runtime`

## Reprendre par sujet

Chercher les fichiers indexes qui parlent de Vivy:

```cypher
MATCH (root:NossenSourceRoot)-[:FUNESTERIE_ECOSYSTEM_LINK]->(entry:NossenSourceEntry)
WHERE toLower(entry.name) CONTAINS 'vivy'
   OR toLower(entry.relativePath) CONTAINS 'vivy'
RETURN root.label AS root, entry.relativePath AS path, entry.category AS category, entry.modifiedAt AS modifiedAt
ORDER BY entry.modifiedAt DESC
LIMIT 25
```

Voir les racines connectees a NOSSEN:

```cypher
MATCH (scope:NossenSourceIndex {id: 'nossen-source-index'})
      -[:FUNESTERIE_ECOSYSTEM_LINK]->(root:NossenSourceRoot)
RETURN root.id AS id, root.label AS label, root.path AS path, root.privacy AS privacy, root.lastSeenAt AS lastSeenAt
ORDER BY root.label
```

## Regle d'usage

NOSSEN indexe d'abord les metadonnees. Le contenu complet reste dans sa source d'origine et doit etre lu seulement par un outil autorise, avec une session utilisateur legitime. C'est ce qui permet de connecter beaucoup de lecteurs sans creer un fourre-tout dangereux.
