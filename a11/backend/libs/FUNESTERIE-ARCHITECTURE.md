FUNESTERIE — Architecture & Vision

Objectif
--------
Créer un écosystème modulaire et évolutif où chaque couche a une responsabilité unique et communique via interfaces claires : QFLUSH (orchestrateur), ROME (moteur logique / indexeur), NPZ (router / admin), BAT (process manager), Nezlephant/OC8 (stockage caché), A11 (interface IA), SPYDER (futur moteur neuronal).

Sommaire des composants
-----------------------

1) QFLUSH — Orchestrateur
- CLI + daemon HTTP.
- Commandes principales : `start`, `kill`, `purge`, `inspect`, `config`, `daemon`.
- Supervise les modules, expose NPZ/Rome endpoints, centralise la config et le SmartChain pipeline.

2) BAT — Process Manager
- Spawn / stop / restart / status.
- Détache les services (non bloquant), persiste état dans `.qflush/services.json`, logs dans `.qflush/logs/`.
- Strictement process management — pas de router ni logique.

3) NPZ (Joker) — Router & Admin
- Router et diagnostics pour les modules.
- Endpoints exposés par le daemon : checksums, rome-index, rome-links, resolve, SSE stream.
- CLI : `qflush npz:inspect`, `qflush npz:scores`.
- Stockage : fallback mémoire/fichiers; Redis optionnel (opt‑in via `QFLUSH_ENABLE_REDIS`).

4) ROME — Index, Engine, Logic, Linker
- Indexation des sources annotées (`ROME-TAG`) → `.qflush/rome-index.json`.
- Engine évalue l’index et émet des actions (computeEngineActionsSafe).
- Logic rules (déclaratives) déclenchent actions à la change.
- Linker (v3.1): scan `[[token]]`, résout cibles, génère `.qflush/rome-links.json`, fournit résolution HTTP et SSE.

5) Nezlephant / OC8 — Stockage caché RGBA
- Encodage/décodage de blobs (PNG / RGBA / OC8).
- Usage pour secrets (`nez:<file>`), configs, payloads.
- Intégration via `envapt-nezlephant`.

6) A11 — Interface IA (prévu)
- Proxy/local LLM connector (Ollama/OpenAI/Gemini).
- Orchestration d’appels IA pour augmentation des règles NPZ/ROME.

7) SPYDER — Futur moteur neuronal
- Architecture envisagée : graph de « neurones » (.ner), snapshots, routage d’état → réponses.
- Intégration future avec A11 et NPZ.

Le Mapping (principes)
----------------------
- Ordre de priorité strict pour la résolution des chemins :
  1. Chemin explicite fourni
  2. Chemin détecté (detectModules)
  3. Chemin local candidate
  4. Résolution via node_modules/package
  5. Fallback NPZ (optionnel)
- Early-exit : si un chemin est valide → ne pas ré-interpréter.

Daemon (qflushd)
-----------------
- Expose les endpoints NPZ et Rome.
- Supervise engineHistory et telemetry (Copilot Bridge).
- SSE stream pour rome-links & telemetry.
- Audit log, option Redis.

Copilot Bridge
--------------
- Envoie événements/règles/télémetry vers l’extension VS et services IA.
- Fournit un canal bidirectionnel (notifications → actions).

Principes d’exploitation & Dev
------------------------------
- En dev : garder Redis désactivé (fallback mémoire).
- Activer mapping uniquement quand nécessaire (`QFLUSH_ENABLE_MAPPING=1`).
- Démarrer le daemon détaché pour éviter d’ouvrir fichiers dans l’IDE (`qflush daemon --detached`).

Fichiers utiles
---------------
- `.qflush/rome-index.json` — Rome index
- `.qflush/rome-links.json` — linker output
- `.qflush/services.json` & `.qflush/logs/` — BAT state & logs

Next steps recommandés
----------------------
- Ajouter ce doc au README (done).
- Générer un diagramme SVG/PNG et l’ajouter dans `docs/`.
- Créer `copilot-context.md` (très court) pour fournir le résumé à Copilot.
- Intégrer tests unitaires pour NPZ encoder / checksum / linker.

Notes
-----
- SPYDER et A11 sont des objectifs long terme. Pour l’instant conserver les noms est acceptable ; implémentations futures clarifieront les responsabilités.


