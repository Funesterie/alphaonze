"use strict";
/**
 * REVEAL-ENV — Déchiffre un fichier .env.enc vers un fichier .env
 *
 * Usage:
 *   ENV_MASTER_PASSWORD=<password> node scripts/reveal-env.cjs <env.enc> [output-path]
 *
 * Si aucun output-path n'est donné, ecrit vers stdout (pour shell eval).
 *
 * En conteneur Docker, l'entrypoint fait:
 *   node scripts/reveal-env.cjs /secrets/a11.env.enc /tmp/a11.env
 * puis le process charge /tmp/a11.env (qui est en tmpfs, jamais sur disque).
 *
 * Si le mot de passe est mauvais, le tag GCM echoue et le process s'arrete.
 * Si le fichier .enc n'existe pas, le process s'arporte (fail-fermé).
 */

const crypto = require("node:crypto");
const fs = require("node:fs");

const MAGIC = Buffer.from("ENV1", "ascii");
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 4 + 1 + SALT_LEN + IV_LEN + TAG_LEN; // = 49
const PBKDF2_ITERATIONS = 100000;
const KEY_LEN = 32;

function decryptEnv(encPath, password) {
  if (!fs.existsSync(encPath)) {
    throw new Error(`Encrypted file not found: ${encPath}`);
  }
  if (!password) {
    throw new Error("ENV_MASTER_PASSWORD is required");
  }

  const data = fs.readFileSync(encPath);

  // Parse header
  if (data.slice(0, 4).toString("ascii") !== MAGIC.toString("ascii")) {
    throw new Error("Invalid magic — not an encrypted env file");
  }
  const version = data[4];
  if (version !== VERSION) {
    throw new Error(`Unsupported version: ${version}`);
  }

  const salt = data.slice(5, 5 + SALT_LEN);
  const iv = data.slice(5 + SALT_LEN, 5 + SALT_LEN + IV_LEN);
  const tag = data.slice(5 + SALT_LEN + IV_LEN, 5 + SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = data.slice(HEADER_LEN);

  // Derive key from password + salt
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");

  // Decrypt with AES-256-GCM
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (e) {
    throw new Error("Decryption failed — wrong password or corrupted file");
  }

  return plaintext;
}

// CLI
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: ENV_MASTER_PASSWORD=<password> node scripts/reveal-env.cjs <env.enc> [output-path]");
  process.exit(1);
}

const encPath = args[0];
const outputPath = args[1];
const password = process.env.ENV_MASTER_PASSWORD;

try {
  const plaintext = decryptEnv(encPath, password);

  if (outputPath) {
    fs.writeFileSync(outputPath, plaintext, "utf8");
    console.log(`Decrypted: ${encPath} -> ${outputPath}`);
  } else {
    process.stdout.write(plaintext);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
