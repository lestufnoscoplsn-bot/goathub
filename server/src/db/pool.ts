// Accès à PostgreSQL. Toutes les requêtes passent des paramètres ($1, $2…) : jamais de données collées dans le SQL.
import pg from 'pg';
import { config } from '../config.js';

// Les identifiants BIGINT sont lus comme des nombres (ils restent bien en dessous de 2^53)
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 20, idleTimeoutMillis: 30_000 });

export type Db = pg.Pool | pg.PoolClient;

export async function query<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const result = await db.query(sql, params as any[]);
  return result.rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

/** Exécute plusieurs requêtes « tout ou rien » (transaction). */
export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
