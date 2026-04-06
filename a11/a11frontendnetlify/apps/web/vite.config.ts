import react from '@vitejs/plugin-react-swc';

// Dev helper plugin: serve placeholder source maps / anonymous script to avoid devtools 404/parse errors
function placeholderMapsPlugin() {
  return {
    name: 'a11-placeholder-maps',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url = req.url || '';
        // serve a valid empty source map JSON for known map requests
        if (url.includes('.js.map')) {
          // generate a minimal but valid source map with a declared source to silence devtools warnings
          const clean = (url.split('?')[0] || '').split('/').pop() || 'unknown.map';
          const srcBase = clean.replace(/\.map$/i, '');
          const srcFile = srcBase.endsWith('.js') ? srcBase : `${srcBase}.js`;
          const map = {
            version: 3,
            file: srcFile,
            sources: [srcFile],
            sourcesContent: [''],
            names: [],
            mappings: ''
          };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(map));
          return;
        }
        // Some extensions inject an anonymous script request encoded as %3Canonymous%20code%3E
        if (url === '/%3Canonymous%20code%3E' || url === '/<anonymous code>') {
          res.setHeader('Content-Type', 'application/javascript');
          res.end('// placeholder for anonymous injected script\n//# sourceMappingURL=/installHook.js.map');
          return;
        }
        next();
      });
    },
  };
}

export default {
  plugins: [react(), placeholderMapsPlugin()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false
      },
      '/v1': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  optimizeDeps: {
    // Ensure esbuild generates sourcemaps for pre-bundled dependencies
    esbuildOptions: {
      sourcemap: true
    }
  },
  build: {
    sourcemap: true
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
} as any;
