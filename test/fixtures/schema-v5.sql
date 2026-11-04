-- Schema captured from project-mgr 0.5.2 (bd9170e), before migration 6.
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
, description TEXT, notes TEXT);
CREATE TABLE status_entries (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  progress TEXT,
  blockers_json TEXT NOT NULL DEFAULT '[]',
  next_steps_json TEXT NOT NULL DEFAULT '[]',
  decisions_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  source TEXT NOT NULL,
  external_ref TEXT UNIQUE
, uid TEXT, next_steps_source_uid TEXT REFERENCES status_entries(uid), next_todo_uids_json TEXT);
CREATE INDEX idx_status_entries_project_occurred ON status_entries(project_id, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX idx_entry_uid ON status_entries(uid);
CREATE TABLE completion_events (
          id INTEGER PRIMARY KEY,
          uid TEXT NOT NULL UNIQUE,
          target_uid TEXT NOT NULL REFERENCES status_entries(uid),
          by_uid TEXT NOT NULL REFERENCES status_entries(uid),
          previous_uid TEXT REFERENCES completion_events(uid),
          action TEXT NOT NULL CHECK(action IN ('complete', 'revoke')),
          reason TEXT,
          recorded_at TEXT NOT NULL,
          source TEXT NOT NULL
        );
CREATE INDEX idx_completion_target ON completion_events(target_uid, id DESC);
CREATE TRIGGER require_entry_uid BEFORE INSERT ON status_entries
        WHEN NEW.uid IS NULL
        BEGIN SELECT RAISE(ABORT, 'entry uid required; upgrade the writer'); END;
CREATE TABLE todos (
        uid TEXT PRIMARY KEY, title TEXT NOT NULL,
        project TEXT REFERENCES projects(slug),
        entry_uid TEXT REFERENCES status_entries(uid),
        step_index INTEGER, status TEXT NOT NULL CHECK(status IN ('open','completed','cancelled')),
        created_at TEXT NOT NULL, completed_at TEXT,
        UNIQUE(entry_uid, step_index)
      );
CREATE INDEX idx_todos_project ON todos(project);

INSERT INTO schema_migrations(version) VALUES (1),(2),(3),(4),(5);
