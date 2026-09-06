#!/usr/bin/env node
'use strict';

/**
 * Index inverse par mot-cle sur l'export ChatGPT.
 *
 * Les 218 Mo de conversations ne peuvent pas entrer dans le graphe: on passerait de
 * 2 600 noeuds a plusieurs centaines de milliers, sur la seule memoire survivante du
 * projet. Un index inverse rend le corpus interrogeable sans le charger: on stocke les
 * mots-cles et des pointeurs, jamais le texte integral.
 *
 * Usage:
 *   node scripts/build-chatgpt-keyword-index.cjs [--source DIR] [--limit N]
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');

const DEFAULT_SOURCE = 'E:/Funesterie/corpus/chatgpt-export-2026-05-07/raw';
const MIN_TERM_LENGTH = 4;
// Garder les 30 mots les plus repetes de chaque passage effacait le vocabulaire du
// projet: "vivy" ne sortait que dans 7 passages et "harmonic" dans aucun, parce qu'un
// mot cite une ou deux fois ne monte jamais dans le top 30 d'un long message.
const MAX_TERMS_PER_PASSAGE = 110;
// Pas de plafond par terme: tronquer a 400 donnait a tous les mots frequents la meme
// frequence apparente, ce qui detruisait le classement par rarete, et ne gardait que
// les 400 premiers passages rencontres -- donc les plus vieilles conversations.
// Le cout est faible: 30 termes x 25 000 passages ~ 760 000 pointeurs.
const PASSAGE_PREVIEW = 400;
const MIN_PASSAGE_CHARS = 120;

// Mots vides francais et anglais: ils feraient exploser l'index sans rien apporter.
const STOP = new Set(`alors aussi autre avant avec avoir bien c'est cela celle celui cette
chaque comme comment dans depuis deux dire donc elle elles encore entre etait etre faire
fait faut fois font ici jamais leur leurs mais meme mes moins nous parce pareil pas peu
peut plus pour pourquoi quand que quel quelle qui quoi sans sera ses seulement sont sous
suis sur tous tout toute toutes tres trop une vers vous etes ont est les des aux ils elle
about after again against all also and any are because been before being between both but
can come could does doing down during each few for from further had has have here how into
its itself just more most not now only other our out over own same she should some such
than that the their them then there these they this those through too under until very was
were what when where which while who why will with would you your`.split(/\s+/).filter(Boolean));

function parseArgs(argv) {
  const out = { source: DEFAULT_SOURCE, limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') out.source = String(argv[++i] || '').trim() || DEFAULT_SOURCE;
    else if (argv[i] === '--limit') out.limit = Math.max(0, Number(argv[++i] || 0) || 0);
  }
  return out;
}

function foldTerms(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= MIN_TERM_LENGTH && w.length <= 24 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Mots-cles d'un passage, par frequence, bornes. */
function keywordsOf(text) {
  const freq = new Map();
  for (const term of foldTerms(text)) freq.set(term, (freq.get(term) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TERMS_PER_PASSAGE)
    .map(([term]) => term);
}

function extractPassages(conversation) {
  const mapping = conversation?.mapping && typeof conversation.mapping === 'object'
    ? Object.values(conversation.mapping)
    : [];
  const out = [];
  for (const node of mapping) {
    const message = node?.message;
    const role = message?.author?.role;
    if (!role || role === 'system') continue;
    const parts = Array.isArray(message?.content?.parts) ? message.content.parts : [];
    const text = parts.filter((p) => typeof p === 'string').join('\n').trim();
    if (text.length < MIN_PASSAGE_CHARS) continue;
    out.push({ role, text, createTime: Number(message?.create_time || 0) || 0 });
  }
  return out;
}

(function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.source)) {
    console.error(`source introuvable: ${args.source}`);
    process.exit(1);
  }

  const files = fs.readdirSync(args.source)
    .filter((f) => /^conversations-\d+\.json$/i.test(f))
    .sort();
  if (!files.length) {
    console.error('aucun fichier conversations-*.json');
    process.exit(1);
  }

  const index = new Map();        // terme -> [numeros de passage]
  const passages = [];            // metadonnees + apercu, jamais le texte integral
  let conversationCount = 0;
  let skipped = 0;

  for (const file of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(args.source, file), 'utf8'));
    } catch (error) {
      console.warn(`  ${file}: illisible (${String(error.message).slice(0, 60)})`);
      continue;
    }
    const conversations = Array.isArray(data) ? data : [];
    for (const conversation of conversations) {
      if (args.limit && conversationCount >= args.limit) break;
      conversationCount += 1;
      const title = String(conversation?.title || 'Sans titre').slice(0, 160);
      const convId = String(conversation?.conversation_id || conversation?.id || '').slice(0, 64);

      for (const passage of extractPassages(conversation)) {
        const terms = keywordsOf(passage.text);
        if (terms.length < 3) { skipped += 1; continue; }
        const id = passages.length;
        passages.push({
          id,
          conversationId: convId,
          title,
          role: passage.role,
          createTime: passage.createTime,
          chars: passage.text.length,
          preview: passage.text.replace(/\s+/g, ' ').slice(0, PASSAGE_PREVIEW),
        });
        for (const term of terms) {
          let postings = index.get(term);
          if (!postings) { postings = []; index.set(term, postings); }
          postings.push(id);
        }
      }
    }
    if (args.limit && conversationCount >= args.limit) break;
  }

  // Les termes presents partout ne discriminent rien: on les ecarte a l'ecriture.
  const tooCommon = Math.max(50, Math.floor(passages.length * 0.35));
  const kept = {};
  let dropped = 0;
  for (const [term, postings] of index) {
    if (postings.length > tooCommon) { dropped += 1; continue; }
    kept[term] = postings;
  }

  const target = path.join(getCanonicalRuntimeRoot(process.env), 'chatgpt-keyword-index.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const payload = {
    schema: 'funesterie.chatgpt-keyword-index.v1',
    builtAt: new Date().toISOString(),
    source: args.source,
    conversations: conversationCount,
    passages: passages.length,
    terms: Object.keys(kept).length,
    sha256: crypto.createHash('sha256').update(files.join(',')).digest('hex').slice(0, 16),
    index: kept,
    passages_meta: passages,
  };
  fs.writeFileSync(target, JSON.stringify(payload));

  const bytes = fs.statSync(target).size;
  console.log(`conversations : ${conversationCount}`);
  console.log(`passages      : ${passages.length} (${skipped} ecartes, trop courts)`);
  console.log(`termes        : ${Object.keys(kept).length} (${dropped} ecartes, trop frequents)`);
  console.log(`index         : ${(bytes / 1048576).toFixed(1)} Mo -> ${target}`);
})();
