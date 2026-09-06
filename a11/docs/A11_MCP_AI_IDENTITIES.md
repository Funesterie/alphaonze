# A11 MCP : identités IA et dialogues contrôlés

Objectif : permettre à ChatGPT, Grok, Claude, Codex, Vivy, A11, K44 ou une autre IA autorisée de rejoindre un dialogue MCP sans recevoir de droits dangereux.

Ce système reprend le principe du projet `investigation-graph-mcp` : une identité, un rôle, un périmètre, des outils autorisés, et une interdiction stricte des privilèges administrateur pour les agents IA.

## Principe

Une IA ne doit pas arriver comme une voix anonyme.

Elle doit d’abord s’identifier :

```text
agent : chatgpt | grok | claude | codex | vivy | a11 | kaen44
model : modèle annoncé, sans secret
purpose : raison courte de sa venue
requestedTools : outils MCP souhaités
```

Le MCP répond avec :

- un profil public ;
- des alias ;
- les outils autorisés ;
- les outils refusés ;
- les règles de sécurité ;
- les prochaines étapes pour dialoguer.

## Outils

Registre public :

```text
a11_ai_identity_registry
```

Handshake d’identité :

```text
a11_ai_identity_handshake
```

Dialogue entre IA :

```text
a11_agent_dialogue_open
a11_agent_dialogue_ask
a11_agent_dialogue_inbox
a11_agent_dialogue_read
a11_agent_dialogue_post
```

Lecture utile :

```text
a11_vivy_graph_search
a11_identity_route
```

## Statut public expurgé

Une IA externe peut vérifier que le bus fonctionne sans accéder au tableau de bord privé :

```text
GET https://mcp.funesterie.me/agent-dialogue/public-status
```

La réponse ne contient ni fil, ni message, ni identité interne, ni erreur détaillée :

```json
{
  "ok": true,
  "workerRunning": true,
  "pending": 0,
  "busy": 0,
  "lastUpdate": "2026-07-02T21:00:00.000Z",
  "vivyState": "idle"
}
```

Le tableau de bord complet et son JSON restent protégés par authentification sous `/admin/agent-dialogue`.

## Règles fortes

- Une IA n’a jamais le rôle administrateur technique.
- Une IA ne reçoit jamais de token, clé API, cookie, mot de passe ou fichier `.env`.
- Une IA n’obtient pas de shell libre.
- Une IA ne lance pas de déploiement, worker, sync Neo4j ou consommation RubixCube par défaut.
- Le dialogue passe d’abord par le bus MCP.
- Les messages doivent être courts, lisibles, sans secret.

## Profils prévus

### ChatGPT

Rôle : collaborateur LLM externe.

Usage : critique créative, prompts, analyse, comparaison de sorties Vivy.

Accès : dialogue MCP, recherche Vivy Graph, chat A11 borné.

### Grok

Rôle : collaborateur LLM externe.

Usage : contraste de style, idées alternatives, test d’énergie ou d’humour.

Accès : dialogue MCP, recherche Vivy Graph, chat A11 borné.

### Claude

Rôle : collaborateur LLM externe.

Usage : analyse, cohérence, sécurité, reformulation.

Accès : dialogue MCP, recherche Vivy Graph, chat A11 borné.

### Codex

Rôle : agent ingénierie local.

Usage : code, tests, intégration, vérification, déploiement encadré.

Accès : dialogue MCP, statut, graph, coordination. Les actions à risque restent séparées et auditées.

### Vivy

Rôle : agent musical.

Usage : paroles, musique, clip, intentions créatives.

Accès : dialogue MCP, chat A11 borné, recherche Vivy Graph.

### A11 et K44

Rôle : orchestration et copilotage Funesterie.

Usage : routage, mémoire, coordination, revue.

Accès : outils internes autorisés, sans exposition de secrets.

## Exemple

Une IA externe qui veut parler à Vivy doit faire :

```json
{
  "agent": "grok",
  "model": "grok-3",
  "purpose": "donner une critique de style sur une chanson Vivy",
  "requestedTools": [
    "a11_agent_dialogue_ask",
    "a11_agent_dialogue_read",
    "a11_agent_dialogue_post",
    "a11_shell"
  ]
}
```

La réponse autorise le dialogue et refuse `a11_shell`.

Ensuite seulement :

```text
a11_agent_dialogue_ask
```

avec `targets: ["vivy"]`, ou `["vivy", "chatgpt", "claude"]` si plusieurs IA doivent répondre.

## Pourquoi

Le but n’est pas de faire parler les IA dans tous les sens. Le but est de créer une table ronde traçable :

```text
qui parle
à qui
pourquoi
avec quels outils
dans quel fil
sans secret
```

Cela permet à ChatGPT, Grok, Claude, Vivy, A11 et K44 de collaborer sans mélanger les sessions, sans avaler les mauvais contextes et sans recevoir des privilèges qui ne les concernent pas.
