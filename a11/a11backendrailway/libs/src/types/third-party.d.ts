// ROME-TAG: 0xF22534

declare module 'express' {
  export type Request = any;
  export type Response = any;
  export type NextFunction = any;
  export function json(): any;
  export function Router(): any;
  const express: any;
  export default express;
}

declare module 'prom-client' {
  const client: any;
  export default client;
}

declare module 'ioredis' {
  const Redis: any;
  export default Redis;
}

declare module 'uuid' {
  export function v4(): string;
}

declare module 'cookie-parser' {
  const cp: any;
  export default cp;
}

declare module 'undici' {
  const undici: any;
  export function fetch(input: any, init?: any): Promise<any>;
}
