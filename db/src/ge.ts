import type pg from 'pg';

const OFFICIAL_GE_SOURCE_URL =
  'https://www.fullerton.edu/general-education/student-info/approved-courses.html';
const CANONICAL_GE_AREAS = new Set(['1A', '1B', '1C', '2A', '3', '4', '5A', '5B', '6', 'Z']);

export interface GeCourseAreaInput {
  area: string;
  subject: string;
  catalogNbr: string;
}

export interface GeSnapshotInput {
  catalogYear: string;
  sourceUrl: string;
  sourcePublishedAt: Date;
  rows: GeCourseAreaInput[];
}

function isValidGeCourseArea(row: unknown): row is GeCourseAreaInput {
  if (
    typeof row !== 'object'
    || row === null
    || !('area' in row)
    || !('subject' in row)
    || !('catalogNbr' in row)
  ) {
    return false;
  }
  const { area, subject, catalogNbr } = row;
  return typeof area === 'string'
    && typeof subject === 'string'
    && typeof catalogNbr === 'string'
    && CANONICAL_GE_AREAS.has(area)
    && /^[A-Z]{2,8}$/.test(subject)
    && /^\d{1,4}[A-Z]{0,2}$/.test(catalogNbr);
}

export async function replaceGeCourseAreas(pool: pg.Pool, input: GeSnapshotInput): Promise<void> {
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error('GE snapshot must contain at least one row');
  }

  const catalogYear = /^(\d{4})-(\d{4})$/.exec(input.catalogYear);
  const catalogYearIsValid = catalogYear !== null
    && Number(catalogYear[1]) >= 2025
    && Number(catalogYear[2]) === Number(catalogYear[1]) + 1;
  const sourcePublishedAtIsValid = input.sourcePublishedAt instanceof Date
    && Number.isFinite(input.sourcePublishedAt.getTime());
  if (
    !catalogYearIsValid
    || input.sourceUrl !== OFFICIAL_GE_SOURCE_URL
    || !sourcePublishedAtIsValid
    || input.rows.some((row) => !isValidGeCourseArea(row))
  ) {
    throw new Error('Invalid GE snapshot');
  }

  const keys = new Set<string>();
  for (const row of input.rows) {
    const key = `${row.area}\u0000${row.subject}\u0000${row.catalogNbr}`;
    if (keys.has(key)) {
      throw new Error('Duplicate GE course area');
    }
    keys.add(key);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Every replacement takes one catalog-year-specific lock before writes, so
    // same-year snapshots cannot interleave; different catalog years proceed independently.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.catalogYear]);
    for (const row of input.rows) {
      await client.query(
        `INSERT INTO ge_course_areas
           (catalog_year, area, subject, catalog_nbr, source_url, source_published_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (catalog_year, area, subject, catalog_nbr)
         DO UPDATE SET source_url = EXCLUDED.source_url,
                       source_published_at = EXCLUDED.source_published_at`,
        [
          input.catalogYear,
          row.area,
          row.subject,
          row.catalogNbr,
          input.sourceUrl,
          input.sourcePublishedAt,
        ],
      );
    }
    await client.query(
      `DELETE FROM ge_course_areas
       WHERE catalog_year = $1
         AND NOT (area, subject, catalog_nbr) IN (
           SELECT * FROM unnest($2::text[], $3::text[], $4::text[])
         )`,
      [
        input.catalogYear,
        input.rows.map((row) => row.area),
        input.rows.map((row) => row.subject),
        input.rows.map((row) => row.catalogNbr),
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
