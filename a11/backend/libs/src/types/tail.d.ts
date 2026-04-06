declare module 'tail' {
  export class Tail {
    constructor(path: string, options?: any);
    on(event: string, cb: (...args: any[]) => void): void;
    unwatch(): void;
  }
  export function tail(path: string, options?: any): Tail;
}
