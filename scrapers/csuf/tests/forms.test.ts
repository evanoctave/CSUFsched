import { describe, it, expect } from 'vitest';
import { ENVELOPE_FIELDS, buildSearchFields } from '../src/forms.ts';

describe('buildSearchFields', () => {
  const criteria = { termCode: '2267', subject: 'CPSC', career: 'UGRD' };

  it('sends institution, term, subject, career and the catalog-number floor', () => {
    const f = buildSearchFields(criteria);
    expect(f['CLASS_SRCH_WRK2_INSTITUTION$31$']).toBe('FLCMP');
    expect(f['CLASS_SRCH_WRK2_STRM$35$']).toBe('2267');
    expect(f['SSR_CLSRCH_WRK_SUBJECT_SRCH$0']).toBe('CPSC');
    expect(f['SSR_CLSRCH_WRK_ACAD_CAREER$2']).toBe('UGRD');
    expect(f['SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1']).toBe('G');
    expect(f['SSR_CLSRCH_WRK_CATALOG_NBR$1']).toBe('0');
    expect(f['SSR_CLSRCH_WRK_SSR_OPEN_ONLY$3']).toBe('N');
  });

  it('includes the empty-but-required companion fields', () => {
    const f = buildSearchFields(criteria);
    for (const k of [
      'SSR_CLSRCH_WRK_CRSE_ATTR$4',
      'SSR_CLSRCH_WRK_CRSE_ATTR_VALUE$4',
      'SSR_CLSRCH_WRK_LOCATION$5',
      'SSR_CLSRCH_WRK_DESCR$6',
    ]) {
      expect(f[k]).toBe('');
    }
  });

  it('does not carry PeopleSoft envelope fields (session owns those)', () => {
    expect(buildSearchFields(criteria)).not.toHaveProperty('ICAJAX');
    expect(ENVELOPE_FIELDS.ICAJAX).toBe('1');
    expect(ENVELOPE_FIELDS.ICType).toBe('Panel');
  });
});
