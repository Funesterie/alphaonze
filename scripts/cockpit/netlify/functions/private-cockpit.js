'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  authBridgeHtml,
  buildGoogleLoginUrl,
  html,
  redirect,
  verifyAdminFromEvent,
} = require('./auth-utils');

function readPageHtml(fileName = 'index.html') {
  const cleanFileName = fileName === 'mcp.html' ? 'mcp.html' : 'index.html';
  const candidates = [
    path.join(process.cwd(), cleanFileName),
    path.join(process.cwd(), 'scripts', 'cockpit', cleanFileName),
    path.join(__dirname, '..', '..', cleanFileName),
    path.join(__dirname, cleanFileName),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
    } catch (_error) {}
  }
  throw new Error('cockpit_page_missing');
}

function injectUser(htmlSource, user) {
  const safeEmail = String(user?.email || '').replace(/[<>&"']/g, '');
  return htmlSource.replace(
    '</body>',
    `<script>window.__FUNESTERIE_COCKPIT_USER__=${JSON.stringify({ email: safeEmail })};</script></body>`
  );
}

exports.handler = async (event) => {
  if (!['GET', 'HEAD'].includes(event.httpMethod)) {
    return html(405, '<!doctype html><title>Methode refusee</title><p>Methode refusee.</p>');
  }

  const pathName = String(event.path || '/');
  const auth = await verifyAdminFromEvent(event);
  if (!auth.ok) {
    if (/\/auth\/success\/?$/i.test(pathName)) {
      return html(200, authBridgeHtml());
    }
    if (auth.statusCode === 403) {
      return html(403, '<!doctype html><title>Acces reserve</title><p>Ce cockpit est reserve aux comptes admin Funesterie.</p>');
    }
    return redirect(buildGoogleLoginUrl('/auth/success'));
  }

  const page = /\/mcp(?:\.html)?\/?$/i.test(pathName) ? 'mcp.html' : 'index.html';
  const body = injectUser(readPageHtml(page), auth.user);
  return html(200, body);
};
