import type pg from 'pg';

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

export async function replaceGeCourseAreas(pool: pg.Pool, input: GeSnapshotInput): Promise<void> {
  if (input.rows.length === 0) {
    throw new Error('GE snapshot must contain at least one row');
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
