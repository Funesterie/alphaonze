'use strict';

/**
 * Sonde de capacite Microsoft Graph — que peut reellement faire l'application ?
 *
 * Djeff, 09/08/2026: « configure entra pour avoir le drive tout le temps co avec
 * vivy ». Avant de cabler un acces OneDrive persistant, il faut savoir ce que le
 * jeton APPLICATIF ouvre deja et ce qui manque. Les diagnostics de demarrage
 * (azure-startup-diagnostics.cjs) ne disent que la configuration; ils ne prouvent
 * pas qu'un appel aboutit.
 *
 * Pourquoi le mode application et pas la connexion utilisateur. « Tout le temps
 * connecte » exclut un flux delegue: un jeton de rafraichissement expire, se revoque
 * au changement de mot de passe, et demande une re-authentification humaine. Le
 * client_credentials n'a pas d'utilisateur, donc rien a re-authentifier. En echange
 * il perd /me: sans utilisateur, il n'y a pas de « moi ». L'acces au disque passe par
 * /users/{id}/drive ou /drives/{id}, et exige une permission d'application consentie
 * par un administrateur (Files.Read.All ou Files.ReadWrite.All).
 *
 * Cette sonde ne renvoie JAMAIS de jeton, ni de message d'erreur brut: seulement des
 * codes HTTP et des codes d'erreur Graph. Un message Graph peut contenir un
 * identifiant de locataire ou un nom d'utilisateur.
 */

const { getGraphToken, getAzureGraphConfig } = require('./azure-graph-client.cjs');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 10000;

// Chaque sonde nomme la permission d'application qu'elle exige, pour que le rapport
// dise quoi accorder plutot que « ca ne marche pas ».
const SONDES = [
  { cle: 'organisation', chemin: '/organization?$select=id', permission: 'aucune (jeton valide suffit)' },
  { cle: 'annuaire', chemin: '/users?$top=1&$select=id', permission: 'User.Read.All' },
  { cle: 'disques', chemin: '/drives?$top=1', permission: 'Files.Read.All' },
  { cle: 'sites', chemin: '/sites?search=&$top=1', permission: 'Sites.Read.All' },
];

