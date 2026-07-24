CREATE TABLE terms (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE professors (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  rmp_id TEXT UNIQUE,
  rating REAL,
  difficulty REAL,
  would_take_again_pct REAL,
  num_ratings INTEGER,
  rmp_url TEXT,
  last_scraped_at TIMESTAMPTZ
);

CREATE TABLE prof_tags (
  professor_id INTEGER NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (professor_id, tag)
);

CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  term_id INTEGER NOT NULL REFERENCES terms(id),
  dept_id INTEGER NOT NULL REFERENCES departments(id),
  catalog_nbr TEXT NOT NULL,
  title TEXT NOT NULL,
  units REAL NOT NULL,
  description TEXT,
  UNIQUE (term_id, dept_id, catalog_nbr)
);

CREATE TABLE sections (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  class_nbr TEXT NOT NULL,
  section_code TEXT NOT NULL,
  instructor_id INTEGER REFERENCES professors(id),
  mode TEXT NOT NULL DEFAULT 'in-person',
  enrollment_status TEXT NOT NULL DEFAULT 'open',
  UNIQUE (course_id, class_nbr)
);

CREATE TABLE meetings (
  id SERIAL PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  days TEXT NOT NULL, -- comma-joined Day codes, e.g. 'M,W,F'
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  building TEXT,
  room TEXT
);

CREATE INDEX idx_courses_term_dept ON courses (term_id, dept_id);
CREATE INDEX idx_sections_course ON sections (course_id);
CREATE INDEX idx_meetings_section ON meetings (section_id);
