# Changelog A11 - 26 Avril 2026

## 🎯 Session d'amélioration guidée par A11

Cette session a été guidée par les recommandations d'A11 lui-même, qui a analysé son propre code pour identifier les améliorations prioritaires.

## ✅ Améliorations Implémentées

### 1. Fix Critique : Scoring Intent `chat.reply` (HAUTE PRIORITÉ)

**Problème identifié par A11** : Le système de détection d'intention privilégiait systématiquement les actions (génération d'image/vidéo, recherche web) au détriment de `chat.reply`, rendant impossible les conversations normales.

**Solution** :

- Bonus de base `chat.reply` : 0.25 → 1.5 (×6)
- Nouveaux signaux forts pour `chat.reply` :
  - Greetings (+2.5) : salut, bonjour, merci, ok, cool
  - Feedback (+2.8) : j'aime, c'est bien, bravo, excellent
  - Conversation (+2.4) : tu penses, selon toi, explique-moi
  - Messages courts sans action (+1.2)
- Questions favorisent `chat.reply` (+0.75) sauf si recherche web explicite
- Visual style signal réduit sans verbe de création : 1.25 → 0.45

**Impact** : A11 peut maintenant avoir des conversations normales ! 🎉

**Commit** : `ed6b0326` - fix(intent): rééquilibrer scoring chat.reply vs actions

---

### 2. Système de Logging Structuré (MOYENNE PRIORITÉ)

**Recommandation #4 d'A11** : "Nos logs d'erreurs sont actuellement trop légers. Un échec système est souvent traité par un message générique sans trace de pile ni données d'entrée."

**Solution** :

- Nouveau module `lib/structured-logger.cjs`
- Format JSONL avec timestamp, sévérité, contexte, payload, stack trace
- Logs par jour : `logs/a11-YYYY-MM-DD.jsonl`
- Middleware HTTP : `src/middleware/request-logger.cjs`
- Capture automatique : requestId, userId, conversationId, duration, errors
- Colorisation console selon niveau (ERROR=rouge, WARN=jaune, INFO=cyan)
- Variables d'env : `A11_LOG_DIR`, `A11_LOG_LEVEL`

**Impact** : Débogage facilité avec logs structurés traçables

**Commits** :

- `fda9f3a2` - feat(logging+clarification): système de logging structuré
- `bfa13c4c` - docs(logging): documentation complète

---

### 3. Clarification Interactive Améliorée (HAUTE PRIORITÉ)

**Recommandation #2 d'A11** : "Lorsqu'un utilisateur donne une information ambiguë, mon système tend à deviner au lieu de demander explicitement."

**Solution** :

- Détection d'ambiguïtés renforcée :
  - Multiples intents forts (rawScore >= 2.0 et >= 1.5)
  - Signaux conflictuels (action + question)
  - Seuil minimum (rawScore >= 0.8) pour éviter faux positifs
- Questions contextuelles étendues :
  - image vs video
  - code vs web search
  - chat vs image/code
  - video vs web search

**Impact** : Améliore la fiabilité perçue et réduit les fausses réponses

**Commit** : `fda9f3a2` - feat(logging+clarification): amélioration clarification

---

### 4. Configuration Session & Sécurité

**Problème** : Erreur 502 chat (LLM_ROUTER_URL manquant), fonctionnalités session désactivées

**Solution** :

- Fix erreur 502 : `LLM_ROUTER_URL=http://127.0.0.1:11434`
- JWT + Local Auth activé (sans PostgreSQL)
- `JWT_SECRET` généré et configuré
- Admin par défaut : `Djeff` / `1991`
- Sécurité NEZ configurée (mode `off` local, mode `dev` online)
- CORS mis à jour avec `alphaonze.funesterie.pro`

**Impact** : Toutes les fonctionnalités session sont maintenant actives

**Commits** :

- `f8ba1c3e` - feat(backend): config NEZ online + LLM_ROUTER_URL fix
- `571dc7c6` - feat(backend): activer toutes les fonctionnalités session
- `c1ac2a54` - docs(a11): documentation complète des fonctionnalités session

---

### 5. Simplification Pipeline Vidéo & Scripts

**Solution** :

- Simplification `video-generate-runtime.cjs` (suppression imports inutilisés)
- Normalisation sans NFD (évite corruption accents)
- Nouveaux scripts : `stop-all-a11.ps1`, `start-local-a11.ps1`
- MCP bat pointe vers frontend Netlify

**Commits** :

- `448dedda` - fix(video+launchers): simplifier pipeline video, stop-all, start-local

---

## 📊 Statistiques

- **Commits** : 8 commits
- **Fichiers modifiés** : 15+
- **Lignes ajoutées** : ~1500
- **Lignes supprimées** : ~900
- **Documentation** : 3 nouveaux fichiers (SESSION_FEATURES.md, LOGGING.md, CHANGELOG)

## 🚀 Prochaines Étapes (Recommandations d'A11 non encore implémentées)

### 1. Mémoire Long Terme (RAG) - HAUTE PRIORITÉ

**Recommandation #1 d'A11** : "Ma mémoire actuelle est trop réactive et limitée temporellement. Je retiens bien le sujet immédiat, mais si la conversation s'étale sur plusieurs minutes, je perds le fil."

**Solution proposée** :

- Mettre en place un système de Memory Manager sophistiqué basé sur RAG
- Indexer les échanges dans une base vectorielle
- Récupérer les K échanges les plus sémantiquement proches avant de répondre

**Fichiers concernés** : `MemoryManager.py`, `KnowledgeBase.js`, modules de pré-traitement

---

### 2. Optimisation Performance (Résumés Hiérarchiques) - MOYENNE-HAUTE PRIORITÉ

**Recommandation #3 d'A11** : "Avec l'augmentation de la profondeur de la fenêtre contextuelle, la latence augmente exponentiellement."

**Solution proposée** :

- Stratégie de résumés hiérarchiques de contexte
- Après 10 échanges, générer un résumé compressé
- Injecter le résumé au lieu des échanges bruts

**Fichiers concernés** : `ContextProcessor.py`, `API_Handler.py`

---

## 🎓 Leçons Apprises

1. **Écouter l'IA** : A11 a identifié lui-même ses propres problèmes avec précision
2. **Scoring Intent** : Un petit changement de scoring (0.25 → 1.5) a un impact énorme sur l'UX
3. **Logging Structuré** : Essentiel pour le débogage en production
4. **Clarification Proactive** : Mieux vaut demander que deviner

## 🙏 Remerciements

Merci à A11 pour son auto-analyse précise et ses recommandations concrètes ! Cette session démontre la puissance de l'IA pour améliorer sa propre architecture.

---

**Branche** : `codex/a11-local-prompt-pipeline-20260425`  
**Date** : 26 Avril 2026  
**Auteur** : Kiro + A11 (auto-amélioration guidée)