async function appelerGraph(chemin, jeton) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => { try { controleur.abort(); } catch (_) {} }, TIMEOUT_MS);
  try {
    const reponse = await fetch(`${GRAPH_BASE}${chemin}`, {
      headers: { authorization: `Bearer ${jeton}`, accept: 'application/json' },
      signal: controleur.signal,
    });
    let codeErreur = '';
    let elements = null;
    try {
      const corps = await reponse.json();
      if (corps?.error?.code) codeErreur = String(corps.error.code).slice(0, 60);
      if (Array.isArray(corps?.value)) elements = corps.value.length;
    } catch (_) { /* corps non JSON: le statut suffit */ }
    return { statut: reponse.status, ok: reponse.ok, codeErreur, elements };
  } catch (error) {
    return {
      statut: 0,
      ok: false,
      codeErreur: error?.name === 'AbortError' ? 'timeout' : 'reseau',
      elements: null,
    };
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Sonde les capacites de l'application. Ne leve pas: un echec est un resultat.
 *
 * @returns {Promise<{jeton:boolean, motif?:string, capacites:Array, driveUtilisable:boolean}>}
 */
async function probeGraphCapabilities(env = process.env, { fetchToken = getGraphToken } = {}) {
  const config = getAzureGraphConfig(env);
  if (!config.tenantId || !config.clientId) {
    return { jeton: false, motif: 'azure_graph_not_configured', capacites: [], driveUtilisable: false };
  }

  let jeton = '';
  try {
    const resultat = await fetchToken(env);
    jeton = typeof resultat === 'string' ? resultat : String(resultat?.accessToken || '');
  } catch (error) {
    // On garde le code d'echec, jamais le detail: il peut nommer le locataire.
    return {
      jeton: false,
      motif: String(error?.message || 'echec_jeton').slice(0, 60),
      capacites: [],
      driveUtilisable: false,
    };
  }
  if (!jeton) {
    return { jeton: false, motif: 'jeton_vide', capacites: [], driveUtilisable: false };
  }

  const capacites = [];
  for (const sonde of SONDES) {
    const resultat = await appelerGraph(sonde.chemin, jeton);
    capacites.push({
      capacite: sonde.cle,
      accorde: resultat.ok,
      statut: resultat.statut,
      // 403 sur une permission d'application = consentement administrateur manquant.
      // C'est le cas le plus frequent et il se corrige dans le portail, pas dans le code.
      diagnostic: resultat.ok
        ? 'ok'
        : (resultat.statut === 403 ? `consentement admin manquant pour ${sonde.permission}` : (resultat.codeErreur || `statut_${resultat.statut}`)),
      permissionRequise: sonde.permission,
    });
  }

  const disques = capacites.find((c) => c.capacite === 'disques');
  return {
    jeton: true,
    capacites,
    driveUtilisable: Boolean(disques?.accorde),
  };
}

/** Rapport d'une ligne par capacite, sur la sortie standard. Aucun secret. */
function formatGraphCapabilities(rapport) {
  if (!rapport?.jeton) {
    return [`[graph-probe] pas de jeton applicatif: ${rapport?.motif || 'inconnu'}`];
  }
  const lignes = ['[graph-probe] jeton applicatif obtenu (client_credentials)'];
  for (const c of rapport.capacites) {
    lignes.push(`[graph-probe]   ${c.capacite.padEnd(13)} ${c.accorde ? 'OK ' : 'NON'} ${String(c.statut).padStart(3)}  ${c.diagnostic}`);
  }
  lignes.push(
    rapport.driveUtilisable
      ? '[graph-probe] le disque est joignable en mode application: Vivy peut rester connectee sans utilisateur.'
      : '[graph-probe] disque HORS de portee: accorder Files.Read.All (ou ReadWrite.All) en permission d application, puis consentement admin.'
  );
  return lignes;
}

/**
 * Liste les disques atteignables en mode application.
 *
 * Necessaire parce qu'un jeton applicatif n'a PAS de /me: il faut un identifiant
 * de disque explicite pour construire la moindre URL. C'est la donnee qui manque
 * au passeur, et l'oublier donne un 400 sur chaque appel.
 *
 * Ne renvoie que id / name / driveType / owner affichable — jamais d'adresse
 * courriel ni d'identifiant d'utilisateur.
 */
async function listGraphDrives(env = process.env, { fetchToken = getGraphToken } = {}) {
  let jeton = '';
  try {
    const resultat = await fetchToken(env);
    jeton = typeof resultat === 'string' ? resultat : String(resultat?.accessToken || '');
  } catch (error) {
    return { ok: false, error: String(error?.message || 'echec_jeton').slice(0, 60), drives: [] };
  }
  if (!jeton) return { ok: false, error: 'jeton_vide', drives: [] };

  const controleur = new AbortController();
  const minuteur = setTimeout(() => { try { controleur.abort(); } catch (_) {} }, TIMEOUT_MS);
  try {
    const reponse = await fetch(`${GRAPH_BASE}/drives?$select=id,name,driveType`, {
      headers: { authorization: `Bearer ${jeton}`, accept: 'application/json' },
      signal: controleur.signal,
    });
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      return { ok: false, error: String(corps?.error?.code || `statut_${reponse.status}`).slice(0, 60), drives: [] };
    }
    const drives = (Array.isArray(corps?.value) ? corps.value : []).map((d) => ({
      id: String(d?.id || ''),
      name: String(d?.name || '').slice(0, 80),
      driveType: String(d?.driveType || ''),
    })).filter((d) => d.id);
    return { ok: true, drives };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'timeout' : 'reseau', drives: [] };
  } finally {
    clearTimeout(minuteur);
  }
}

module.exports = { probeGraphCapabilities, formatGraphCapabilities, listGraphDrives, SONDES };
