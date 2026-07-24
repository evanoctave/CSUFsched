import { describe, it, expect } from 'vitest';
import { orderMigrations } from '../src/migrate';

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
