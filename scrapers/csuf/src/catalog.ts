import type { Catalog, CatalogOption } from './types.ts';

const TERM_SELECT = 'CLASS_SRCH_WRK2_STRM$35$';
const SUBJECT_SELECT = 'SSR_CLSRCH_WRK_SUBJECT_SRCH$0';
const CAREER_SELECT = 'SSR_CLSRCH_WRK_ACAD_CAREER$2';

export function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// PeopleSoft renders the same form with varying whitespace and attribute order
// between builds, so match on the tag and its name attribute rather than an
// exact prefix.
function findSelect(html: string, name: string): number {
  const lower = html.toLowerCase();
  let from = 0;
  while (from < html.length) {
    const open = lower.indexOf('<select', from);
    if (open === -1) return -1;
    const end = tagEnd(html, open + '<select'.length);
    if (end === -1) return -1;
    const attr = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(html.slice(open, end));
    if (attr !== null && (attr[1] ?? attr[2]) === name) return open;
    from = end;
  }
  return -1;
}

// Finds the closing '>' while skipping over quoted attribute values, which can
// themselves contain one.
function tagEnd(html: string, from: number): number {
  let quote = '';
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i];
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
  }
  return -1;
}

function selectBody(html: string, name: string): string {
  const open = findSelect(html, name);
  if (open === -1) throw new Error(`dropdown ${name} not found on entry page`);
  const close = html.indexOf('</select>', open);
  if (close === -1) throw new Error(`dropdown ${name} is unterminated on entry page`);
  return html.slice(open, close);
}

function parseOptions(html: string, name: string): CatalogOption[] {
  const body = selectBody(html, name);
  const options: CatalogOption[] = [];
  for (const m of body.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)) {
    const code = m[1].trim();
    const label = decodeEntities(m[2]).trim();
    if (code === '' || label === '') continue;
    options.push({ code, name: label });
  }
  return options;
}

export function parseCatalog(html: string): Catalog {
  return {
    terms: parseOptions(html, TERM_SELECT),
    subjects: parseOptions(html, SUBJECT_SELECT),
    careers: parseOptions(html, CAREER_SELECT),
  };
}
