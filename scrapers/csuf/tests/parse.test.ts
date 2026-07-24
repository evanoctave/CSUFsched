import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDays, parseTime, parseClassRows } from '../src/parse';
import type { RawClassRow } from '../src/types';

const fixture: RawClassRow[] = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cpsc.json'),
    'utf8',
  ),
);

describe('parseDays', () => {
  it('maps PeopleSoft day pairs to Day codes', () => {
    expect(parseDays('MoWeFr')).toEqual(['M', 'W', 'F']);
    expect(parseDays('TuTh')).toEqual(['Tu', 'Th']);
    expect(parseDays('SaSu')).toEqual(['Sa', 'Su']);
  });

  it('returns empty array for blank or TBA', () => {
    expect(parseDays('')).toEqual([]);
    expect(parseDays('TBA')).toEqual([]);
  });

  it('throws on unrecognized tokens', () => {
    expect(() => parseDays('MoXx')).toThrow(/unrecognized/i);
    expect(() => parseDays('MoW')).toThrow(/unrecognized/i);
  });
});

describe('parseTime', () => {
  it('parses AM/PM times to minutes from midnight', () => {
    expect(parseTime('10:00AM')).toBe(600);
    expect(parseTime('1:15PM')).toBe(795);
    expect(parseTime('12:00PM')).toBe(720);
    expect(parseTime('12:30AM')).toBe(30);
  });

  it('returns null for blank or TBA', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('TBA')).toBeNull();
  });

  it('throws on malformed input', () => {
    expect(() => parseTime('25:00AM')).toThrow(/invalid/i);
  });
});

describe('parseClassRows', () => {
  it('groups rows into courses and sections with merged meeting patterns', () => {
    const { courses } = parseClassRows(fixture);
    expect(courses).toHaveLength(2); // CPSC 121, CPSC 131 (999 skipped)
    const cpsc121 = courses.find((c) => c.catalogNbr === '121')!;
    expect(cpsc121.sections).toHaveLength(2);
    const s1 = cpsc121.sections.find((s) => s.classNbr === '12345')!;
    expect(s1.meetings).toHaveLength(2); // lecture + lab
    expect(s1.meetings[0]).toEqual({
      days: ['M', 'W', 'F'],
      startMin: 600,
      endMin: 650,
      building: 'CS',
      room: '101',
    });
    expect(s1.instructorName).toBe('Lee,J');
  });

  it('maps online sections with no meetings and normalizes Staff/blank instructor to null', () => {
    const { courses } = parseClassRows(fixture);
    const online = courses
      .find((c) => c.catalogNbr === '121')!
      .sections.find((s) => s.classNbr === '12346')!;
    expect(online.meetings).toEqual([]);
    expect(online.mode).toBe('online');
    expect(online.enrollmentStatus).toBe('waitlist');
    expect(online.instructorName).toBeNull();
  });

  it('maps hybrid mode and closed status', () => {
    const { courses } = parseClassRows(fixture);
    const s = courses.find((c) => c.catalogNbr === '131')!.sections[0];
    expect(s.mode).toBe('hybrid');
    expect(s.enrollmentStatus).toBe('closed');
  });

  it('isolates malformed rows into skipped with error messages', () => {
    const { skipped } = parseClassRows(fixture);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].row.catalog_nbr).toBe('999');
    expect(skipped[0].error).toMatch(/unrecognized/i);
  });
});
