import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  type Source,
  type StatusEntry,
  type StatusEntryInput,
  validateStatusEntry,
  ValidationError,
} from "./domain.js";

export type Ledger = Database.Database;
export type InsertResult = { entry: StatusEntry; inserted: boolean };
export type HistoryOptions = {
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

const migration = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS status_entries (
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
);
CREATE INDEX IF NOT EXISTS idx_status_entries_project_occurred ON status_entries(project_id, occurred_at DESC, id DESC);
`;

export function databasePath(): string {
  return (
    process.env.PMGR_DB_PATH ||
    resolve(homedir(), ".local", "share", "project-mgr", "project-mgr.sqlite")
  );
}

export function openLedger(path = databasePath()): Ledger {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)",
  );
  db.transaction(() => {
    if (
      !db.prepare("SELECT 1 FROM schema_migrations WHERE version = 1").get()
    ) {
      db.exec(migration);
      db.prepare("INSERT INTO schema_migrations(version) VALUES (1)").run();
    }
  }).immediate();
  return db;
}

function entryFromRow(row: Record<string, unknown>): StatusEntry {
  return {
    id: row.id as number,
    project: row.project as string,
    status: row.status as StatusEntry["status"],
    summary: row.summary as string,
    ...(row.progress ? { progress: row.progress as string } : {}),
    blockers: JSON.parse(row.blockers_json as string) as string[],
    nextSteps: JSON.parse(row.next_steps_json as string) as string[],
    decisions: JSON.parse(row.decisions_json as string) as string[],
    tags: JSON.parse(row.tags_json as string) as string[],
    occurredAt: row.occurred_at as string,
    recordedAt: row.recorded_at as string,
    source: row.source as StatusEntry["source"],
    ...(row.external_ref ? { externalRef: row.external_ref as string } : {}),
  };
}

const select = `SELECT e.*, p.slug AS project FROM status_entries e JOIN projects p ON p.id = e.project_id`;
function one(
  db: Ledger,
  sql: string,
  ...params: unknown[]
): StatusEntry | undefined {
  const row = db.prepare(sql).get(...params) as
    Record<string, unknown> | undefined;
  return row && entryFromRow(row);
}

export function addStatus(
  db: Ledger,
  value: unknown,
  defaultSource: Source = "human",
): InsertResult {
  const input = validateStatusEntry(value, defaultSource);
  return db.transaction(() => addValidatedStatus(db, input))();
}

function addValidatedStatus(
  db: Ledger,
  input: StatusEntryInput & { occurredAt: string; source: Source },
): InsertResult {
  if (input.externalRef) {
    const existing = one(
      db,
      `${select} WHERE e.external_ref = ?`,
      input.externalRef,
    );
    if (existing) {
      if (existing.project !== input.project)
        throw new ValidationError(
          `externalRef is already used by project ${existing.project}`,
        );
      return { entry: existing, inserted: false };
    }
  }
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO projects(slug, display_name, created_at) VALUES (?, ?, ?) ON CONFLICT(slug) DO NOTHING",
  ).run(input.project, input.project, now);
  const project = db
    .prepare("SELECT id FROM projects WHERE slug = ?")
    .get(input.project) as { id: number };
  const result = db
    .prepare(
      `INSERT INTO status_entries(project_id, status, summary, progress, blockers_json, next_steps_json, decisions_json, tags_json, occurred_at, recorded_at, source, external_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      project.id,
      input.status,
      input.summary,
      input.progress ?? null,
      JSON.stringify(input.blockers),
      JSON.stringify(input.nextSteps),
      JSON.stringify(input.decisions),
      JSON.stringify(input.tags),
      input.occurredAt,
      now,
      input.source,
      input.externalRef ?? null,
    );
  return {
    entry: one(
      db,
      `${select} WHERE e.id = ?`,
      result.lastInsertRowid,
    ) as StatusEntry,
    inserted: true,
  };
}

export function importStatuses(db: Ledger, values: unknown[]): InsertResult[] {
  const inputs = values.map((value) => validateStatusEntry(value, "import"));
  return db.transaction(() =>
    inputs.map((input) => addValidatedStatus(db, input)),
  )();
}

export function current(db: Ledger, project?: string): StatusEntry[] {
  const where = project ? " AND p.slug = ?" : "";
  const rows = db
    .prepare(
      `${select} WHERE e.id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY occurred_at DESC, id DESC) AS position FROM status_entries) WHERE position = 1)${where} ORDER BY e.occurred_at DESC, e.id DESC`,
    )
    .all(...(project ? [project] : [])) as Record<string, unknown>[];
  return rows.map(entryFromRow);
}

export function history(
  db: Ledger,
  project?: string,
  options: HistoryOptions = {},
): StatusEntry[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (project) {
    clauses.push("p.slug = ?");
    params.push(project);
  }
  if (options.since) {
    clauses.push("e.occurred_at >= ?");
    params.push(options.since);
  }
  if (options.until) {
    clauses.push("e.occurred_at <= ?");
    params.push(options.until);
  }
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const rows = db
    .prepare(
      `${select}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY e.occurred_at DESC, e.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Record<string, unknown>[];
  return rows.map(entryFromRow);
}

export function at(
  db: Ledger,
  project: string,
  occurredAt: string,
): StatusEntry | undefined {
  return one(
    db,
    `${select} WHERE p.slug = ? AND e.occurred_at <= ? ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1`,
    project,
    occurredAt,
  );
}
