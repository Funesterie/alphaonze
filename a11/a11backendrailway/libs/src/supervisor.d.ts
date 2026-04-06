declare module 'supervisor' {
  export function startProcess(...args: any[]): any;
  export function stopProcess(...args: any[]): any;
  export function stopAll(...args: any[]): any;
  export function clearState(...args: any[]): any;
  export function listRunning(...args: any[]): any;
  export function freezeAll(...args: any[]): any;
  export function resumeAll(...args: any[]): any;
  export function getFreezeMode(...args: any[]): any;
}
