CREATE TABLE ge_course_areas (
  catalog_year TEXT NOT NULL,
  area TEXT NOT NULL,
  subject TEXT NOT NULL,
  catalog_nbr TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_published_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (catalog_year, area, subject, catalog_nbr)
);

CREATE INDEX idx_ge_course_areas_lookup
  ON ge_course_areas (catalog_year, area, subject, catalog_nbr);
