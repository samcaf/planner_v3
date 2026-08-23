-- planner_v3 schema
-- A calendar/planner-first workspace: projects, scheduled tasks, meetings, people.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- A user-editable taxonomy for projects; add and remove these freely.
CREATE TABLE IF NOT EXISTS project_types (
  id    INTEGER PRIMARY KEY,
  name  TEXT    NOT NULL UNIQUE,
  color TEXT    NOT NULL DEFAULT 'gray',
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY,
  type_id     INTEGER REFERENCES project_types(id) ON DELETE SET NULL,
  name        TEXT    NOT NULL UNIQUE,
  color       TEXT    NOT NULL DEFAULT 'blue',
  description TEXT    NOT NULL DEFAULT '',       -- markdown + latex
  status      TEXT    NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','planned','done','archived')),
  start_date  TEXT,
  due_date    TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestones (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  notes      TEXT    NOT NULL DEFAULT '',
  due_date   TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_milestones_due     ON milestones(due_date);

CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY,
  title          TEXT    NOT NULL,               -- markdown inline (links, math)
  notes          TEXT    NOT NULL DEFAULT '',    -- markdown block
  project_id     INTEGER REFERENCES projects(id)   ON DELETE SET NULL,
  milestone_id   INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
  -- No 'maybe' here: migrate-meetings.js retired it, collapsing it into
  -- todo + optional=1, and rebuilt the live table without it. This file has to
  -- agree, or a brand-new database accepts a status the real one rejects and
  -- the two installs diverge from the first row written.
  status         TEXT    NOT NULL DEFAULT 'todo'
                   CHECK (status IN ('todo','doing','done','moved','dropped')),
  priority       TEXT    NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('lowest','low','medium','high','highest')),
  scheduled_date TEXT,                           -- YYYY-MM-DD; NULL => backlog
  due_date       TEXT,
  estimate_min   INTEGER,                        -- minutes, for day/week load
  sort           INTEGER NOT NULL DEFAULT 0,
  from_template  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at   TEXT,
  intensity      TEXT    NOT NULL DEFAULT 'light',
  routine_item_id INTEGER REFERENCES routine_items(id) ON DELETE SET NULL
                   CHECK (intensity IN ('deep','light')),
  moved_to_date  TEXT,                           -- where a 'moved' task went
  notes_hidden   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_date    ON tasks(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due     ON tasks(due_date);

-- A group is any body a person belongs to: a company, a lab, a cohort.
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  kind        TEXT    NOT NULL DEFAULT 'company',
  website     TEXT    NOT NULL DEFAULT '',
  meeting_url TEXT    NOT NULL DEFAULT '',
  notes       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS people (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT '',
  group_id   INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  email      TEXT    NOT NULL DEFAULT '',
  phone      TEXT    NOT NULL DEFAULT '',
  location   TEXT    NOT NULL DEFAULT '',
  tags       TEXT    NOT NULL DEFAULT '',        -- comma separated
  notes      TEXT    NOT NULL DEFAULT '',        -- markdown + latex
  color       TEXT   NOT NULL DEFAULT 'blue',
  meeting_url TEXT   NOT NULL DEFAULT '',
  last_touch TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_people_group ON people(group_id);

CREATE TABLE IF NOT EXISTS task_people (
  task_id   INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, person_id)
);

-- A named band within one day. Optionally tied to a project, and independently
-- laid out as a list or as three columns. Daily routines live here rather than
-- in `projects`, so a morning routine never shows up as a project.
CREATE TABLE IF NOT EXISTS sections (
  id         INTEGER PRIMARY KEY,
  date       TEXT    NOT NULL,                   -- YYYY-MM-DD
  name       TEXT    NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  layout     TEXT    NOT NULL DEFAULT 'list'
               CHECK (layout IN ('list','columns')),
  color      TEXT    NOT NULL DEFAULT 'gray',
  collapsed  INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sections_date ON sections(date);

-- A routine is a section that is recreated every day (or on one weekday).
CREATE TABLE IF NOT EXISTS routines (
  id      INTEGER PRIMARY KEY,
  name    TEXT    NOT NULL,
  color   TEXT    NOT NULL DEFAULT 'gray',
  layout  TEXT    NOT NULL DEFAULT 'list'
            CHECK (layout IN ('list','columns')),
  weekday INTEGER,                               -- NULL => every day
  active  INTEGER NOT NULL DEFAULT 1,
  -- The default project for the tasks this routine creates, and for the section
  -- it becomes on a day. A routine_item's own project_id overrides it.
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  -- Routine chores are noise in a cross-cutting task list.
  hide_from_all_tasks INTEGER NOT NULL DEFAULT 0,
  sort    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS routine_items (
  id           INTEGER PRIMARY KEY,
  routine_id   INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  estimate_min INTEGER,
  col_index    INTEGER,
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_routine_items ON routine_items(routine_id);

-- One row per planned day.
CREATE TABLE IF NOT EXISTS days (
  date       TEXT PRIMARY KEY,                   -- YYYY-MM-DD
  title      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',           -- markdown + latex
  reflection TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
