import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@rome': path.resolve(__dirname, 'src/rome'),
      '@cortex': path.resolve(__dirname, 'src/cortex'),
    },
  },
  test: {
    include: [
      'src/tests/legacy-runner.spec.ts',
      'src/**/__tests__/**/*.test.ts',
      'extensions/**/src/**/*.test.ts',
      'src/tests/**/*.test.ts',
      'src/**/router.unit.spec.ts',
      'src/cortex/**/*.spec.ts',
      'src/**/*.spec.ts'
    ],
    exclude: ['**/out/**', '**/dist/**', 'node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],
    environment: 'node',
    threads: false,
    globals: true,
    testTimeout: 60000,
  },
});
