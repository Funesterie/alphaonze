'use strict';
/**
 * creer-voix-personas.cjs — Fabriquer les voix manquantes, l'une apres l'autre.
 *
 * A LANCER DANS LE CONTENEUR BACKEND, pas depuis un poste :
 *
 *   c=$(docker ps --format '{{.Names}}' | grep -E '^a11-backend-(blue|green)$' | head -1)
 *   docker exec "$c" node /app/scripts/creer-voix-personas.cjs            # simulation
 *   docker exec "$c" node /app/scripts/creer-voix-personas.cjs --confirm  # depense
 *
 * Le catalogue, les echantillons et la cle Suno vivent dans le conteneur. Lance
 * de l'exterieur, le script ecrirait un catalogue local que personne ne lit.
 *
 * POURQUOI GENERER PLUTOT QUE CLONER
 *
 * voice-catalog.cjs impose `consentBy` : « Qui atteste que la personne autorise
 * l'usage de sa voix. Obligatoire. » Une voix prise en ligne casserait ce
 * garde-fou, violerait les conditions de Suno sur l'audio televerse, et
 * arriverait pendant la verification YouTube. Une voix GENEREE n'appartient a
 * personne d'autre : elle ne peut pas etre reclamee.
 *
 * LA RECETTE, ET CE QU'ELLE A COUTE D'APPRENDRE
 *
 *   1. POST /generate            un a cappella avec le timbre de la persona
 *   2. GET  /generate/record-info   attendre que le clip existe vraiment
 *   3. POST /generate/generate-persona   fabriquer l'identifiant
 *   4. telecharger le clip, le ranger comme echantillon
 *   5. inscrire au catalogue avec consentBy 'genere-funesterie'
 *
 * L'etape 4 n'est pas cosmetique : cet echantillon est l'ADN. Sans lui, le jour
 * ou Suno purge le clip source — ce qui arrive, la voix de Djeff est morte le
 * 30/07 — la persona est definitivement perdue et il faut tout refaire.
 *
 * La duree envoyee a generate-persona est celle du clip ENTIER. La fenetre de
 * 10-30 s qu'on trouve dans persona-recovery.cjs sert au `continueAt` d'une
 * reanimation, pas a une creation : un extrait de 20 s a ete refuse par Suno le
 * 15/08. Confondre les deux coute une generation a chaque essai.
 *
 * REPRISE
 *
 * Chaque voix reussie est inscrite au catalogue AVANT de passer a la suivante.
 * Relancer le script reprend donc ou il s'est arrete, sans repayer ce qui est
 * deja fait. C'est voulu : une serie de douze generations ne finit jamais du
 * premier coup.
 */

const fs = require('node:fs');
const path = require('node:path');

const SERVER = process.env.A11_SERVER_ROOT || '/app';
const pl = require(path.join(SERVER, 'src/music/persona-loudness.cjs'));
const studio = require(path.join(SERVER, 'src/routes/vivy-studio.cjs'));
const catalogue = require(path.join(SERVER, 'src/music/voice-catalog.cjs'));

const CONSENT = 'genere-funesterie';
const MODELE = 'V5';
// Suno met plusieurs minutes a rendre un clip. 60 sondages a 5 s = 5 minutes,
// au-dela c'est un echec et non une lenteur.
const SONDAGES_MAX = 60;
const SONDAGE_MS = 5000;
const TIMEOUT_MS = 60000;

/* Paroles neutres et courtes : on capture un TIMBRE, pas un morceau. Assez de
 * syllabes pour couvrir voyelles ouvertes, fermees et consonnes dures. */
