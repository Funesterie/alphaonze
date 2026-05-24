#!/usr/bin/env node
'use strict';

const path = require('node:path');

const SERVER_ROOT = path.resolve(__dirname, '..', '..', 'server');
const DEFAULT_DATABASE_URL = 'postgres://127.0.0.1:5437/a11_memory';
const { Client } = require(path.join(SERVER_ROOT, 'node_modules', 'pg'));

function parseArgs(argv) {
  const opts = {
    query: '',
    limit: 8,
    databaseUrl: process.env.A11_MEMORY_DATABASE_URL || DEFAULT_DATABASE_URL,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit' || arg === '-k') opts.limit = Number(argv[++index] || 8);
    else if (arg === '--database-url') opts.databaseUrl = String(argv[++index] || '').trim();
    else opts.query = [opts.query, arg].filter(Boolean).join(' ');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.query.trim()) {
    console.error('Usage: node scripts/search-memory.cjs "query" [--limit 8]');
    process.exitCode = 1;
    return;
  }
  const client = new Client({ connectionString: opts.databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT
         conversation_title,
         provider,
         account_label,
         role,
         source_label,
         ts_rank(to_tsvector('simple', content), websearch_to_tsquery('simple', $1)) AS rank,
         left(regexp_replace(content, '\\s+', ' ', 'g'), 700) AS excerpt
       FROM memory_search
       WHERE to_tsvector('simple', content) @@ websearch_to_tsquery('simple', $1)
       ORDER BY rank DESC, message_created_at DESC NULLS LAST
       LIMIT $2`,
      [opts.query, Math.max(1, Math.min(50, opts.limit || 8))]
    );
    console.log(JSON.stringify({ ok: true, count: result.rowCount, results: result.rows }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[a11-memory-search] ${String(error?.message || error)}`);
  process.exitCode = 1;
});
