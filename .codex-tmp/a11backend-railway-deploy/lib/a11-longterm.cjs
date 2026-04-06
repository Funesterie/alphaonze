const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

// Même root que le sandbox/historique
const DATA_ROOT = process.env.A11_DATA_ROOT || "D:\\A12";
const KV_PATH = path.join(DATA_ROOT, "a11_memory", "kv-store.json");

async function loadKv() {
  try {
    const raw = await fsp.readFile(KV_PATH, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}

/**
 * Raccourci pratique pour lire une clé simple (value string)
 */
async function getKvValue(key, fallback = null) {
  const kv = await loadKv();
  const entry = kv[key];
  if (!entry) return fallback;
  if (typeof entry === "string") return entry;
  return entry.value ?? fallback;
}

/**
 * Construit le bloc de contexte mémoire à injecter au LLM.
 * C'est ici qu'on décide ce que le modèle voit à chaque conversation.
 */
async function buildLongTermMemorySnippet() {
  const kv = await loadKv();

  const userName = await getKvValue("user.name", "funeste38");
  const userLang = await getKvValue("user.lang", "fr-FR");

  const wsCode = await getKvValue("a11.workspace.code", "D:/A11");
  const wsData = await getKvValue("a11.workspace.data", "D:/A12");

  const persona = await getKvValue(
    "a11.persona.core",
    "Tu es A-11, l’assistant local NOSSEN de Funesterie, orienté dev, code, QFlush, Cerbère et VSIX."
  );

  // Tu peux ajouter ce que tu veux ici (flags, préférences TTS, etc.)
  const devFlags = await getKvValue("a11.dev.flags", null);

  let lines = [];

  lines.push("[A11 LONG-TERM MEMORY]");
  lines.push("");
  lines.push(`- User name: ${userName}`);
  lines.push(`- Preferred language: ${userLang}`);
  lines.push(`- Code workspace: ${wsCode}`);
  lines.push(`- Data workspace: ${wsData}`);
  lines.push("");
  lines.push(`Persona: ${persona}`);

  if (devFlags) {
    lines.push("");
    lines.push(`Dev flags: ${devFlags}`);
  }

  lines.push("");
  lines.push(
    "Règle: respecte ces infos comme vérité persistante à long terme. Ne redemande pas ces éléments si tu les connais déjà via cette mémoire."
  );

  return lines.join("\n");
}

module.exports = {
  loadKv,
  getKvValue,
  buildLongTermMemorySnippet,
};
