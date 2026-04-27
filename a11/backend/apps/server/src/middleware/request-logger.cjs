// request-logger.cjs
// Middleware pour logger automatiquement toutes les requêtes HTTP avec contexte complet

const { getLogger } = require('../../lib/structured-logger.cjs');

function createRequestLogger(options = {}) {
  const logger = getLogger({ component: 'http' });

  return function requestLogger(req, res, next) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Attacher le requestId et le logger à la requête
    req.requestId = requestId;
    req.logger = logger.child({
      requestId,
      userId: req.user?.id,
      conversationId: req.body?.conversationId || req.query?.conversationId,
    });

    // Logger la requête entrante
    req.logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
    });

    // Intercepter la réponse pour logger la sortie
    const originalSend = res.send;
    const originalJson = res.json;

    res.send = function (body) {
      const duration = Date.now() - startTime;
      req.logger.info('HTTP Response', {
        statusCode: res.statusCode,
        duration,
        contentLength: body ? Buffer.byteLength(body) : 0,
      });
      return originalSend.call(this, body);
    };

    res.json = function (body) {
      const duration = Date.now() - startTime;
      const isError = res.statusCode >= 400;

      if (isError) {
        req.logger.error('HTTP Error Response', {
          statusCode: res.statusCode,
          duration,
          errorBody: body,
        });
      } else {
        req.logger.info('HTTP Response', {
          statusCode: res.statusCode,
          duration,
        });
      }

      return originalJson.call(this, body);
    };

    // Capturer les erreurs non gérées
    res.on('finish', () => {
      if (res.statusCode >= 500) {
        req.logger.error('HTTP 5xx Response', {
          statusCode: res.statusCode,
          duration: Date.now() - startTime,
        });
      }
    });

    next();
  };
}

module.exports = { createRequestLogger };
