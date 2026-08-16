'use strict';
// nossen-addon.cjs — Serve NOSSEN main page at /nossen and /nossen/
const path = require('path');
const fs = require('fs');

module.exports = function mountNossenRoute(app) {
  const nossenFile = path.join(__dirname, 'nossen-index.html');
  if (!fs.existsSync(nossenFile)) {
    console.warn('[nossen-addon] nossen-index.html not found, skipping route');
    return;
  }

  app.get(['/nossen', '/nossen/'], (req, res) => {
    res.sendFile(nossenFile);
  });

  console.log('[Server] NOSSEN main page mounted at /nossen');
};
