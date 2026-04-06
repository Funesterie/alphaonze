declare module 'vitest' {
  export const describe: any;
  export const it: any;
  export const test: any;
  export const expect: any;
  export const beforeEach: any;
  export const afterEach: any;
  export const vi: any;
  export const beforeAll: any;
  export const afterAll: any;
}

// also provide global names so tsc finds describe/test when no vitest types are installed
declare const describe: any;
declare const it: any;
declare const test: any;
declare const expect: any;
declare const beforeEach: any;
declare const afterEach: any;
declare const vi: any;
declare const beforeAll: any;
declare const afterAll: any;
