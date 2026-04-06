require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const { Pool } = require('pg');

function unwrapRailwayWrappedEnvValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const wrappedMatch = raw.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/);
  if (wrappedMatch) {
    return String(wrappedMatch[1] || '').trim();
  }
  return raw;
}

function resolveDatabaseUrl() {
  const directUrl = unwrapRailwayWrappedEnvValue(
    process.env.DATABASE_URL
    || process.env.DATABASE_PUBLIC_URL
    || process.env.DATABASE_PRIVATE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PUBLIC_URL
    || process.env.POSTGRES_PRIVATE_URL
    || ''
  );
  if (directUrl) return directUrl;

  const host = unwrapRailwayWrappedEnvValue(process.env.PGHOST || process.env.POSTGRES_HOST || '');
  const port = Number(unwrapRailwayWrappedEnvValue(process.env.PGPORT || process.env.POSTGRES_PORT || '5432')) || 5432;
  const database = unwrapRailwayWrappedEnvValue(process.env.PGDATABASE || process.env.POSTGRES_DB || '');
  const user = unwrapRailwayWrappedEnvValue(process.env.PGUSER || process.env.POSTGRES_USER || '');
  const password = unwrapRailwayWrappedEnvValue(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || '');
  if (!host || !database || !user) return '';
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = password ? `:${encodeURIComponent(password)}` : '';
  const encodedDatabase = encodeURIComponent(database);
  return `postgresql://${encodedUser}${encodedPassword}@${host}:${port}/${encodedDatabase}`;
}

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  console.error('❌ DATABASE_URL/DATABASE_PUBLIC_URL/PG* manquant');
  process.exit(1);
}

const db = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )
`)
.then(() => { console.log('✅ Table users créée (ou déjà existante)'); db.end(); })
.catch(e => { console.error('❌', e.message); db.end(); process.exit(1); });
