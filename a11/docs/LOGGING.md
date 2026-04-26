# Système de Logging Structuré A11

## Vue d'ensemble

A11 utilise un système de logging structuré qui enregistre tous les événements importants au format JSONL (JSON Lines) pour faciliter le débogage et l'analyse.

## Fonctionnalités

- **Format structuré** : Chaque log est un objet JSON avec timestamp, niveau, contexte, payload
- **Stack traces** : Capture automatique des stack traces pour les erreurs
- **Contexte enrichi** : requestId, userId, conversationId, traceId automatiquement attachés
- **Logs par jour** : Un fichier par jour `logs/a11-YYYY-MM-DD.jsonl`
- **Console colorisée** : Rouge (ERROR), Jaune (WARN), Cyan (INFO)
- **Niveaux configurables** : DEBUG, INFO, WARN, ERROR, CRITICAL

## Configuration

### Variables d'environnement

```bash
# Répertoire des logs (défaut: runtime/logs)
A11_LOG_DIR=D:\projets\funesterie\a11\runtime\logs

# Niveau minimum de log (défaut: INFO en prod, DEBUG en dev)
A11_LOG_LEVEL=INFO  # DEBUG | INFO | WARN | ERROR | CRITICAL
```

## Utilisation

### Dans le code backend

```javascript
const { getLogger } = require("./lib/structured-logger.cjs");

// Logger global
const logger = getLogger();

// Logger avec contexte
const logger = getLogger({ component: "image-pipeline" });

// Logs simples
logger.info("Image generation started");
logger.warn("Fallback to local model", { reason: "proxy_timeout" });
logger.error("Image generation failed", { error: err, userId: "123" });

// Logger enfant avec contexte supplémentaire
const requestLogger = logger.child({
  requestId: "req_123",
  userId: "user_456",
});
requestLogger.info("Processing request");
requestLogger.error("Request failed", { error: err });

// Helper pour erreurs
logger.logError("Database connection failed", err, {
  database: "postgres",
  host: "localhost",
});
```

### Middleware HTTP automatique

Le middleware `request-logger` capture automatiquement :

- Toutes les requêtes HTTP entrantes
- Toutes les réponses HTTP sortantes
- Les erreurs 4xx et 5xx
- La durée de traitement
- Le contexte utilisateur (userId, conversationId)

```javascript
const { createRequestLogger } = require("./src/middleware/request-logger.cjs");

app.use(createRequestLogger());

// Dans les routes, le logger est attaché à req
app.get("/api/test", (req, res) => {
  req.logger.info("Test endpoint called");
  req.logger.error("Something went wrong", { error: err });
  res.json({ ok: true });
});
```

## Format des logs

### Structure d'un log

```json
{
  "timestamp": "2026-04-26T16:30:45.123Z",
  "level": "ERROR",
  "sessionId": "session_1777214704219_a3b2c1",
  "message": "Image generation failed",
  "service": "a11-backend",
  "nodeEnv": "production",
  "component": "image-pipeline",
  "requestId": "req_1777214704219_77869285",
  "userId": "user_123",
  "conversationId": "conv_456",
  "error": "Error: SD proxy timeout",
  "errorMessage": "SD proxy timeout",
  "errorName": "Error",
  "stack": "Error: SD proxy timeout\n    at generateImage (/app/src/image/pipeline.cjs:123:15)\n    ..."
}
```

### Niveaux de log

| Niveau       | Usage                                    | Exemple                                             |
| ------------ | ---------------------------------------- | --------------------------------------------------- |
| **DEBUG**    | Détails techniques pour le développement | "Cache hit for key X", "Parsing request body"       |
| **INFO**     | Événements normaux importants            | "HTTP Request", "Image generated", "User logged in" |
| **WARN**     | Situations anormales mais gérées         | "Fallback to local model", "Retry attempt 2/3"      |
| **ERROR**    | Erreurs nécessitant attention            | "Image generation failed", "Database query error"   |
| **CRITICAL** | Erreurs critiques affectant le service   | "Database connection lost", "Out of memory"         |

## Analyse des logs

### Lire les logs

