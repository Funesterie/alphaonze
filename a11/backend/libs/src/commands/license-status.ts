// ROME-TAG: 0x9398B5

import license from '../utils/license.js';

export default async function runLicenseStatus() {
  const lic = license.readLicense();
  if (!lic) {
    console.log('No license found');
    return 0;
  }
  console.log(JSON.stringify(lic, null, 2));
  return 0;
}
