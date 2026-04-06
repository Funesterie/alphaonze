// ROME-TAG: 0xA65E04

import license from '../utils/license.js';

export default async function runLicenseActivate(args: string[]) {
  const key = args[0];
  const product = args[1] || process.env.GUMROAD_PRODUCT_MONTHLY;
  if (!key) {
    console.error('usage: qflush license:activate <key> [product_id]');
    return 1;
  }
  try {
    const res = await license.activateLicense(key, product);
    if (res.ok) {
      console.log('License activated:', res.license);
      return 0;
    }
    console.error('Activation failed:', res.error);
    return 2;
  } catch (e) {
    console.error('Activation error:', e);
    return 3;
  }
}

