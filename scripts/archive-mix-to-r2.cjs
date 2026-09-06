#!/usr/bin/env node
'use strict';

/**
 * Archive un mix audio du volume runtime vers R2, pour qu'il survive au TTL.
 *
 * POURQUOI CE SCRIPT EXISTE
 * Les sorties de `double-harmonic` vivent dans
 * `<runtime>/double-harmonic-d40/` et sont supprimees par `pruneIndex()` passe
 * `A11_DH_ASSET_TTL_MS` — non defini en production, donc **7 jours** par defaut
 * (`DEFAULT_TTL_MS`, src/routes/double-harmonic.cjs). Un mix qu'on veut publier
 * sur YouTube ne peut pas vivre sur un stockage qui s'auto-vide : il lui faut
 * une URL durable, qui est aussi ce qu'un envoi YouTube devra fournir.
 *
 * Constate le 2026-08-11 : 99 fichiers, 769 Mo, et tout ce qui depassait 7 jours
 * avait deja disparu.
 *
 * OU CE SCRIPT DOIT TOURNER
 * DANS le conteneur backend (`docker exec`), jamais sur l'hote : les
 * identifiants R2 vivent dans l'environnement du conteneur, et
 * `lib/file-storage.cjs` les lit depuis `process.env`. Faire sortir le fichier
 * du serveur pour le renvoyer ensuite ferait deux traversees reseau inutiles.
 *
 * CE QU'IL NE FAIT PAS
 * Il ne supprime rien. L'original reste soumis a son TTL et disparaitra tout
 * seul ; la copie R2, elle, n'expire pas. Un script d'archivage qui supprime sa
 * source transforme une panne d'envoi en perte de donnees.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { uploadBufferToR2, getDefaultFileStorage } = require('/app/lib/file-storage.cjs');

const PREFIXE = process.env.ARCHIVE_R2_PREFIX || 'archive/mix';

function usage(message) {
  if (message) console.error(`erreur: ${message}`);
  console.error('');
  console.error('usage: node archive-mix-to-r2.cjs <fichier|nom> [--as <nom-public>]');
  console.error('       node archive-mix-to-r2.cjs --list');
  console.error('');
  console.error("  Un nom sans dossier est cherche dans <runtime>/double-harmonic-d40/.");
  console.error('  --as    nom de destination sur R2. A UTILISER sur un bucket public:');
  console.error("          le nom d'origine porte l'identifiant de job, l'horodatage et un");
  console.error("          extrait des paroles — donc l'URL publique les divulguerait.");
  console.error('  --list  montre les sorties disponibles, les plus recentes en premier.');
  process.exit(message ? 2 : 0);
}

/**
 * Nettoie un nom de destination.
 *
 * Sur un bucket public l'URL est la seule chose qu'on donne : elle ne doit rien
 * dire de plus que necessaire. Pas d'espaces (donc pas de %20 dans le lien), pas
 * de caracteres a echapper, et l'extension d'origine est conservee pour que le
 * type de fichier reste lisible.
 */
function nomPublic(souhaite, source) {
  const ext = path.extname(source).toLowerCase();
  const base = String(souhaite || '')
    .trim()
    .replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '')
    .normalize('NFD')
    // NFD a separe « é » en « e » + accent combinant ; on retire tout le non-ASCII,
    // donc l'accent. Sans cette ligne, le filtre suivant transformerait l'accent en
    // tiret et « été » donnerait « e-t-e ». Ecrit en \x, sans caractere invisible
    // dans la source : une plage de combinants litterale se fait effacer par un
    // editeur sans qu'on le voie.
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  if (!base) {
    const error = new Error('nom public vide apres nettoyage');
    error.code = 'nom_public_vide';
    throw error;
  }
  return `${base}${ext}`;
}

function racineActifs() {
  // Meme resolution que la route : le runtime canonique, pas le repertoire de release.
  const { getCanonicalRuntimeRoot } = require('/app/lib/runtime-root.cjs');
  return path.join(path.resolve(getCanonicalRuntimeRoot(process.env)), 'double-harmonic-d40');
}

