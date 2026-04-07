import pg from 'pg';

export async function runCleanupTestData({ dryRun = true, verbose = false, connectionString }) {
  const client = new pg.Client({ connectionString });
  await client.connect();

  const config = {
    dryRun,
    verbose,
    heuristics: {
      email: /test|smoke|demo|fake|seed|example/i,
      username: /test|smoke|demo|fake|dev|sandbox/i,
      room: /test|smoke|demo|fake|dev|sandbox/i,
      label: /test|smoke|demo|fake|dev|sandbox/i,
    },
  };

  const TABLES = [
    'casino_roulette_bets',
    'casino_transactions',
    'casino_table_room_presence',
    'a11_pending_clarifications',
    'conversation_resources',
    'messages',
    'user_files',
    'user_memory',
    'user_facts',
    'user_tasks',
    'files',
    'casino_roulette_rounds',
    'casino_wallets',
    'users',
    'a11_external_resource_cache',
  ];

  const tableExists = async (table) => {
    const res = await client.query(
      `SELECT to_regclass($1) as exists`, [table]
    );
    return !!res.rows[0].exists;
  };
  const getColumns = async (table) => {
    const res = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]
    );
    return res.rows.map(r => r.column_name);
  };

  const plans = [];
  for (const table of TABLES) {
    if (!(await tableExists(table))) {
      if (config.verbose) console.log(`[SKIP] Table ${table} does not exist.`);
      continue;
    }
    const columns = await getColumns(table);
    let where = null;
    if (table === 'users') {
      where = `email ~* '${config.heuristics.email.source}' OR username ~* '${config.heuristics.username.source}'`;
    } else if (table === 'casino_table_room_presence') {
      where = `room_id ~* '${config.heuristics.room.source}'`;
    } else if (table === 'messages') {
      if (columns.includes('author')) {
        where = `author ~* '${config.heuristics.username.source}'`;
      } else if (columns.includes('user_id')) {
        where = `user_id::text IN (SELECT id::text FROM users WHERE email ~* '${config.heuristics.email.source}')`;
      } else if (columns.includes('username')) {
        where = `username ~* '${config.heuristics.username.source}'`;
      } else {
        if (config.verbose) console.log(`[SKIP] Table ${table} has no author/user_id/username column.`);
        continue;
      }
    } else if (table === 'casino_wallets') {
      where = `user_id::text IN (SELECT id::text FROM users WHERE email ~* '${config.heuristics.email.source}')`;
    } else if (table === 'casino_roulette_rounds') {
      where = `room_id ~* '${config.heuristics.room.source}'`;
    } else if (table === 'a11_pending_clarifications') {
      where = `user_id::text IN (SELECT id::text FROM users WHERE email ~* '${config.heuristics.email.source}')`;
    } else if (table === 'user_files' || table === 'files') {
      where = `user_id::text IN (SELECT id::text FROM users WHERE email ~* '${config.heuristics.email.source}')`;
    } else if (table === 'user_memory' || table === 'user_facts' || table === 'user_tasks') {
      where = `user_id::text IN (SELECT id::text FROM users WHERE email ~* '${config.heuristics.email.source}')`;
    } else if (table === 'casino_transactions' || table === 'casino_roulette_bets') {
      where = `user_id::text IN (SELECT id::text FROM users WHERE email ~* '${config.heuristics.email.source}')`;
    } else if (table === 'a11_external_resource_cache') {
      where = `user_id::text IN (SELECT id::text FROM users WHERE email ~* '${config.heuristics.email.source}')`;
    } else {
      where = null;
    }
    plans.push({ table, where });
  }

  let total = 0;
  const planResults = [];
  for (const { table, where } of plans) {
    if (!where) continue;
    const countRes = await client.query(`SELECT count(*) FROM ${table} WHERE ${where}`);
    const count = parseInt(countRes.rows[0].count, 10);
    if (count > 0) {
      if (verbose) console.log(`[PLAN] ${table}: ${count} rows would be deleted.`);
      total += count;
      planResults.push({ table, count });
    }
  }
  let deleted = 0;
  if (!dryRun) {
    for (const { table, where } of plans) {
      if (!where) continue;
      const delRes = await client.query(`DELETE FROM ${table} WHERE ${where} RETURNING *`);
      if (verbose) console.log(`[DELETE] ${table}: ${delRes.rowCount} rows deleted.`);
      deleted += delRes.rowCount;
    }
  }
  await client.end();
  return {
    dryRun,
    totalPlanned: total,
    plans: planResults,
    deleted,
  };
}
