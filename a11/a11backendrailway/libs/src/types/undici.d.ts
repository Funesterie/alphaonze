declare module 'undici' {
  export function fetch(input: any, init?: any): Promise<any>;
  const undici: any;
  export default undici;
}