function lister(racine) {
  if (!fs.existsSync(racine)) {
    console.error(`repertoire absent: ${racine}`);
    process.exit(1);
  }
  const entrees = fs
    .readdirSync(racine)
    .filter((n) => /\.(mp3|wav|flac|m4a|ogg)$/i.test(n))
    .map((n) => {
      const p = path.join(racine, n);
      const st = fs.statSync(p);
      return { nom: n, mtime: st.mtimeMs, taille: st.size };
    })
    .sort((a, b) => b.mtime - a.mtime);

  console.log(`${entrees.length} sortie(s) audio dans ${racine}`);
  const maintenant = Date.now();
  const ttlMs = Math.max(60_000, Number(process.env.A11_DH_ASSET_TTL_MS) || 7 * 24 * 60 * 60 * 1000);
  for (const e of entrees) {
    // L'age sert d'estimation de survie : la purge se fonde sur createdAt de
    // l'index, pas sur mtime, donc c'est un ordre de grandeur, pas une garantie.
    const joursRestants = Math.floor((ttlMs - (maintenant - e.mtime)) / 86_400_000);
    const survie = joursRestants > 0 ? `~${joursRestants}j` : 'EXPIRE';
    console.log(
      `  ${new Date(e.mtime).toISOString().slice(0, 16).replace('T', ' ')}  ` +
        `${String((e.taille / 1048576).toFixed(1)).padStart(6)} Mo  ${survie.padStart(7)}  ${e.nom}`
    );
  }
}

function typeMime(nom) {
  const ext = path.extname(nom).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) usage();

  const racine = racineActifs();
  if (args.includes('--list')) return lister(racine);

  const stockage = getDefaultFileStorage();
  if (!stockage.isConfigured()) {
    // Echouer ici plutot qu'apres avoir lu les fichiers : rien n'a ete tente,
    // donc rien a defaire.
    console.error('R2 non configure dans cet environnement (R2_ENDPOINT / cles / R2_BUCKET).');
    console.error("Ce script doit tourner DANS le conteneur backend, pas sur l'hote.");
    process.exit(1);
  }

  // `--as` s'applique a un seul fichier : renommer plusieurs sources vers une
  // meme cle les ferait s'ecraser l'une l'autre en silence.
  const iAs = args.indexOf('--as');
  const renommage = iAs >= 0 ? args[iAs + 1] : '';
  const sources = args.filter((a, i) => a !== '--as' && i !== iAs + 1);
  if (iAs >= 0 && !renommage) usage('--as attend un nom');
  if (renommage && sources.length > 1) usage('--as ne vaut que pour un seul fichier');
  if (!sources.length) usage('aucun fichier indique');

  let echecs = 0;
  for (const arg of sources) {
    const chemin = arg.includes('/') ? path.resolve(arg) : path.join(racine, arg);
    if (!fs.existsSync(chemin)) {
      console.error(`ABSENT  ${arg}`);
      echecs += 1;
      continue;
    }

    const nomSource = path.basename(chemin);
    const nomCible = renommage ? nomPublic(renommage, nomSource) : nomSource;
    const buffer = fs.readFileSync(chemin);
    // L'empreinte est journalisee pour pouvoir prouver plus tard que l'objet R2
    // est bien le fichier archive, et non une regeneration.
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    // Cle stable et lisible : pas d'horodatage, pour qu'un re-archivage du meme
    // fichier ecrase sa propre copie au lieu d'en accumuler des variantes.
    const cle = `${PREFIXE}/${nomCible}`;

    try {
      const res = await uploadBufferToR2({
        filename: nomCible,
        buffer,
        contentType: typeMime(nomCible),
        storageKey: cle,
      });
      console.log(`OK      ${nomCible}`);
      console.log(`        ${(buffer.length / 1048576).toFixed(1)} Mo  sha256=${sha.slice(0, 16)}…`);
      console.log(`        url: ${res.url || '(pas de base publique configuree — objet prive)'}`);
    } catch (error) {
      console.error(`ECHEC   ${nomCible}: ${String(error?.message || error).slice(0, 200)}`);
      echecs += 1;
    }
  }

  if (echecs) process.exit(1);
}

main().catch((error) => {
  console.error(`erreur fatale: ${String(error?.message || error)}`);
  process.exit(1);
});
