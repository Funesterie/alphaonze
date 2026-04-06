import { defineConfig } from 'vitest/config';

export default defineConfig({
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
