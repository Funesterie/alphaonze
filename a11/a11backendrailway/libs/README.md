# QFLUSH — Orchestrateur Funesterie

QFLUSH est l’orchestrateur principal de l’écosystème Funesterie. Il permet de piloter, superviser, configurer et tester tous les modules internes (cortex, spyder, nezlephant, npz, piccolo, etc.) depuis une seule CLI.

---

## 🚀 Fonctionnalités principales

- **Orchestration complète** : Démarrage, arrêt, purge, inspection, logs, redémarrage de tous les services Funesterie.
- **Superviseur intégré** : Gestion des processus, logs, état, arrêt propre, purge d’état.
- **SmartChain** : Pipeline intelligent qui enchaîne automatiquement les étapes nécessaires selon la commande et les flags.
- **Support YAML/FCL** : Composition de modules via `funesterie.yml` ou `funesterie.fcl`.
- **Gestion de la configuration** : Génération automatique des fichiers `.env` et config manquants.
- **Gestion de licence** : Activation, statut, et gestion de licence commerciale.
- **NPZ** : Résolution, exécution, scoring et routage de paquets NPZ.
- **Cortex** : Décodage, application et orchestration de paquets cortex (JSON/PNG).
- **Spyder** : Décodage, gestion de secrets, healthcheck, etc.
- **Piccolo** : Auto-réparation, snapshot, tests safe, migration.
- **Extensible** : Ajoutez vos propres modules/services via le mapping `SERVICE_MAP`.

---

## 📦 Structure du projet

- `src/commands/` : Toutes les commandes CLI (start, kill, purge, inspect, config, compose, license, piccolo, checksum, apply, etc.)
- `src/supervisor/` : Superviseur de processus (startProcess, stopProcess, listRunning, etc.)
- `src/compose/` : Parsing et gestion des fichiers compose (YAML/FCL)
- `src/utils/` : Utilitaires NPZ, logger, paths, exec, etc.
- `src/cortex/` : Codec, router, types, applyPacket, etc.
- `src/spyder/` : Décodage, lamp, core, secrets, etc.
- `src/piccolo/` : Outils de réparation, tests safe, migration.
- `src/services/` : Abstraction et gestion des services intégrés.
- `src/core/` : Fonctions cœur (gandalf-light, a11Client, etc.)

---

## 🛠️ Commandes principales

| Commande | Description |
|----------|-------------|
| `qflush start` | Démarre tous les services/modules (auto-détection ou ciblé) |
| `qflush kill` | Arrête proprement tous les processus supervisés |
| `qflush purge` | Supprime caches, logs, sessions, état du superviseur |
| `qflush inspect` | Affiche l’état des services et ports actifs |
| `qflush config` | Génère les fichiers `.env`/config manquants |
| `qflush compose up/down/restart/logs` | Orchestration multi-module via fichiers compose |
| `qflush license` | Activation, statut, et gestion de licence commerciale |
| `qflush piccolo` | Outils d’auto-réparation, snapshot, tests safe |
| `qflush checksum` | Stockage et vérification de checksums (NPZ) |
| `qflush apply` | Applique des paquets “cortex” (JSON/PNG) |
| `qflush help` | Affiche l’aide et la liste des commandes |

---

## ⚡ Exemples d’utilisation

```sh
# Démarrer tout l’écosystème
qflush start

# Démarrer un service spécifique
qflush start --service nezlephant

# Purger tous les caches, logs, sessions
qflush purge

# Inspecter l’état des services
qflush inspect

# Générer les fichiers .env manquants
qflush config

# Orchestration via compose
qflush compose up
qflush compose down
qflush compose logs nezlephant

# Activer une licence
qflush license activate <clé>

# Appliquer un paquet cortex
qflush apply --approve
```

---

## 🧙 Modules internes Funesterie

- **gandalf-light** (`src/core/gandalf-light.ts`) : Orchestration, audit, signalisation, télémétrie.
- **gollum-paths** (`src/rome/gollum-paths.ts`) : Résolution avancée des chemins, mapping de modules.
- **a11Client** (`src/core/a11Client.ts`) : Client pour le module A-11 (IA, analyse, etc.).
- **horn** (`src/core/horn.ts`) : Utilitaire de signalisation/notification.
- **rome-tag** (`src/rome/rome-tag.ts`) : Gestion des tags et métadonnées pour Rome.

---

## 📦 Publication et installation

Pour publier une nouvelle version :

```sh
npm version major   # ou minor/patch selon le cas
npm run build
npm publish --access public
```

Pour installer et utiliser globalement :

```sh
npm install -g @funeste38/qflush
qflush --help
```

---

## 📝 Licence

Projet Funesterie — voir la licence commerciale pour FCL si besoin.
