import 'dotenv/config';
import os from 'node:os';
import pg from 'pg';

const { Pool } = pg;

const database =
  os.hostname() === 'developapi.covercrop-selector.org'
    ? 'develop_species_selector'
    : process.env.DB_DATABASE;

export const pool = new Pool({
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  database,
  port: process.env.DB_PORT,
  ssl: process.env.DB_SSL !== 'false',
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS) || 5000,
});
