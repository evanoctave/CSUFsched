import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { orderMigrations, runMigrations } from '../src/migrate';
import { createPool } from '../src/pool';

describe('orderMigrations', () => {
  it('sorts numeric-prefixed sql files ascending', () => {
    expect(orderMigrations(['002_b.sql', '001_a.sql', '010_c.sql'])).toEqual([
      '001_a.sql',
      '002_b.sql',
      '010_c.sql',
    ]);
  });

  it('ignores non-migration files', () => {
    expect(orderMigrations(['001_a.sql', 'README.md', 'notes.txt', '.DS_Store'])).toEqual([
      '001_a.sql',
    ]);
  });

  it('sorts numerically, not lexicographically', () => {
    expect(orderMigrations(['10_b.sql', '2_a.sql'])).toEqual(['2_a.sql', '10_b.sql']);
  });
});

const TEST_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'test_migrate';

// Every package's integration tests share one TEST_DATABASE_URL and run
// concurrently, so this file migrates into a scratch schema of its own rather
// than wiping `public` out from under its neighbours.
function scopedUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${schema}`);
  return parsed.toString();
}

async function resetSchema(schema: string, recreate: boolean): Promise<void> {
  const admin = createPool(TEST_URL!);
  try {
    await admin.query(
      `DROP SCHEMA IF EXISTS ${schema} CASCADE${recreate ? `; CREATE SCHEMA ${schema}` : ''}`,
    );
  } finally {
    await admin.end();
  }
}

describe.skipIf(!TEST_URL)('runMigrations (integration)', () => {
  it('applies 001_init.sql once and is idempotent', async () => {
    await resetSchema(SCHEMA, true);
    const pool = createPool(scopedUrl(TEST_URL!, SCHEMA));
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
    try {
      const first = await runMigrations(pool, dir);
      expect(first).toContain('001_init.sql');
      const second = await runMigrations(pool, dir);
      expect(second).toEqual([]);
      const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`,
      );
      const names = tables.rows.map((r) => r.table_name);
      for (const t of [
        'terms',
        'departments',
        'courses',
        'sections',
        'meetings',
        'professors',
        'prof_tags',
      ]) {
        expect(names).toContain(t);
      }
    } finally {
      await pool.end();
      await resetSchema(SCHEMA, false);
    }
  });
});
