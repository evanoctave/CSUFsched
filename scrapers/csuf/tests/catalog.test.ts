import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseCatalog } from '../src/catalog';

const fixture = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'entry.html'),
  'utf8',
);

describe('parseCatalog', () => {
  const catalog = parseCatalog(fixture);

  it('reads terms newest first, dropping the blank option', () => {
    expect(catalog.terms.length).toBeGreaterThanOrEqual(1);
    expect(catalog.terms.every((t) => t.code !== '')).toBe(true);
    expect(catalog.terms.map((t) => t.code)).toContain('2267');
    expect(catalog.terms.find((t) => t.code === '2267')?.name).toBe('Fall 2026');
  });

  it('reads all subjects with their real names', () => {
    expect(catalog.subjects.length).toBeGreaterThan(80);
    expect(catalog.subjects.find((s) => s.code === 'CPSC')?.name).toBe('Computer Science');
    expect(catalog.subjects.every((s) => s.code !== '' && s.name !== '')).toBe(true);
  });

  it('reads the three careers', () => {
    expect(catalog.careers.map((c) => c.code).sort()).toEqual(['EXED', 'PBAC', 'UGRD']);
  });

  it('decodes HTML entities in option labels', () => {
    // All three dropdowns are present because parseCatalog requires every one of them.
    const html = `
      <select name='CLASS_SRCH_WRK2_STRM$35$'><option value="2267">Fall 2026</option></select>
      <select name='SSR_CLSRCH_WRK_SUBJECT_SRCH$0'>
        <option value="">&nbsp;</option>
        <option value="ACCT">Accounting &amp; Finance</option>
      </select>
      <select name='SSR_CLSRCH_WRK_ACAD_CAREER$2'><option value="UGRD">Undergraduate</option></select>`;
    expect(parseCatalog(html).subjects).toEqual([{ code: 'ACCT', name: 'Accounting & Finance' }]);
  });

  it('throws when a required dropdown is missing', () => {
    expect(() => parseCatalog('<html>nothing</html>')).toThrow(/CLASS_SRCH_WRK2_STRM/);
  });
});
