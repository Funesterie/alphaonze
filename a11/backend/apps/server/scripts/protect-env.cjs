"use strict";
/**
 * PROTECT-ENV — Chiffre un fichier .env avec AES-256-GCM
 *
 * Usage:
 *   node scripts/protect-env.cjs <env-file> <password>
 *
 * Le fichier chiffré remplace l'original (.env → .env.enc).
 * L'original est conservé comme .env.bak pour verification.
 *
 * Format chiffré:
 *   magic    4 bytes   "ENV1"
 *   version  1 byte    1
 *   salt    16 bytes   sel aleatoire (PBKDF2)
 *   iv      12 bytes   nonce GCM
 *   tag     16 bytes   tag d'authentification GCM
 *   data     variable  texte chiffre
 *
 * Le mot de passe n'est jamais stocke. Il est passe en variable
 * d'environnement ENV_MASTER_PASSWORD au demarrage du conteneur.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAGIC = Buffer.from("ENV1", "ascii");
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const PBKDF2_ITERATIONS = 100000;
const KEY_LEN = 32;

function encryptEnv(filePath, password) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const plaintext = fs.readFileSync(filePath, "utf8");

  // Derive key from password
  const salt = crypto.randomBytes(SALT_LEN);
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
  const iv = crypto.randomBytes(IV_LEN);

  // Encrypt with AES-256-GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Build the encrypted file
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, tag]);
  const output = Buffer.concat([header, encrypted]);

  // Write .env.enc
  const encPath = filePath + ".enc";
  fs.writeFileSync(encPath, output);

  // Backup original
  const bakPath = filePath + ".bak";
  if (!fs.existsSync(bakPath)) {
    fs.copyFileSync(filePath, bakPath);
  }

  const stats = fs.statSync(filePath);
  const encStats = fs.statSync(encPath);
  console.log(`Encrypted: ${filePath} (${stats.length} bytes) -> ${encPath} (${encStats.length} bytes)`);
  console.log(`Backup: ${bakPath}`);
  console.log(`\nTo decrypt at startup:`);
  console.log(`  ENV_MASTER_PASSWORD=<password> node scripts/reveal-env.cjs ${encPath} ${filePath}`);

  return { encPath, bakPath, originalSize: stats.length, encryptedSize: encStats.length };
}

// CLI
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: node scripts/protect-env.cjs <env-file> <password>");
  console.error("  or: ENV_MASTER_PASSWORD=<password> node scripts/protect-env.cjs <env-file>");
  process.exit(1);
}

const filePath = args[0];
const password = args[1] || process.env.ENV_MASTER_PASSWORD;

try {
  encryptEnv(filePath, password);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
