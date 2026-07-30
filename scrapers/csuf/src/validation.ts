import type { Catalog, CatalogOption } from './types.ts';

export function parseNonNegativeNumber(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number greater than or equal to 0`);
  }
  return value;
}

export function parseRatio(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be a finite number greater than 0 and at most 1`);
  }
  return value;
}

export function parseTermCodes(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const codes = [...new Set(raw.split(',').map((code) => code.trim()).filter(Boolean))];
  if (codes.length === 0) throw new Error('TERM_CODES must contain at least one term code');
  return codes;
}

export function validateCatalog(catalog: Catalog): void {
  for (const key of ['terms', 'subjects', 'careers'] as const) {
    if (catalog[key].length === 0) {
      throw new Error(`live catalog contains no ${key}`);
    }
  }
}

export function selectTerms(catalog: Catalog, requested?: string[]): CatalogOption[] {
  validateCatalog(catalog);
  if (requested === undefined) return catalog.terms;
  const known = new Set(catalog.terms.map((term) => term.code));
  const missing = requested.filter((code) => !known.has(code));
  if (missing.length > 0) {
    throw new Error(`requested term codes absent from live catalog: ${missing.join(', ')}`);
  }
  const wanted = new Set(requested);
  return catalog.terms.filter((term) => wanted.has(term.code));
}

export function requireCatalogTerm(catalog: Catalog, code: string): CatalogOption {
  validateCatalog(catalog);
  const term = catalog.terms.find((candidate) => candidate.code === code);
  if (term === undefined) throw new Error(`term ${code} absent from live catalog`);
  return term;
}
