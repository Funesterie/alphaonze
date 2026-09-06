#!/usr/bin/env node
'use strict';

/**
 * Repointe le MCP local (a11mcp/.env) vers le graphe Neo4j de PRODUCTION.
 *
 * POURQUOI CE SCRIPT EXISTE
 * a11mcp/.env visait `neo4j+s://aa4680d2.databases.neo4j.io` — une instance Aura
 * gratuite, vide, et qui ne resout meme plus en DNS. Les outils graphe du MCP
 * interrogeaient donc le neant : constate le 2026-08-11. Le vrai graphe (8 056
 * noeuds, 22 305 relations) vit dans le conteneur `a11-neo4j` sur l'EX44.
 *
 * POURQUOI UN TUNNEL
 * Le bolt de production n'ecoute que sur 127.0.0.1 cote serveur, et c'est une
 * bonne chose : une base de donnees exposee sur Internet est une base de donnees
 * perdue. On passe donc par un tunnel SSH. Port local 17687, deja la convention
 * du projet (A11_LOCAL_NEO4J_URI dans .env.local), et qui n'entre pas en conflit
 * avec le conteneur `neo4j-nossen` local qui occupe 7687.
 *
 * POURQUOI TU LANCES CA TOI-MEME
 * Ce script lit le mot de passe de la base de production et l'ecrit sur ton
 * disque. C'est un transfert de secret : il doit etre un geste deliberé, pas un
 * effet de bord d'une conversation. Le mot de passe n'est jamais affiche, seule
 * son empreinte tronquee l'est, pour que tu puisses verifier sans le lire.
 *
 * USAGE
 *   node scripts/point-mcp-to-prod-neo4j.cjs
 *   node scripts/point-mcp-to-prod-neo4j.cjs --dry-run   (montre sans ecrire)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const CLE = process.env.A11_HETZNER_SSH_KEY
  || 'C:/Users/cella/.ssh/codex-a11-hetzner-20260627_ed25519';
const HOTE = process.env.A11_HETZNER_REMOTE || 'deploy@37.27.63.109';
const ENV_MCP = path.join(__dirname, '..', 'a11mcp', '.env');
const PORT_LOCAL = 17687;
const SEC = process.argv.includes('--dry-run');

function empreinte(v) {
  return crypto.createHash('sha256').update(v).digest('hex').slice(0, 12);
}

/** Pose ou remplace une cle, sans toucher au reste du fichier. */
function poser(texte, cle, valeur) {
  const motif = new RegExp('^' + cle + '=.*$', 'm');
  if (motif.test(texte)) return texte.replace(motif, cle + '=' + valeur);
  return texte.replace(/\n*$/, '\n') + cle + '=' + valeur + '\n';
}

function main() {
  if (!fs.existsSync(ENV_MCP)) {
    console.error(`ARRET : ${ENV_MCP} introuvable.`);
    process.exitCode = 1;
    return;
  }

  console.log('Lecture du mot de passe Neo4j depuis la production...');
  let motDePasse;
  try {
    motDePasse = execFileSync('ssh', [
      '-i', CLE,
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=25',
      HOTE,
      // On ne lit QUE la partie mot de passe de NEO4J_AUTH (format user/password).
      'docker exec a11-neo4j bash -lc \'printf %s "${NEO4J_AUTH#*/}"\'',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  } catch (error) {
    console.error('ARRET : lecture impossible. Le port 22 est-il joignable ?');
    console.error(String(error && error.message).slice(0, 200));
    process.exitCode = 1;
    return;
  }

  // Un mot de passe trop court est presque toujours une variable vide ou un
  // message d'erreur capture par megarde. On refuse d'ecrire plutot que de
  // casser une configuration qui marchait.
  if (motDePasse.length < 8) {
    console.error(`ARRET : mot de passe inattendu (${motDePasse.length} caracteres). Rien ecrit.`);
    process.exitCode = 1;
    return;
  }
  console.log(`  recupere : ${motDePasse.length} caracteres, empreinte ${empreinte(motDePasse)}`);

  let texte = fs.readFileSync(ENV_MCP, 'utf8');
  texte = poser(texte, 'NEO4J_URI', `neo4j://127.0.0.1:${PORT_LOCAL}`);
  texte = poser(texte, 'NEO4J_USER', 'neo4j');
  texte = poser(texte, 'NEO4J_PASSWORD', motDePasse);
  texte = poser(texte, 'NEO4J_DATABASE', 'neo4j');

  if (SEC) {
    console.log('\n--dry-run : rien ecrit. Le fichier recevrait :');
    console.log(`  NEO4J_URI=neo4j://127.0.0.1:${PORT_LOCAL}`);
    console.log('  NEO4J_USER=neo4j');
    console.log(`  NEO4J_PASSWORD=<${motDePasse.length} caracteres>`);
    console.log('  NEO4J_DATABASE=neo4j');
    return;
  }

  const sauvegarde = ENV_MCP + '.bak-neo4j';
  fs.copyFileSync(ENV_MCP, sauvegarde);
  fs.writeFileSync(ENV_MCP, texte, 'utf8');

  console.log(`\nEcrit. Sauvegarde : ${path.basename(sauvegarde)}`);
  console.log('\nOuvre le tunnel dans un AUTRE terminal, et laisse-le ouvert :');
  console.log(`  ssh -i "${CLE}" -o IdentitiesOnly=yes -N -L ${PORT_LOCAL}:127.0.0.1:7687 ${HOTE}`);
  console.log('\nPuis relance le client MCP. Sans le tunnel, les outils graphe');
  console.log('echoueront a se connecter — ce qui est plus honnete que de repondre');
  console.log('zero resultat depuis une instance morte, comme avant.');
}

main();
