// web-cache.cjs — placeholder non implémenté
// À compléter avec extraction R2 depuis server.cjs avant utilisation.
// Tout import actif de ce module doit traiter cette erreur explicitement.

function notImplemented(method) {
  const err = new Error(`web-cache: method "${method}" not implemented — module is a stub`);
  err.code = 'WEB_CACHE_NOT_IMPLEMENTED';
  throw err;
}

module.exports = {
  get: () => notImplemented('get'),
  set: () => notImplemented('set'),
  has: () => notImplemented('has'),
  delete: () => notImplemented('delete'),
};
