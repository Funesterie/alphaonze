// Nezlephant auth middleware (CommonJS)
function parseNezTokens(envValue) {
  const map = {};
  if (!envValue) return map;
  // entries separated by ';' with format client=token
  const entries = envValue.split(';').map(s => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const [id, token] = entry.split('=').map(s => (s || '').trim());
    if (id && token) map[id] = token;
  }
  return map;
}

const TOKENS = parseNezTokens(process.env.NEZ_TOKENS);
const MODE = (process.env.NEZ_SECURITY_MODE || 'dev').toLowerCase();
const LOCAL_BYPASS_ENABLED = !['false', '0', 'no', 'off'].includes(
  String(
    process.env.NEZ_ALLOW_LOCAL_BYPASS ||
      (process.env.NODE_ENV === 'production' ? 'false' : 'true')
  ).toLowerCase()
);

const nezAccessLog = [];

// In-memory store for tokens issued by /api/auth/login
const issuedTokens = new Set();
function registerIssuedToken(token) {
  issuedTokens.add(token);
}

function isLoopbackIp(value) {
  const ip = String(value || '').trim().toLowerCase().replace(/^::ffff:/, '');
  return ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || ip === '[::1]';
}

function isLocalRequest(req) {
  try {
    const host = (req.hostname || '').toLowerCase();
    const ip = (req.ip || '').toString();
    const forwarded = req.headers['x-forwarded-for'];
    const directRemote = req.socket?.remoteAddress || req.connection?.remoteAddress || '';

    // A public reverse proxy may connect from 127.0.0.1 while forwarding an external
    // client IP. In that case, never treat the request as local by default.
    if (forwarded) {
      if (process.env.NEZ_TRUST_FORWARD_LOCAL !== 'true') return false;
      const firstForwardedIp = String(forwarded).split(',')[0].trim();
      return isLoopbackIp(directRemote) && isLoopbackIp(firstForwardedIp);
    }

    if (isLoopbackIp(host)) return true;
    if (isLoopbackIp(ip)) return true;
    if (isLoopbackIp(directRemote)) return true;
  } catch (e) {}
  return false;
}

function nezAuth(req, res, next) {
  // 1) MODE off => allow all
  if (MODE === 'off') return next();

  // 1.a) If request carries admin header and it matches, allow and mark as admin
  const adminHeader = (req.header('X-NEZ-ADMIN') || '').trim();
  if (adminHeader && process.env.NEZ_ADMIN_TOKEN && adminHeader === process.env.NEZ_ADMIN_TOKEN) {
    // attach admin client info
    req.nezClient = { id: 'admin', token: adminHeader, source: 'admin' };
    try {
      nezAccessLog.push({ when: new Date(), clientId: 'admin', path: req.path, ip: req.ip });
      if (nezAccessLog.length > 500) nezAccessLog.shift();
    } catch (e) {}
    return next();
  }

  // 2) In dev mode, allow local requests only when the local bypass is enabled.
  if (MODE === 'dev' && LOCAL_BYPASS_ENABLED && isLocalRequest(req)) {
    return next();
  }

  // Try multiple header formats for auth flexibility
  let headerToken = (req.header('X-NEZ-TOKEN') || '').trim();
  
  // Fallback to Authorization: Bearer xxx
  if (!headerToken) {
    const authHeader = (req.header('Authorization') || '').trim();
    if (authHeader.startsWith('Bearer ')) {
      headerToken = authHeader.slice(7);
    }
  }
  
  // Fallback to x-api-key
  if (!headerToken) {
    headerToken = (req.header('x-api-key') || '').trim();
  }
  
  if (!headerToken) {
    return res.status(403).json({
      error: 'A11_Nezlephant_Filter',
      message: "Nezlephant ne t'a pas encore reconnu sur ce réseau (token manquant).",
    });
  }

  // Accept tokens issued by /api/auth/login (in-memory)
  if (issuedTokens.has(headerToken)) {
    req.nezClient = { id: 'session', token: headerToken, source: 'login' };
    try {
      nezAccessLog.push({ when: new Date(), clientId: 'session', path: req.path, ip: req.ip });
      if (nezAccessLog.length > 500) nezAccessLog.shift();
    } catch (e) {}
    return next();
  }

  let matchedId = null;
  for (const [id, token] of Object.entries(TOKENS)) {
    if (token === headerToken) {
      matchedId = id;
      break;
    }
  }

  if (!matchedId) {
    return res.status(403).json({
      error: 'A11_Nezlephant_Filter',
      message: 'Nezlephant ne te reconnaît pas (token invalide).',
    });
  }

  // attach nezClient info
  req.nezClient = {
    id: matchedId,
    token: headerToken,
    source: matchedId,
  };

  // push access log
  try {
    nezAccessLog.push({ when: new Date(), clientId: matchedId, path: req.path, ip: req.ip });
    if (nezAccessLog.length > 500) nezAccessLog.shift();
  } catch (e) {}

  next();
}

function getNezAccessLog() {
  return nezAccessLog.slice().reverse();
}

module.exports = {
  nezAuth,
  parseNezTokens,
  TOKENS,
  MODE,
  LOCAL_BYPASS_ENABLED,
  getNezAccessLog,
  registerIssuedToken
};
