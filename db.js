import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const baseConfig = {
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  ssl: process.env.DB_SSL !== 'false',
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS) || 5000,
};

const pools = new Map();

export const getPool = (database = process.env.DB_DATABASE) => {
  if (!pools.has(database)) {
    pools.set(
      database,
      new Pool({
        ...baseConfig,
        database,
      }),
    );
  }

  return pools.get(database);
};

export const pool = getPool();
