export const logger = {
  info: (msg: string) => console.log(`\x1b[36m[QFLASH]\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[QFLASH]\x1b[0m ${msg}`),
  error: (msg: string) => console.error(`\x1b[31m[QFLASH]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[QFLASH]\x1b[0m ${msg}`),
};
