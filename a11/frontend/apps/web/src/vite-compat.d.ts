declare module 'vite' {
  // Minimal compatibility declaration for defineConfig when types are not available in the environment
  export function defineConfig<T extends Record<string, any>>(config: T): T;
}
