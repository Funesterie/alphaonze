import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@rome': path.resolve(__dirname, 'src/rome'),
      '@cortex': path.resolve(__dirname, 'src/cortex'),
    }
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
    setupFiles: ['./vitest.setup.js'],
    environment: 'node',
    threads: false,
    globals: true,
    testTimeout: 60000,
  },
});
