declare module 'pngjs' {
  export class PNG {
    width: number;
    height: number;
    data: Buffer;
    constructor(options?: any);
    static sync: any;
    pack(): any;
    toBuffer(cb: any): any;
  }
  export function PNGSync(): any;
  export function decode(data: Buffer): PNG;
}