const PAROLES = [
  '[Verse]',
  'Je pose ma voix sur la ligne, elle tient, elle ne tremble pas',
  'Chaque mot trouve sa place, chaque souffle garde son pas',
  '[Chorus]',
  'Je suis la, je reste la, la machine ecoute et retient',
  'Rien ne se perd, rien ne ment, le signal revient',
].join('\n');

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function lireCle() {
  for (const f of [process.env.VIVY_SUNO_API_KEY_FILE, process.env.SUNO_API_KEY_FILE,
    '/app/runtime/secrets/suno_api_key']) {
    try { if (f && fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim(); } catch { /* suivant */ }
  }
  return String(process.env.VIVY_SUNO_API_KEY || process.env.SUNO_API_KEY
    || process.env.SUNO_TOKEN || '').trim();
}

function baseUrl() {
  return String(process.env.VIVY_SUNO_BASE_URL || process.env.SUNO_BASE_URL
    || 'https://api.sunoapi.org/api/v1').trim().replace(/\/$/, '');
}

function construirePayload(entree) {
  /* Le descripteur vocal a le droit d'aller dans le style ICI, et nulle part
   * ailleurs : on CREE la voix, il n'y a pas encore de persona a ecraser. En
   * production c'est l'inverse — un descripteur dans le style ecrase la persona,
   * verifie le 15/08. */
  const style = [
    'a cappella, voix seule, aucun instrument, aucune batterie',
    'prise proche, studio sec, peu de reverbe',
    entree.voix.timbre,
    entree.voix.debit,
  ].join(', ');

  const payload = studio.buildVivySunoPayload({
    title: `Voix ${entree.persona}`,
    lyrics: PAROLES,
    prompt: PAROLES,
    style,
    preserveSelectedVoice: false,
  });

  const propres = pl.negativeTagsVoix(entree.persona);
  if (propres) {
    payload.negativeTags = [payload.negativeTags, propres].filter(Boolean).join(', ');
  }
  return payload;
}

async function lireJson(reponse) {
  const payload = await reponse.json().catch(() => ({}));
  const code = Number(payload?.code ?? reponse.status);
  return {
    ok: reponse.ok && (code === 200 || Number.isNaN(code)),
    code,
    message: String(payload?.msg || payload?.message || '').slice(0, 200),
    payload,
  };
}

/** Etapes 1 et 2 : generer, puis attendre que le clip existe pour de vrai. */
async function genererAcappella(entree, cle) {
  const entetes = { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' };
  const envoi = await fetch(`${baseUrl()}/generate`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify(construirePayload(entree)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const res = await lireJson(envoi);
  if (!res.ok) return { ok: false, etape: 'generate', detail: `${res.code} ${res.message}` };

  const taskId = String(res.payload?.data?.taskId || res.payload?.data?.task_id || '').trim();
  if (!taskId) return { ok: false, etape: 'generate', detail: 'aucun taskId' };

  for (let i = 0; i < SONDAGES_MAX; i += 1) {
    await dormir(SONDAGE_MS);
    const info = await fetch(`${baseUrl()}/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${cle}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const infoRes = await lireJson(info);
    const data = infoRes.payload?.data || {};
    const statut = String(data.status || data.state || '').toUpperCase();
    if (/FAILED|ERROR|SENSITIVE/.test(statut)) {
      /* SENSITIVE_WORD_ERROR sur une CREATION parle des paroles, pas d'une
       * persona morte : il n'y a pas encore de persona. Le message trompeur du
       * 03/08 ne s'applique pas ici. */
      return { ok: false, etape: 'clip', detail: statut };
    }
    const pistes = data?.response?.sunoData || data?.response?.data || data?.sunoData || [];
    const piste = Array.isArray(pistes) ? pistes.find((p) => p?.id || p?.audioId) : null;
    if (piste && /SUCCESS/.test(statut)) {
      return {
        ok: true,
        taskId,
        audioId: String(piste.id || piste.audioId || '').trim(),
        audioUrl: String(piste.audioUrl || piste.audio_url || piste.streamAudioUrl || '').trim(),
        duree: Math.round(Number(piste.duration || 0)) || 0,
      };
    }
  }
  return { ok: false, etape: 'clip', detail: 'delai depasse' };
}

/** Etape 3 : l'identifiant de persona, sur la duree du clip ENTIER. */
async function creerPersona(entree, clip, cle) {
  const reponse = await fetch(`${baseUrl()}/generate/generate-persona`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskId: clip.taskId,
      audioId: clip.audioId,
      name: entree.persona,
      description: `Voix ${entree.persona} de Funesterie, generee : ${entree.voix.timbre}.`,
      vocalStart: 0,
      vocalEnd: clip.duree || 120,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const res = await lireJson(reponse);
  const voiceId = catalogue.normalizeVoiceId(
    res.payload?.data?.personaId || res.payload?.data?.persona_id || ''
  );
  if (!res.ok || !voiceId) {
    return { ok: false, etape: 'persona', detail: `${res.code} ${res.message}` };
  }
  return { ok: true, voiceId };
}

/** Etape 4 : ranger l'ADN. Un echec ici n'annule pas la voix, il la fragilise. */
async function rangerEchantillon(nom, clip) {
  if (!clip.audioUrl) return { ok: false, detail: 'aucune URL audio' };
  try {
    const reponse = await fetch(clip.audioUrl, { signal: AbortSignal.timeout(120000) });
    if (!reponse.ok) return { ok: false, detail: `HTTP ${reponse.status}` };
    const buffer = Buffer.from(await reponse.arrayBuffer());
    catalogue.attachVoiceSample(nom, { buffer, durationSeconds: clip.duree });
    return { ok: true, octets: buffer.length };
  } catch (error) {
    return { ok: false, detail: String(error?.message || error).slice(0, 120) };
  }
}

async function fabriquerUneVoix(entree, cle) {
  const nom = entree.persona;
  process.stdout.write(`\n[${nom}] generation de l a cappella…\n`);
  const clip = await genererAcappella(entree, cle);
  if (!clip.ok) return { nom, ok: false, etape: clip.etape, detail: clip.detail };
  process.stdout.write(`[${nom}] clip pret (${clip.duree}s), creation de la persona…\n`);

  const persona = await creerPersona(entree, clip, cle);
  if (!persona.ok) return { nom, ok: false, etape: persona.etape, detail: persona.detail };

  /* On inscrit AVANT de telecharger l'echantillon : si le telechargement echoue,
   * l'identifiant est deja sauve. L'inverse perdrait une generation payee. */
  catalogue.upsertVoiceInCatalog({
    name: nom,
    label: nom,
    voiceId: persona.voiceId,
    gender: entree.voix.genre === 'neutre' ? '' : entree.voix.genre,
    consentBy: CONSENT,
    addedBy: 'creer-voix-personas.cjs',
    note: entree.voix.timbre.slice(0, 200),
  });

  const echantillon = await rangerEchantillon(nom, clip);
  return {
    nom, ok: true, voiceId: persona.voiceId,
    echantillon: echantillon.ok,
    echantillonDetail: echantillon.ok ? `${echantillon.octets} octets` : echantillon.detail,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const confirme = args.includes('--confirm');
  const i = args.indexOf('--persona');
  const seulement = i >= 0 ? String(args[i + 1] || '').toLowerCase() : '';

  let cibles = pl.voixDisponibles().filter((d) => !d.reelle && d.voix);
  if (seulement) cibles = cibles.filter((d) => d.persona === seulement);

  /* Reprise : une voix deja au catalogue avec un identifiant vivant est faite. */
  cibles = cibles.filter((d) => !catalogue.resolveCatalogVoiceId(d.persona));

  if (!cibles.length) {
    console.log('Aucune voix a creer : tout le casting a deja son identifiant.');
    return;
  }

  console.log(`${cibles.length} voix a creer, dans cet ordre :`);
  for (const c of cibles) {
    console.log(`  ${c.persona.padEnd(10)} ${String(c.voix.genre).padEnd(7)} ${c.voix.timbre.slice(0, 70)}`);
  }

  if (!confirme) {
    console.log('\nSimulation. Rien n a ete envoye, aucun credit depense.');
    console.log('Pour lancer reellement :  --confirm   (et --persona <nom> pour n en faire qu une)');
    return;
  }

  const cle = lireCle();
  if (!cle) {
    console.error('\nAucune cle Suno lisible. Attendu VIVY_SUNO_API_KEY, SUNO_API_KEY,');
    console.error('SUNO_TOKEN, ou le fichier /app/runtime/secrets/suno_api_key.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n--confirm : envoi reel. Une generation par voix, ${cibles.length} au total.`);
  const resultats = [];
  for (const cible of cibles) {
    /* Sequentiel et non parallele : Suno limite les generations simultanees, et
     * un echec en serie doit s'arreter sur une voix, pas sur douze. */
    const r = await fabriquerUneVoix(cible, cle);
    resultats.push(r);
    console.log(r.ok
      ? `[${r.nom}] OK — persona ${r.voiceId.slice(0, 4)}…, ADN ${r.echantillon ? 'range' : `MANQUANT (${r.echantillonDetail})`}`
      : `[${r.nom}] ECHEC a l etape ${r.etape} — ${r.detail}`);
  }

  const reussies = resultats.filter((r) => r.ok);
  console.log(`\n${reussies.length}/${resultats.length} voix creees.`);
  const sansAdn = reussies.filter((r) => !r.echantillon);
  if (sansAdn.length) {
    console.log(`ATTENTION : ${sansAdn.length} voix sans echantillon. Elles chantent aujourd hui,`);
    console.log('mais seront irrecuperables le jour ou Suno purgera leur clip source.');
    console.log(`Voix concernees : ${sansAdn.map((r) => r.nom).join(', ')}`);
  }
  const echouees = resultats.filter((r) => !r.ok);
  if (echouees.length) {
    console.log('Relancer le script reprendra uniquement les voix manquantes.');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Interruption :', error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = { construirePayload, PAROLES, CONSENT };
