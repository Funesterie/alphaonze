'use strict';

/**
 * Freeland Bros Pulsar — Module de publication avec contrat
 * 
 * Systeme de publication automatique avec contrat a signer.
 * Chaque publication cree un contrat lie au sel relationnel (PKCS#1 RSA).
 * Le contrat est signe avec la cle privee et verifie avec la cle publique.
 */

const crypto = require('./pulsar-crypto.cjs');
const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PULSAR_COLORS = [
  { name: 'PurpleShadow', hex: '0x4a0a8a', hue: 270, function: 'sel relationnel',         complement: null,       gamma: 0.15 },
  { name: 'DeepBlue',      hex: '0x0a4a8a', hue: 210, function: 'chiffrement RSA',        complement: null,    gamma: 0.30 },
  { name: 'BloodRed',      hex: '0x8a0a0a', hue: 0,   function: 'compression HEVC',       complement: null,  gamma: 0.75 },
  { name: 'ToxicGreen',    hex: '0x0a8a4a', hue: 150, function: 'energie NVENC',          complement: 'Magenta',      gamma: 0.95 },
  { name: 'FireOrange',    hex: '0x8a4a0a', hue: 30,  function: 'chaleur du flux',        complement: 'Violet',       gamma: 0.80 },
  { name: 'Cyan',         hex: '0x0a8a8a', hue: 180, function: 'transmission',           complement: 'BloodRed',    gamma: 0.70 },
  { name: 'Magenta',      hex: '0x8a0a8a', hue: 300, function: 'matiere (pas rouge)',    complement: 'ToxicGreen',   gamma: 0.60 },
  { name: 'DORE',         hex: '0x8a8a0a', hue: 60,  function: 'blindage alchimique',   complement: null, gamma: 0.88 },
  { name: 'Violet',       hex: '0x4a0a4a', hue: 300, function: 'signal',                 complement: 'FireOrange',   gamma: 0.40 },
  { name: 'Indigo',       hex: '0x0a0a4a', hue: 240, function: 'le profond',             complement: 'DORE',         gamma: 0.35 },
];

function createContract({ persona, content, contentType, youtubeId, triplets = [] }) {
  const salt = crypto.generateRelationalSalt(triplets);
  
  const contractData = {
    version: 'freeland-bros-pulsar-v1',
    persona,
    contentType,
    youtubeId,
    content: content.substring(0, 500),
    timestamp: new Date().toISOString(),
    colors: PULSAR_COLORS.map(c => c.name),
    saltHash: salt ? crypto.hash(salt) : null,
  };
  
  const contractString = JSON.stringify(contractData);
  const signature = crypto.sign(contractString, { salt });
  
  return {
    contract: contractData,
    signature,
    verify: () => crypto.verify(contractString, signature, { salt }),
  };
}

function verifyContract(contract, signature, triplets = []) {
  const salt = crypto.generateRelationalSalt(triplets);
  const contractString = JSON.stringify(contract);
  return crypto.verify(contractString, signature, { salt });
}

module.exports = {
  PULSAR_COLORS,
  createContract,
  verifyContract,
};

