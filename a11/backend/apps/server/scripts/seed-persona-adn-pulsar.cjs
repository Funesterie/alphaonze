"use strict";

// Seed idempotent du graphe Neo4j Funesterie: personas ADN + couleurs Pulsar.
// Reutilise prompt-adn.cjs (PERSONA_GENOMES) et freeland-bros-pulsar.cjs (PULSAR_COLORS).
// MERGE uniquement: rejouable sans dupliquer.

const fsSync = require("node:fs");
const path = require("node:path");
const neo4j = require("neo4j-driver");

function loadEnv(filePath) {
  try {
    const content = fsSync.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const value = match[2].trim();
      if (key && !Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = value;
      }
    }
  } catch (_) {}
}

loadEnv(path.resolve(__dirname, "..", ".env.local"));

const { PERSONA_GENOMES, listPersonas } = require("../src/persona/prompt-adn.cjs");
const { PULSAR_COLORS } = require("../src/persona/freeland-bros-pulsar.cjs");

const NEO4J_URI = process.env.NEO4J_URI || "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER || "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "nossen1234";

const PERSONA_META = {
  djeff: { role: "rappeur cypher", style: "rap", beat: "saccade", color: "BloodRed" },
  vivy: { role: "voix chanson", style: "ombre", beat: "fluide", color: "Cyan" },
  a11: { role: "architecte", style: "strategique", beat: "rapide", color: "DeepBlue" },
  k44: { role: "narrateur", style: "strategique", beat: "lent", color: "Indigo" },
  kiro: { role: "combattant", style: "ninja", beat: "rapide", color: "ToxicGreen" },
  zoro: { role: "mur encaisseur", style: "brutal", beat: "variable", color: "DORE" },
  NOSSEN: { role: "nexus orchestrateur", style: "pulsar", beat: "constante", color: "PurpleShadow" },
};

function genomeSummary(name) {
  const g = PERSONA_GENOMES[String(name).toLowerCase()] || PERSONA_GENOMES.djeff;
  const voix = g.voix || {};
  const lang = g.langage || {};
  const combat = g.combat || {};
  return {
    ton: voix.ton,
    rythme: voix.rythme,
    grain: voix.grain,
    registre: lang.registre,
    arme: combat.arme,
    activation: g.activation || "",
  };
}

async function main() {
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session();
  try {
    const colorNames = PULSAR_COLORS.map((c) => c.name);
    console.log("[seed-persona-pulsar] couleurs: " + colorNames.join(", "));

    for (const color of PULSAR_COLORS) {
      await session.run(
        "MERGE (c:PulsarColor {name: }) SET c.hex = , c.gamma = , c.function = , c.hue = ",
        { name: color.name, hex: color.hex, gamma: color.gamma, func: color.function, hue: color.hue }
      );
      if (color.complement) {
        await session.run(
          "MATCH (c:PulsarColor {name: }), (c2:PulsarColor {name: }) MERGE (c)-[:COMPLEMENTARY]->(c2)",
          { name: color.name, comp: color.complement }
        );
      }
    }
    console.log("[seed-persona-pulsar] couleurs Pulsar implantées: " + PULSAR_COLORS.length);

    const personaNames = Object.keys(PERSONA_META);
    for (const name of personaNames) {
      const meta = PERSONA_META[name];
      const summary = genomeSummary(name);
      await session.run(
        "MERGE (p:Persona {name: }) SET p.role = , p.style = , p.beat = , p.genome = ",
        { name: name, role: meta.role, style: meta.style, beat: meta.beat, genome: JSON.stringify(summary) }
      );
      const colorNode = PULSAR_COLORS.find((c) => c.name === meta.color);
      if (colorNode) {
        await session.run(
          "MATCH (p:Persona {name: }), (c:PulsarColor {name: }) MERGE (p)-[:CARRIES]->(c)",
          { name: name, color: meta.color }
        );
      }
    }
    console.log("[seed-persona-pulsar] personas implantés: " + personaNames.join(", "));

    await session.run(
      "MATCH (n:Persona {name: 'NOSSEN'}), (all:Persona) WHERE all.name <> 'NOSSEN' MERGE (n)-[:CONNECTS]->(all)"
    );
    console.log("[seed-persona-pulsar] nexus NOSSEN connecté à tous les personas.");

    const colorCount = await session.run("MATCH (c:PulsarColor) RETURN count(c) AS n");
    const personaCount = await session.run("MATCH (p:Persona) RETURN count(p) AS n");
    console.log("[seed-persona-pulsar] vérif -> personas: " + personaCount.records[0].get("n").toNumber() + ", couleurs: " + colorCount.records[0].get("n").toNumber());
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error("[seed-persona-pulsar] echec: " + (error && error.message ? error.message : error));
  process.exit(1);
});