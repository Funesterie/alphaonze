'use strict';
/**
 * refresh-mcp-token.cjs — Refrapper le jeton MCP de .mcp.json.
 *
 * LE PROBLEME QU'IL RESOUT
 *
 * L'entree « funesterie » de .mcp.json porte un Bearer ecrit en dur. Ce jeton
 * vit 60 minutes (OAUTH_ACCESS_TOKEN_TTL_SECONDS cote serveur). Passe ce delai,
 * tous les outils MCP distants repondent 401 — ce qui ressemble a un connecteur
 * capricieux, et n'est qu'un jeton mort. Verifie le 2026-08-15 : le jeton en
 * place avait ete emis a 15:42 et expirait a 16:42.
 *
 * Le script demande un jeton neuf en client_credentials — sans navigateur, donc
 * utilisable depuis une tache planifiee — et reecrit le fichier.
 *
 * CE QU'IL NE FAIT PAS
 *
 * Il n'affiche jamais le secret ni le jeton, meme tronque : ce fichier tourne en
 * boucle et sa sortie finit dans des journaux. Il n'ecrit que dans .mcp.json,
 * qui est deja dans .gitignore (ligne 117) — verifie avant d'ecrire, parce qu'un
 * jour quelqu'un retirera cette ligne sans y penser.
 *
 *   node scripts/refresh-mcp-token.cjs             refrappe si expire sous 15 min
 *   node scripts/refresh-mcp-token.cjs --force     refrappe dans tous les cas
 *   node scripts/refresh-mcp-token.cjs --dry-run   dit ce qu il ferait
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RACINE = path.resolve(__dirname, '..');
const MCP_JSON = path.join(RACINE, '.mcp.json');
const ENV_FILE = path.join(RACINE, 'a11mcp', '.env');
const ENTREE = 'funesterie';

/** Marge avant expiration. Un jeton valide 3 minutes ne survit pas a une session. */
const MARGE_SECONDES = 15 * 60;

function lireEnv(fichier) {
  const valeurs = {};
  if (!fs.existsSync(fichier)) return valeurs;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    valeurs[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return valeurs;
}

/** Expiration du jeton en place, sans verifier la signature : on lit, on ne valide pas. */
function expirationActuelle(config) {
  const entete = config?.mcpServers?.[ENTREE]?.headers?.Authorization || '';
  const jeton = entete.replace(/^Bearer\s+/i, '').trim();
  const parts = jeton.split('.');
  if (parts.length !== 3) return 0;
  try {
    return Number(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).exp) || 0;
  } catch {
    return 0;
  }
}

function verifierIgnoreParGit() {
  try {
    execFileSync('git', ['check-ignore', '-q', '.mcp.json'], { cwd: RACINE, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function demanderJeton(env) {
  const issuer = String(env.OAUTH_ISSUER || '').replace(/\/$/, '');
  const corps = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.OAUTH_CLIENT_ID || '',
    client_secret: env.OAUTH_CLIENT_SECRET || '',
    scope: env.OAUTH_DEFAULT_SCOPES || 'mcp:read mcp:write',
    // client_credentials est restreint a une ressource admin ou operateur cote
    // serveur (oauth.ts) : sans `resource`, la demande est refusee en
    // invalid_target, pas en mauvais identifiants — un message qui envoie
    // chercher le probleme au mauvais endroit.
    resource: `${env.OAUTH_RESOURCE || issuer}/admin/mcp`,
  });

  const reponse = await fetch(`${issuer}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corps,
    signal: AbortSignal.timeout(30000),
  });
  const payload = await reponse.json().catch(() => ({}));
  if (!reponse.ok || !payload?.access_token) {
    // On rapporte le code d'erreur OAuth, jamais le corps complet : il peut
    // contenir l'identifiant client et la ressource demandee.
    throw new Error(`${reponse.status} ${payload?.error || 'reponse sans access_token'}`);
  }
  return String(payload.access_token);
}

async function main() {
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(MCP_JSON)) {
    console.error(`Introuvable : ${MCP_JSON}`);
    process.exitCode = 1;
    return;
  }
  if (!verifierIgnoreParGit()) {
    console.error('.mcp.json n est plus ignore par git : refus d y ecrire un jeton.');
    console.error('Remettre .mcp.json dans .gitignore avant de relancer.');
    process.exitCode = 1;
    return;
  }

  const config = JSON.parse(fs.readFileSync(MCP_JSON, 'utf8'));
  if (!config?.mcpServers?.[ENTREE]) {
    console.error(`Aucune entree « ${ENTREE} » dans .mcp.json.`);
    process.exitCode = 1;
    return;
  }

  const maintenant = Math.floor(Date.now() / 1000);
  const exp = expirationActuelle(config);
  const restant = exp ? exp - maintenant : 0;

  if (!force && restant > MARGE_SECONDES) {
    console.log(`Jeton encore valide ${Math.round(restant / 60)} min. Rien a faire.`);
    return;
  }
  console.log(exp
    ? `Jeton ${restant > 0 ? `expire dans ${Math.round(restant / 60)} min` : `expire depuis ${Math.round(-restant / 60)} min`}.`
    : 'Aucun jeton lisible en place.');

  const env = lireEnv(ENV_FILE);
  if (!env.OAUTH_CLIENT_ID || !env.OAUTH_CLIENT_SECRET || !env.OAUTH_ISSUER) {
    console.error(`OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET / OAUTH_ISSUER manquants dans ${ENV_FILE}.`);
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(`--dry-run : demanderait un jeton a ${env.OAUTH_ISSUER}/oauth/token`);
    return;
  }

  const jeton = await demanderJeton(env);
  config.mcpServers[ENTREE].headers = {
    ...(config.mcpServers[ENTREE].headers || {}),
    Authorization: `Bearer ${jeton}`,
  };

  // Ecriture atomique : une coupure au milieu laisserait un .mcp.json tronque,
  // et plus aucun serveur MCP ne demarrerait — y compris ceux qui allaient bien.
  const tmp = `${MCP_JSON}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, MCP_JSON);

  const nouvelExp = expirationActuelle(config);
  console.log(`Jeton refrappe. Valide ${Math.round((nouvelExp - maintenant) / 60)} min.`);
  console.log('Reconnecter le serveur MCP pour qu il reparte avec (redemarrage de Claude Code).');
}

main().catch((error) => {
  console.error('Echec :', String(error?.message || error).slice(0, 200));
  process.exitCode = 1;
});
