// structured-logger.cjs
// Système de logging structuré pour A11
// Enregistre : timestamp, sévérité, contexte, payload, stack trace

const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalRuntimeRoot } = require('./runtime-root.cjs');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4,
};

const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];

class StructuredLogger {
  constructor(options = {}) {
    this.minLevel = LOG_LEVELS[String(options.minLevel || 'INFO').toUpperCase()] ?? LOG_LEVELS.INFO;
    this.logToFile = options.logToFile !== false;
    this.logToConsole = options.logToConsole !== false;
    this.logDir = options.logDir || path.join(process.cwd(), 'logs');
    this.sessionId = options.sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.context = options.context || {};

    if (this.logToFile) {
      try {
        if (!fs.existsSync(this.logDir)) {
          fs.mkdirSync(this.logDir, { recursive: true });
        }
      } catch (error) {
        console.warn('[StructuredLogger] Failed to create log directory:', error.message);
        this.logToFile = false;
      }
    }
  }

  _formatLogEntry(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level] || 'UNKNOWN';

    const entry = {
      timestamp,
      level: levelName,
      sessionId: this.sessionId,
      message: String(message || ''),
      ...this.context,
      ...meta,
    };

    // Ajouter la stack trace pour les erreurs
    if (level >= LOG_LEVELS.ERROR && meta.error) {
      if (meta.error instanceof Error) {
        entry.stack = meta.error.stack;
        entry.errorMessage = meta.error.message;
        entry.errorName = meta.error.name;
      } else {
        entry.errorMessage = String(meta.error);
      }
    }

    return entry;
  }

  _writeToFile(entry) {
    if (!this.logToFile) return;

    try {
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const logFile = path.join(this.logDir, `a11-${date}.jsonl`);
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(logFile, line, 'utf8');
    } catch (error) {
      console.warn('[StructuredLogger] Failed to write log:', error.message);
    }
  }

  _writeToConsole(entry) {
    if (!this.logToConsole) return;

    const { timestamp, level, message, ...rest } = entry;
    const time = timestamp.split('T')[1].split('.')[0]; // HH:MM:SS
    const prefix = `[${time}] [${level}]`;

    // Coloriser selon le niveau
    let coloredPrefix = prefix;
    if (level === 'ERROR' || level === 'CRITICAL') {
      coloredPrefix = `\x1b[31m${prefix}\x1b[0m`; // Rouge
    } else if (level === 'WARN') {
      coloredPrefix = `\x1b[33m${prefix}\x1b[0m`; // Jaune
    } else if (level === 'INFO') {
      coloredPrefix = `\x1b[36m${prefix}\x1b[0m`; // Cyan
    }

    console.log(`${coloredPrefix} ${message}`);

    // Afficher les métadonnées importantes
    const importantKeys = ['userId', 'conversationId', 'traceId', 'requestId', 'errorMessage', 'stack'];
    const importantMeta = {};
    for (const key of importantKeys) {
      if (rest[key] !== undefined) {
        importantMeta[key] = rest[key];
      }
    }

    if (Object.keys(importantMeta).length > 0) {
      console.log(`${coloredPrefix} Meta:`, JSON.stringify(importantMeta, null, 2));
    }
  }

  _log(level, message, meta = {}) {
    if (level < this.minLevel) return;

    const entry = this._formatLogEntry(level, message, meta);
    this._writeToConsole(entry);
    this._writeToFile(entry);
  }

  debug(message, meta = {}) {
    this._log(LOG_LEVELS.DEBUG, message, meta);
  }

  info(message, meta = {}) {
    this._log(LOG_LEVELS.INFO, message, meta);
  }

  warn(message, meta = {}) {
    this._log(LOG_LEVELS.WARN, message, meta);
  }

  error(message, meta = {}) {
    this._log(LOG_LEVELS.ERROR, message, meta);
  }

  critical(message, meta = {}) {
    this._log(LOG_LEVELS.CRITICAL, message, meta);
  }

  // Helper pour logger les requêtes HTTP
  logRequest(req, meta = {}) {
    this.info('HTTP Request', {
      method: req.method,
      path: req.path,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      ...meta,
    });
  }

  // Helper pour logger les erreurs avec contexte complet
  logError(message, error, meta = {}) {
    this.error(message, {
      error,
      ...meta,
    });
  }

  // Créer un logger enfant avec contexte supplémentaire
  child(additionalContext = {}) {
    return new StructuredLogger({
      minLevel: LOG_LEVEL_NAMES[this.minLevel],
      logToFile: this.logToFile,
      logToConsole: this.logToConsole,
      logDir: this.logDir,
      sessionId: this.sessionId,
      context: {
        ...this.context,
        ...additionalContext,
      },
    });
  }
}

// Instance globale par défaut
let defaultLogger = null;

function getLogger(context = {}) {
  if (!defaultLogger) {
    const logDir = process.env.A11_LOG_DIR || path.join(getCanonicalRuntimeRoot(process.env), 'logs');
    const minLevel = process.env.A11_LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG');

    defaultLogger = new StructuredLogger({
      logDir,
      minLevel,
      context: {
        service: 'a11-backend',
        nodeEnv: process.env.NODE_ENV || 'development',
      },
    });
  }

  if (Object.keys(context).length > 0) {
    return defaultLogger.child(context);
  }

  return defaultLogger;
}

module.exports = {
  StructuredLogger,
  getLogger,
  LOG_LEVELS,
};
