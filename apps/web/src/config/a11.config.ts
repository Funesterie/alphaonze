const isLocalHost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

const PROD_API_BASE = 'https://api.funesterie.pro';

export const A11Config = {
  // Prefer explicit env vars, otherwise use absolute API URL in production and relative path in localhost
  apiBaseUrl:
    ((import.meta as any).env?.VITE_A11_API_BASE_URL as string) ||
    ((import.meta as any).env?.VITE_API_BASE_URL as string) ||
    ((import.meta as any).env?.VITE_API_BASE as string) ||
    (!isLocalHost ? PROD_API_BASE : '/api')
};
