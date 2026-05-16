const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
