'use strict';
/**
 * Kiro Fighter — Bot asynchrone Bloody Roar Extreme
 * Lit br-state, envoie des combos toutes les 3s, corrige selon la phase.
 *
 * Usage: node scripts/kiro-fighter.cjs
 */

const fs = require('fs');
const path = require('path');

const BUS = 'C:\\Users\\Djeff\\OneDrive\\a11_memory\\agent-bus';
const CMD_FILE = path.join(BUS, 'br-commands.json');
const STATE_FILE = path.join(BUS, 'br-latest-state.json');
const ALT_STATE = 'C:\\Users\\Djeff\\OneDrive\\Kaen44 Retro\\Arcade Controller\\br-latest-state.json';
const INTERVAL = 3000;

const COMBOS_FIGHT = [
  'right,right',
  'a',
  'a,b',
  'right,a',
  'down,b',
  'a,a,b',
  'x',
  'right,a',
  'up,b',
  'right,right',
  'down,a',
  'a,b',
];

const COMBOS_MENU = ['a', 'a', 'start', 'a'];

let comboIndex = 0;
let menuIndex = 0;

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    if (fs.existsSync(ALT_STATE)) {
      return JSON.parse(fs.readFileSync(ALT_STATE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function sendCommand(keys) {
  const cmd = { from: 'kiro-fighter', keys, player: 1, at: new Date().toISOString() };
  fs.writeFileSync(CMD_FILE, JSON.stringify(cmd));
  console.log(`[${new Date().toLocaleTimeString()}] → ${keys}`);
}

function tick() {
  const state = readState();
  const phase = state?.phase || state?.state?.phase || 'unknown';
  const hint = state?.decisionHint || state?.state?.decisionHint || '';

  if (phase === 'fight' || phase === 'versus') {
    // Mode combat — envoyer combo
    const combo = COMBOS_FIGHT[comboIndex % COMBOS_FIGHT.length];
    sendCommand(combo);
    comboIndex++;
  } else if (phase === 'loading-or-fade' || phase === 'boot-or-logo') {
    // Menu/chargement — appuyer A ou Start
    if (hint === 'wait') {
      console.log(`[${new Date().toLocaleTimeString()}] ⏳ wait (loading)`);
    } else {
      const cmd = COMBOS_MENU[menuIndex % COMBOS_MENU.length];
      sendCommand(cmd);
      menuIndex++;
    }
  } else if (phase === 'launcher-open') {
    console.log(`[${new Date().toLocaleTimeString()}] 🎮 Launcher ouvert — lance le jeu dans RomStation`);
  } else {
    // Phase inconnue — tenter A
    sendCommand('a');
  }
}

console.log('');
console.log('🐺 KIRO FIGHTER — Bot asynchrone Bloody Roar');
console.log(`   Interval: ${INTERVAL}ms`);
console.log(`   State: ${STATE_FILE}`);
console.log(`   Commands: ${CMD_FILE}`);
console.log('');

// Lancer la boucle
setInterval(tick, INTERVAL);
tick(); // Premier tick immédiat
