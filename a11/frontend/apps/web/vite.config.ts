import react from '@vitejs/plugin-react-swc';

const apiProxyTarget = process.env.A11_VITE_PROXY_TARGET || 'http://127.0.0.1:3000';

// Dev helper plugin: serve placeholder source maps / anonymous script to avoid devtools 404/parse errors
function placeholderMapsPlugin() {
  const buildPlaceholderMap = (fileName: string, sourceBody = '') => JSON.stringify({
    version: 3,
    file: fileName,
    sources: [fileName],
    sourcesContent: [sourceBody],
    names: [],
    mappings: '',
  });

  return {
    name: 'a11-placeholder-maps',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url = req.url || '';
        // serve a valid empty source map JSON for known map requests
        if (url.includes('.js.map')) {
          const clean = (url.split('?')[0] || '').split('/').pop() || 'unknown.map';
          const srcBase = clean.replace(/\.map$/i, '');
          const srcFile = srcBase.endsWith('.js') ? srcBase : `${srcBase}.js`;
          res.setHeader('Content-Type', 'application/json');
          res.end(buildPlaceholderMap(srcFile, '// placeholder source'));
          return;
        }
        // Some extensions inject an anonymous script request encoded as %3Canonymous%20code%3E
        if (url === '/%3Canonymous%20code%3E' || url === '/<anonymous code>') {
          res.setHeader('Content-Type', 'application/javascript');
          res.end('// placeholder for anonymous injected script\n');
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
    allowedHosts: ['host.docker.internal'],
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false
      },
      '/v1': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false
      },
      '/files': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false
      }
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
