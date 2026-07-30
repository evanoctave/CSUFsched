import { decodeEntities } from './catalog.ts';
import type { RawClassRow, ResultRow } from './types.ts';

const NO_MEETING = new Set(['', 'TBA', 'To Be Arranged', 'Asynchronous']);
const NO_ROOM = new Set(['', 'TBA', 'Online']);

export function parseDayTime(raw: string): { days: string; start: string; end: string } {
  const value = raw.trim();
  if (NO_MEETING.has(value)) return { days: '', start: '', end: '' };
  const m = /^([A-Za-z]+)\s+(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)$/.exec(value);
  if (m === null) throw new Error(`unrecognized day/time "${raw}"`);
  return { days: m[1], start: m[2], end: m[3] };
}

export function parseRoom(raw: string): { building: string; room: string } {
  const value = raw.trim().split(' - ')[0].trim();
  if (NO_ROOM.has(value)) return { building: '', room: '' };
  const parts = value.split(/\s+/);
  if (parts.length < 2) return { building: '', room: value };
  return { building: parts.slice(0, -1).join(' '), room: parts[parts.length - 1] };
}

export function parseMode(raw: string): string {
  const value = raw.trim();
  const online = /online/i.test(value);
  const inPerson = /in[- ]person/i.test(value);
  if (/hybrid/i.test(value) || (online && inPerson)) return 'HY';
  if (online) return 'OL';
  if (inPerson) return 'P';
  throw new Error(`unknown instruction mode "${raw}"`);
}

export function parseStatus(alt: string): string {
  const value = alt.trim().toLowerCase();
  if (value === 'open') return 'O';
  if (value === 'closed') return 'C';
  if (value === 'wait list') return 'W';
  throw new Error(`unknown enrollment status "${alt}"`);
}

// MTG_CLASSNAME is an anchor, every other field is a span, so close on either.
function fieldText(html: string, id: string): string {
  const m = new RegExp(`id='${id.replace(/\$/g, '\\$')}'[^>]*>([\\s\\S]*?)</(?:span|a)>`).exec(html);
  if (m === null) throw new Error(`field ${id} not found`);
  return decodeEntities(m[1].replace(/<br\s*\/?>/gi, '\n')).trim();
}

function statusAlt(html: string, index: number): string {
  const anchor = html.indexOf(`id='win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${index}'`);
  if (anchor === -1) throw new Error(`status cell for row ${index} not found`);
  const m = /alt="([^"]*)"/.exec(html.slice(anchor, anchor + 800));
  if (m === null) throw new Error(`status icon for row ${index} not found`);
  return m[1];
}

interface CourseHeader {
  offset: number;
  subject: string;
  catalogNbr: string;
  title: string;
}

function courseHeaders(html: string): CourseHeader[] {
  const headers: CourseHeader[] = [];
  for (const m of html.matchAll(/title='Collapse section ([^']*)'/g)) {
    const label = decodeEntities(m[1]).trim();
    const parsed = /^(\S+)\s+(\S+)\s+-\s+([\s\S]+)$/.exec(label);
    if (parsed === null) continue;
    headers.push({
      offset: m.index ?? 0,
      subject: parsed[1],
      catalogNbr: parsed[2],
      title: parsed[3].trim(),
    });
  }
  return headers;
}

function headerFor(headers: CourseHeader[], offset: number): CourseHeader {
  let found: CourseHeader | undefined;
  for (const h of headers) {
    if (h.offset > offset) break;
    found = h;
  }
  if (found === undefined) throw new Error('row has no preceding course group header');
  return found;
}

export interface ResultParseResult {
  rows: ResultRow[];
  skipped: Array<{ rowIndex: number; error: string }>;
}

export function parseResultRows(html: string): ResultParseResult {
  const headers = courseHeaders(html);
  const rows: ResultRow[] = [];
  const skipped: ResultParseResult['skipped'] = [];

  for (const m of html.matchAll(/id='MTG_CLASS_NBR\$(\d+)'[^>]*>(\d+)<\/a>/g)) {
    const rowIndex = Number(m[1]);
    try {
      const header = headerFor(headers, m.index ?? 0);
      const { days, start, end } = parseDayTime(fieldText(html, `MTG_DAYTIME$${rowIndex}`));
      const { building, room } = parseRoom(fieldText(html, `MTG_ROOM$${rowIndex}`));
      const classname = fieldText(html, `MTG_CLASSNAME$${rowIndex}`);
      const row: RawClassRow = {
        subject: header.subject,
        catalog_nbr: header.catalogNbr,
        descr: header.title,
        units: '',
        class_nbr: m[2],
        class_section: classname.split('\n')[0].split('-')[0].trim(),
        instructor: fieldText(html, `MTG_INSTR$${rowIndex}`),
        meeting_days: days,
        start_time: start,
        end_time: end,
        building,
        room,
        instruction_mode: parseMode(fieldText(html, `FUL_STU_SS_WRK_LONGVALUE$${rowIndex}`)),
        enrollment_status: parseStatus(statusAlt(html, rowIndex)),
      };
      rows.push({ rowIndex, row });
    } catch (err) {
      skipped.push({ rowIndex, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { rows, skipped };
}
