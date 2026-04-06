// Ambient shims to help editors/tsserver resolve test and .js imports

// Basic vitest module shim
declare module 'vitest' {
  const describe: any;
  const it: any;
  const test: any;
  const expect: any;
  const beforeEach: any;
  const afterEach: any;
  const vi: any;
  const beforeAll: any;
  const afterAll: any;
  export { describe, it, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi };
}

// Allow importing compiled .js files from TS source (example: import './foo.js')
declare module '*.js';

// Provide a permissive default export for built-in node modules in editor (silences default-import warnings)
// These declarations are only for the TypeScript server/editor convenience and do not change runtime.
declare module 'fs' {
  import * as fs from 'fs';
  const _default: typeof fs & { default?: typeof fs };
  export = _default;
}

declare module 'path' {
  import * as path from 'path';
  const _default: typeof path & { default?: typeof path };
  export = _default;
}

declare module 'net' {
  import * as net from 'net';
  const _default: typeof net & { default?: typeof net };
  export = _default;
}
