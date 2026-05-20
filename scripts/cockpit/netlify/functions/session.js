'use strict';

const {
  clearSessionCookie,
  json,
  redirect,
  sessionCookie,
  verifyToken,
} = require('./auth-utils');

async function readBodyToken(event) {
  if (event.httpMethod === 'GET') {
    return String(event.queryStringParameters?.token || '').trim();
  }
  const rawBody = event.isBase64Encoded
    ? Buffer.from(String(event.body || ''), 'base64').toString('utf8')
    : String(event.body || '');
  try {
    const payload = JSON.parse(rawBody || '{}');
    return String(payload?.token || '').trim();
  } catch (_error) {
    return '';
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  }

  if (event.httpMethod === 'DELETE') {
    return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  if (!['POST', 'GET'].includes(event.httpMethod)) {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  const token = await readBodyToken(event);
  const auth = await verifyToken(token);
  if (!auth.ok) {
    return json(auth.statusCode || 401, { ok: false, error: auth.reason || 'auth_failed' });
  }

  const headers = { 'Set-Cookie': sessionCookie(token) };
  if (event.httpMethod === 'GET') return redirect('/', 302, headers);
  return json(200, { ok: true, user: auth.user }, headers);
};