```bash
# Logs du jour
cat logs/a11-2026-04-26.jsonl

# Filtrer par niveau
grep '"level":"ERROR"' logs/a11-2026-04-26.jsonl

# Filtrer par userId
grep '"userId":"user_123"' logs/a11-2026-04-26.jsonl

# Extraire les stack traces
grep '"stack":' logs/a11-2026-04-26.jsonl | jq -r '.stack'

# Compter les erreurs par type
grep '"level":"ERROR"' logs/a11-2026-04-26.jsonl | jq -r '.errorName' | sort | uniq -c
```

### Avec jq (JSON query)

```bash
# Tous les logs d'un utilisateur
cat logs/a11-2026-04-26.jsonl | jq 'select(.userId == "user_123")'

# Erreurs avec stack trace
cat logs/a11-2026-04-26.jsonl | jq 'select(.level == "ERROR") | {timestamp, message, errorMessage, stack}'

# Durée moyenne des requêtes
cat logs/a11-2026-04-26.jsonl | jq 'select(.duration) | .duration' | awk '{sum+=$1; count++} END {print sum/count}'

# Top 10 des endpoints les plus lents
cat logs/a11-2026-04-26.jsonl | jq 'select(.duration) | {path, duration}' | jq -s 'sort_by(.duration) | reverse | .[0:10]'
```

## Bonnes pratiques

### 1. Toujours inclure le contexte

```javascript
// ❌ Mauvais
logger.error("Failed");

// ✅ Bon
logger.error("Image generation failed", {
  error: err,
  userId: req.user?.id,
  imageId: imageId,
  model: "sd3.5-large",
});
```

### 2. Utiliser les niveaux appropriés

```javascript
// ❌ Mauvais - trop de bruit
logger.info("Variable x =", x);
logger.info("Entering function foo");

// ✅ Bon
logger.debug("Variable x =", x);
logger.debug("Entering function foo");
```

### 3. Logger les erreurs avec stack trace

```javascript
// ❌ Mauvais
logger.error("Error: " + err.message);

// ✅ Bon
logger.error("Image generation failed", { error: err });
// ou
logger.logError("Image generation failed", err, { imageId });
```

### 4. Créer des loggers enfants pour le contexte

```javascript
// ❌ Mauvais - répéter le contexte partout
logger.info("Step 1", { requestId, userId });
logger.info("Step 2", { requestId, userId });
logger.info("Step 3", { requestId, userId });

// ✅ Bon
const reqLogger = logger.child({ requestId, userId });
reqLogger.info("Step 1");
reqLogger.info("Step 2");
reqLogger.info("Step 3");
```

## Rotation des logs

Les logs sont automatiquement séparés par jour. Pour nettoyer les anciens logs :

```bash
# Supprimer les logs de plus de 30 jours
find logs/ -name "a11-*.jsonl" -mtime +30 -delete

# Compresser les logs de plus de 7 jours
find logs/ -name "a11-*.jsonl" -mtime +7 -exec gzip {} \;
```

## Intégration avec des outils externes

### Elasticsearch / Kibana

```bash
# Importer dans Elasticsearch
cat logs/a11-2026-04-26.jsonl | while read line; do
  curl -X POST "localhost:9200/a11-logs/_doc" -H 'Content-Type: application/json' -d "$line"
done
```

### Grafana Loki

```bash
# Configurer Promtail pour lire les logs JSONL
# promtail-config.yaml
scrape_configs:
  - job_name: a11
    static_configs:
      - targets:
          - localhost
        labels:
          job: a11-backend
          __path__: /path/to/logs/a11-*.jsonl
    pipeline_stages:
      - json:
          expressions:
            level: level
            message: message
```

## Troubleshooting

### Les logs ne sont pas créés

1. Vérifier que `A11_LOG_DIR` existe et est accessible en écriture
2. Vérifier les permissions du répertoire
3. Vérifier les logs console pour les erreurs de création

### Les logs sont trop verbeux

1. Augmenter `A11_LOG_LEVEL` à `WARN` ou `ERROR`
2. Désactiver les logs console : `logToConsole: false` dans le logger

### Les logs manquent de contexte

1. Utiliser `req.logger` dans les routes (contexte automatique)
2. Créer des loggers enfants avec `logger.child({ ... })`
3. Passer le contexte explicitement dans chaque log
