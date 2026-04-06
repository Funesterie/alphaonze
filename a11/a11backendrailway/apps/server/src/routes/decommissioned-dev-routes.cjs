const express = require('express');

function buildGonePayload(routeId) {
  return {
    ok: false,
    error: 'gone',
    route: routeId,
    message: 'Cette route de debug ou de compatibilite a ete retiree du runtime public A11.',
  };
}

function createDecommissionedDevRoutesRouter() {
  const router = express.Router();

  const gone = (routeId) => (_req, res) => {
    return res.status(410).json(buildGonePayload(routeId));
  };

  router.all('/chat/dev', gone('chat-dev'));
  router.all('/chat/mask', gone('chat-mask'));
  router.all('/agent', gone('agent-dev'));
  router.all('/edit', gone('file-edit'));
  router.all('/edit/*', gone('file-edit'));
  router.all('/v1/vs', gone('a11host-vs'));
  router.all('/v1/vs/*', gone('a11host-vs'));

  return router;
}

module.exports = createDecommissionedDevRoutesRouter;
module.exports.createDecommissionedDevRoutesRouter = createDecommissionedDevRoutesRouter;
