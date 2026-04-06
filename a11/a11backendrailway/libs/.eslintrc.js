module.exports = {
  // general config applied to all files
  ignorePatterns: ['dist/', 'node_modules/', '.qflush/', 'extensions/**/obj/', 'extensions/**/bin/'],
  plugins: ['@typescript-eslint'],
  rules: {
    'no-unused-vars': 'off',
    'no-console': 'off',
    'prefer-const': 'warn'
  },
  overrides: [
    {
      // Tests and tools: do not use type-aware rules (no parserOptions.project)
      files: ['src/tests/**', 'tools/**'],
      parser: '@typescript-eslint/parser',
      parserOptions: { tsconfigRootDir: __dirname },
      plugins: ['@typescript-eslint'],
      rules: {
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
      }
    },
    {
      // All other TS files: use project-aware parser
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: __dirname },
      plugins: ['@typescript-eslint'],
      rules: {
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
      }
    },
    {
      files: ['**/*.js'],
      env: { node: true, es2020: true }
    }
  ]
};
