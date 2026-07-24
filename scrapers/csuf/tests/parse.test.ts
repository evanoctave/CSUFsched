import { describe, it, expect } from 'vitest';
import { parseDays, parseTime } from '../src/parse';

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
