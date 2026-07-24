import { describe, it, expect, vi } from 'vitest';
import { scrapeTerm } from '../src/run';
import type { RawClassRow } from '../src/types';

function row(overrides: Partial<RawClassRow>): RawClassRow {
  return {
    subject: 'CPSC',
    catalog_nbr: '121',
    descr: 'OOP',
    units: '3',
    class_nbr: '12345',
    class_section: '01',
    instructor: 'Lee,J',
    meeting_days: 'MoWe',
    start_time: '10:00AM',
    end_time: '10:50AM',
    building: 'CS',
    room: '101',
    instruction_mode: 'P',
    enrollment_status: 'O',
    ...overrides,
  };
}

describe('scrapeTerm', () => {
  it('fetches each department, persists parsed courses, and reports a summary', async () => {
    const fetchRows = vi
      .fn()
      .mockResolvedValueOnce([row({}), row({ class_nbr: '12346', class_section: '02' })])
      .mockResolvedValueOnce([row({ subject: 'MATH', catalog_nbr: '150B', descr: 'Calc II', units: '4', class_nbr: '20001' })]);
    const persistCourse = vi.fn().mockResolvedValue(undefined);

    const summary = await scrapeTerm({
      departments: ['CPSC', 'MATH'],
      fetchRows,
      persistCourse,
    });

    expect(fetchRows).toHaveBeenCalledWith('CPSC');
    expect(fetchRows).toHaveBeenCalledWith('MATH');
    expect(persistCourse).toHaveBeenCalledTimes(2);
    expect(summary.departmentsScraped).toBe(2);
    expect(summary.coursesPersisted).toBe(2);
    expect(summary.rowsSkipped).toHaveLength(0);
    expect(summary.departmentErrors).toHaveLength(0);
  });

  it('a department fetch failure is recorded, not thrown, and other departments continue', async () => {
    const fetchRows = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([row({})]);
    const persistCourse = vi.fn().mockResolvedValue(undefined);

    const summary = await scrapeTerm({ departments: ['CPSC', 'MATH'], fetchRows, persistCourse });

    expect(summary.departmentErrors).toEqual([{ dept: 'CPSC', error: 'boom' }]);
    expect(summary.coursesPersisted).toBe(1);
  });

  it('a persist failure for one course is recorded and does not abort the run', async () => {
    const fetchRows = vi
      .fn()
      .mockResolvedValueOnce([
        row({}),
        row({ catalog_nbr: '131', descr: 'Data Structures', class_nbr: '12400' }),
      ]);
    const persistCourse = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);

    const summary = await scrapeTerm({ departments: ['CPSC'], fetchRows, persistCourse });

    expect(summary.coursesPersisted).toBe(1);
    expect(summary.courseErrors).toEqual([{ course: 'CPSC 121', error: 'db down' }]);
  });

  it('malformed rows surface in rowsSkipped', async () => {
    const fetchRows = vi.fn().mockResolvedValueOnce([row({ meeting_days: 'MoXx' })]);
    const persistCourse = vi.fn();

    const summary = await scrapeTerm({ departments: ['CPSC'], fetchRows, persistCourse });

    expect(summary.rowsSkipped).toHaveLength(1);
    expect(summary.rowsSkipped[0].error).toMatch(/unrecognized/i);
    expect(persistCourse).not.toHaveBeenCalled();
  });
});
