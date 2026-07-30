import { describe, expect, it } from 'vitest';
import {
  parseNonNegativeNumber,
  parseRatio,
  parseTermCodes,
  requireCatalogTerm,
  selectTerms,
  validateCatalog,
} from '../src/validation';
import type { Catalog } from '../src/types';

const catalog: Catalog = {
  terms: [
    { code: '2267', name: 'Fall 2026' },
    { code: '2265', name: 'Summer 2026' },
  ],
  subjects: [{ code: 'CPSC', name: 'Computer Science' }],
  careers: [{ code: 'UGRD', name: 'Undergraduate' }],
};

describe('numeric runtime validation', () => {
  it('uses defaults and accepts boundary values', () => {
    expect(parseNonNegativeNumber('RATE_LIMIT_MS', undefined, 1000)).toBe(1000);
    expect(parseNonNegativeNumber('RATE_LIMIT_MS', '0', 1000)).toBe(0);
    expect(parseRatio('SANITY_MIN_RATIO', '1', 0.9)).toBe(1);
  });

  it.each(['NaN', 'Infinity', '-1'])('rejects invalid nonnegative number %s', (raw) => {
    expect(() => parseNonNegativeNumber('RATE_LIMIT_MS', raw, 1000)).toThrow(
      /RATE_LIMIT_MS/,
    );
  });

  it.each(['NaN', 'Infinity', '0', '-0.1', '1.01'])('rejects invalid ratio %s', (raw) => {
    expect(() => parseRatio('SANITY_MIN_RATIO', raw, 0.9)).toThrow(
      /SANITY_MIN_RATIO/,
    );
  });
});

describe('term-list parsing', () => {
  it('trims, removes blanks, and deduplicates while preserving order', () => {
    expect(parseTermCodes(' 2267,2265,2267, ,')).toEqual(['2267', '2265']);
    expect(parseTermCodes(undefined)).toBeUndefined();
  });

  it('rejects a supplied list containing no term codes', () => {
    expect(() => parseTermCodes(' , ')).toThrow(/TERM_CODES/);
  });
});

describe('catalog validation and selection', () => {
  it.each(['terms', 'subjects', 'careers'] as const)('rejects empty %s', (key) => {
    expect(() => validateCatalog({ ...catalog, [key]: [] })).toThrow(
      new RegExp(key, 'i'),
    );
  });

  it('selects requested terms in catalog order', () => {
    expect(selectTerms(catalog, ['2265'])).toEqual([
      { code: '2265', name: 'Summer 2026' },
    ]);
  });

  it('rejects every requested term missing from live catalog', () => {
    expect(() => selectTerms(catalog, ['9999', '2267'])).toThrow(/9999/);
  });

  it('requires one exact catalog term for status mode', () => {
    expect(requireCatalogTerm(catalog, '2267').name).toBe('Fall 2026');
    expect(() => requireCatalogTerm(catalog, '9999')).toThrow(/9999/);
  });
});
