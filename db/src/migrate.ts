import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool } from './pool';

export function orderMigrations(files: string[]): string[] {
  return files.filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
}

export async function runMigrations(pool: pg.Pool, dir: string): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const files = orderMigrations(await readdir(dir));
  const appliedRows = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set<string>(appliedRows.rows.map((r) => r.filename as string));
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return ran;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const pool = createPool(url);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  runMigrations(pool, dir)
    .then((ran) => {
      console.log(ran.length === 0 ? 'No pending migrations' : `Applied: ${ran.join(', ')}`);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
