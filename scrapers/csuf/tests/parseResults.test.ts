import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseResultRows, parseDayTime, parseRoom, parseMode, parseStatus } from '../src/parseResults';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const cpsc = fs.readFileSync(path.join(dir, 'results-cpsc.html'), 'utf8');
const online = fs.readFileSync(path.join(dir, 'results-online.html'), 'utf8');
const noResults = fs.readFileSync(path.join(dir, 'no-results.html'), 'utf8');

describe('parseDayTime', () => {
  it('splits a day-and-time string', () => {
    expect(parseDayTime('MoWe 8:30AM - 9:20AM')).toEqual({
      days: 'MoWe',
      start: '8:30AM',
      end: '9:20AM',
    });
  });

  it('treats Asynchronous, TBA, and blank as no meeting', () => {
    for (const raw of ['Asynchronous', 'TBA', '']) {
      expect(parseDayTime(raw)).toEqual({ days: '', start: '', end: '' });
    }
  });

  it('throws on an unrecognised shape', () => {
    expect(() => parseDayTime('MoWe 8:30AM')).toThrow(/day\/time/i);
  });
});

describe('parseRoom', () => {
  it('splits building from room and drops the room-type suffix', () => {
    expect(parseRoom('E 202 - Lecture Room')).toEqual({ building: 'E', room: '202' });
    expect(parseRoom('CPAC 148 - Lecture Room')).toEqual({ building: 'CPAC', room: '148' });
    expect(parseRoom('CS 102A - Lecture Room')).toEqual({ building: 'CS', room: '102A' });
  });

  it('treats Online, TBA, and blank as no room', () => {
    for (const raw of ['Online', 'TBA', '']) {
      expect(parseRoom(raw)).toEqual({ building: '', room: '' });
    }
  });
});

describe('parseMode', () => {
  it('maps the observed instruction modes to pipeline codes', () => {
    expect(parseMode('In Person')).toBe('P');
    expect(parseMode('Fully Online')).toBe('OL');
    expect(parseMode('Mostly Online w/ In-Person Mtg')).toBe('HY');
    expect(parseMode('Hybrid')).toBe('HY');
  });

  it('throws on an unknown mode so the row lands in rowsSkipped', () => {
    expect(() => parseMode('Teleportation')).toThrow(/instruction mode/i);
  });
});

describe('parseStatus', () => {
  it('maps the status icon alt text', () => {
    expect(parseStatus('Open')).toBe('O');
    expect(parseStatus('Closed')).toBe('C');
    expect(parseStatus('Wait List')).toBe('W');
  });
});

describe('parseResultRows', () => {
  it('returns one row per meeting row, carrying its results-page index', () => {
    const { rows, skipped } = parseResultRows(cpsc);
    expect(skipped).toHaveLength(0);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0].rowIndex).toBe(0);
    expect(rows.map((r) => r.rowIndex)).toEqual([...rows.map((r) => r.rowIndex)].sort((a, b) => a - b));
  });

  it('fills subject, catalog number, and title from the course group header', () => {
    const first = parseResultRows(cpsc).rows[0].row;
    expect(first.subject).toBe('CPSC');
    expect(first.catalog_nbr).toMatch(/^\d{3}[A-Z]?$/);
    expect(first.descr.length).toBeGreaterThan(3);
  });

  it('fills class number, section code, instructor, mode, and status', () => {
    const first = parseResultRows(cpsc).rows[0].row;
    expect(first.class_nbr).toMatch(/^\d+$/);
    expect(first.class_section).toMatch(/^\d+$/);
    expect(first.instruction_mode).toBe('P');
    expect(['O', 'C', 'W']).toContain(first.enrollment_status);
    expect(first.instructor.length).toBeGreaterThan(0);
  });

  it('leaves units empty for the detail pass to fill', () => {
    expect(parseResultRows(cpsc).rows.every((r) => r.row.units === '')).toBe(true);
  });

  it('reads asynchronous online rows as no days, no times, and no room', () => {
    const async = parseResultRows(online).rows.filter((r) => r.row.instruction_mode === 'OL');
    expect(async.length).toBeGreaterThan(0);
    expect(async[0].row.meeting_days).toBe('');
    expect(async[0].row.start_time).toBe('');
    expect(async[0].row.building).toBe('');
  });

  it('returns nothing for a page with no result rows', () => {
    expect(parseResultRows(noResults)).toEqual({ rows: [], skipped: [] });
  });

  it('records an unparseable row instead of throwing', () => {
    const broken = `
      <a class='PSHYPERLINK' title='Collapse section CPSC 999 - Broken'>x</a>
      <a name='MTG_CLASS_NBR$0' id='MTG_CLASS_NBR$0'>111</a>
      <span id='MTG_CLASSNAME$0'>01-LEC<br />Regular</span>
      <span id='MTG_DAYTIME$0'>whenever</span>
      <span id='MTG_ROOM$0'>TBA</span>
      <span id='FUL_STU_SS_WRK_LONGVALUE$0'>In Person</span>
      <span id='MTG_INSTR$0'>Staff</span>
      <div id='win0divDERIVED_CLSRCH_SSR_STATUS_LONG$0'><img alt="Open"></div>`;
    const { rows, skipped } = parseResultRows(broken);
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].rowIndex).toBe(0);
  });
});
