'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const outDir = '/app/runtime';

// Generate RSA key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

fs.writeFileSync(path.join(outDir, 'unity-oidc-private.pem'), privateKey);
fs.writeFileSync(path.join(outDir, 'unity-oidc-public.pem'), publicKey);

// Export as JWK
const pubKeyObj = crypto.createPublicKey(publicKey);
const jwk = pubKeyObj.export({ format: 'jwk' });
jwk.kid = 'funesterie-unity-1';
jwk.use = 'sig';
jwk.alg = 'RS256';

const jwks = { keys: [jwk] };
fs.writeFileSync(path.join(outDir, 'unity-jwks.json'), JSON.stringify(jwks, null, 2));

console.log('KEYS_GENERATED');
console.log(JSON.stringify(jwks));
