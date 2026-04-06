// AOL 2 — Mémoire d'état court (tentatives, erreurs, historique)

// Pour l'instant, simple stockage en mémoire process
let memory = {};

function loadMemory(key = 'default') {
  return memory[key] || null;
}

function saveMemory(key = 'default', state) {
  memory[key] = state;
}

module.exports = { loadMemory, saveMemory };
