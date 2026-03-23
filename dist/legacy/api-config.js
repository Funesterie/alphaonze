// Configuration API pour frontend déployé
// Détecte automatiquement l'environnement et configure l'accès à l'API

export const config = {
  // API Base URL depuis variables d'environnement Vite
  apiBase: import.meta.env.VITE_API_BASE || '',
  
  // Credentials pour Basic Auth (si configuré)
  user: import.meta.env.VITE_A11_USER || '',
  pass: import.meta.env.VITE_A11_PASS || '',
};

/**
 * Construit l'URL complète pour un endpoint API
 */
export function apiUrl(path) {
  // Si API_BASE est vide, on utilise les chemins relatifs (même origine)
  if (!config.apiBase) return path;
  
  // Sinon on préfixe avec l'URL du tunnel Cloudflare
  return `${config.apiBase}${path}`;
}

/**
 * Retourne les headers avec authentification si configurée
 */
export function authHeaders(additionalHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...additionalHeaders,
  };
  
  // Ajouter Basic Auth si credentials présents
  if (config.user && config.pass) {
    const token = btoa(`${config.user}:${config.pass}`);
    headers['Authorization'] = `Basic ${token}`;
  }
  
  return headers;
}

/**
 * Wrapper fetch() qui ajoute automatiquement l'URL et l'auth
 */
export async function apiFetch(path, options = {}) {
  const url = apiUrl(path);
  
  // Merge headers (auth + custom)
  const headers = authHeaders(options.headers || {});
  
  // Si c'est un FormData, on retire Content-Type (navigateur le gère)
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }
  
  return fetch(url, {
    ...options,
    headers,
  });
}

// Log de la configuration au chargement (debug)
console.log('[A11 Config]', {
  apiBase: config.apiBase || '(same-origin)',
  authEnabled: !!(config.user && config.pass),
  mode: config.apiBase ? 'remote' : 'local',
});
