'use strict';

/**
 * clip-acces.cjs — Qui peut voir quel clip (espace privé, 13/09/2026).
 *
 * Avant : `/api/mcp-bridge/clip/list` publiait les clips de tout le monde, et
 * `/clips/<fichier>` s'ouvrait pour n'importe quel compte connecté (le garde
 * Sharingan ne sépare que connecté / anonyme).
 *
 * Désormais un clip appartient à celui qui l'a lancé : son job porte userId,
 * email et le nom du fichier produit (`outputFilename`). Il est visible de son
 * auteur, des admins, et de tous s'il est dans la VITRINE -- la liste des clips
 * que l'admin choisit de montrer. Un clip sans job (lancé à la main par un
 * script) n'a pas d'auteur : seuls les admins le voient, sauf s'il est en vitrine.
 */

const fs = require('fs');
const path = require('path');
const { CLIPS_DIR } = require('./clip-storage.cjs');
const { listJobs, listPublicClips } = require('./clip-jobs.cjs');

// Dans le dossier des clips, partagé par toutes les couleurs : la vitrine
// survit aux déploiements.
const FICHIER_VITRINE = path.join(CLIPS_DIR, 'vitrine.json');

function nomPropre(filename) {
  const nom = path.basename(String(filename || ''));
  return /^[^/\\]+\.(mp4|webm|mkv)$/i.test(nom) && nom === String(filename || '') ? nom : '';
}

function lireVitrine() {
  try {
    const liste = JSON.parse(fs.readFileSync(FICHIER_VITRINE, 'utf8'));
    return new Set((Array.isArray(liste) ? liste : []).map(nomPropre).filter(Boolean));
  } catch (_) {
    return new Set();
  }
}

function publierDansVitrine(filename, publier = true) {
  const nom = nomPropre(filename);
  if (!nom) throw new Error('nom_de_clip_invalide');
  const vitrine = lireVitrine();
  if (publier) vitrine.add(nom);
  else vitrine.delete(nom);
  fs.mkdirSync(path.dirname(FICHIER_VITRINE), { recursive: true });
  const tmp = `${FICHIER_VITRINE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...vitrine].sort(), null, 2));
  fs.renameSync(tmp, FICHIER_VITRINE);
  return vitrine;
}

function tousLesJobs() {
  return listJobs({ limit: 100000, raw: true });
}

function jobDuClip(filename) {
  const nom = nomPropre(filename);
  if (!nom) return null;
  return tousLesJobs().find((job) => job.outputFilename === nom) || null;
}

function identite(user) {
  return {
    id: String((user && (user.id || user.sub)) || '').trim(),
    email: String((user && user.email) || '').trim().toLowerCase(),
  };
}

function estAuteur(job, user) {
  if (!job || !user) return false;
  const { id, email } = identite(user);
  return Boolean(
    (id && job.userId && String(job.userId) === id)
    || (email && job.email && String(job.email).toLowerCase() === email)
  );
}

function peutVoirClip({ filename, user = null, admin = false } = {}) {
  const nom = nomPropre(filename);
  if (!nom) return false;
  if (admin) return true;
  if (lireVitrine().has(nom)) return true;
  return estAuteur(jobDuClip(nom), user);
}

/** Les clips d'un compte, du plus récent au plus ancien. */
function clipsDuCompte(user) {
  const { id, email } = identite(user);
  if (!id && !email) return [];
  const vitrine = lireVitrine();
  return listJobs({ userId: id || undefined, email: email || undefined, limit: 200, raw: true })
    .filter((job) => job.outputFilename)
    .map((job) => ({
      name: String(job.title || job.outputFilename.replace(/\.[a-z0-9]+$/i, '')),
      filename: job.outputFilename,
      url: '/clips/' + encodeURIComponent(job.outputFilename),
      created: job.updatedAt || job.createdAt || null,
      partial: Boolean(job.partial),
      enVitrine: vitrine.has(job.outputFilename),
    }));
}

/** La vitrine pour tous ; tout, avec l'auteur, pour l'admin qui choisit. */
function clipsVisibles({ admin = false } = {}) {
  const vitrine = lireVitrine();
  const tous = listPublicClips();
  if (!admin) return tous.filter((clip) => vitrine.has(clip.filename)).map((clip) => ({ ...clip, enVitrine: true }));
  const auteurs = new Map(tousLesJobs()
    .filter((job) => job.outputFilename)
    .map((job) => [job.outputFilename, job.email || job.userId || null]));
  return tous.map((clip) => ({ ...clip, enVitrine: vitrine.has(clip.filename), auteur: auteurs.get(clip.filename) || null }));
}

module.exports = {
  FICHIER_VITRINE,
  clipsDuCompte,
  clipsVisibles,
  estAuteur,
  jobDuClip,
  lireVitrine,
  nomPropre,
  peutVoirClip,
  publierDansVitrine,
};
