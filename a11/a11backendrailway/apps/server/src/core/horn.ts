// Simple registry for demonstration
const horns: Record<string, Function> = {};

export function registerHorn(name: string, fn: Function): void {
  horns[name] = fn;
}

export async function scream(name: string, payload: any): Promise<any> {
  if (horns[name]) {
    return await horns[name](payload);
  }
  throw new Error(`Horn '${name}' not registered.`);
}
