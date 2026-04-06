/* ROME-TAG: 0xF45330 */
import gumroad from '../utils/gumroad-license';
import logger from '../utils/logger';
import { getSecret } from '../utils/secrets';

export async function runLicense(argv: string[] = []) {
  const sub = argv[0];
  if (!sub) {
    logger.info('Usage: qflush license activate <key> [--product=<id>]');
    return 1;
  }

  if (sub === 'activate') {
    const key = argv[1];
    if (!key) {
      logger.error('No license key provided. Usage: qflush license activate <key> [--product=<id>]');
      return 1;
    }
    // parse optional --product=ID
    const prodArg = argv.find((a) => a.startsWith('--product='));
    const productId = prodArg ? prodArg.split('=')[1] : process.env.GUMROAD_PRODUCT_ID || process.env.GUMROAD_PRODUCT_YEARLY || process.env.GUMROAD_PRODUCT_MONTHLY;
    const token = getSecret('GUMROAD_TOKEN', { fileEnv: 'GUMROAD_TOKEN_FILE' });
    if (!token) {
      logger.error('GUMROAD_TOKEN not set (env or file). Set it to perform activation.');
      return 1;
    }
    if (!productId) {
      logger.warn('No product id provided, continuing with provided key verification (Gumroad may accept product lookup).');
    }
    try {
      const rec = await gumroad.activateLicense(productId as string, key, token);
      logger.success(`License activated. Expires: ${rec.expiresAt ? new Date(rec.expiresAt).toISOString() : 'subscription/never'}`);
      return 0;
    } catch (err: any) {
      logger.error(`License activation failed: ${err.message || err}`);
      return 2;
    }
  }

  if (sub === 'status') {
    const rec = gumroad.loadLicense();
    if (!rec) {
      logger.info('No local license found');
      return 0;
    }
    logger.info(`Local license: key=${rec.key} product=${rec.product_id} expires=${rec.expiresAt ? new Date(rec.expiresAt).toISOString() : 'never'}`);
    return 0;
  }

  if (sub === 'clear') {
    gumroad.clearLicense();
    logger.info('Local license cleared');
    return 0;
  }

  logger.info('Unknown license command');
  return 1;
}
