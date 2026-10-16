import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  type ProjectMetadata,
  type ProjectOverview,
  type Source,
  type StatusEntry,
  type StatusEntryInput,
  validateProjectMetadataInput,
  validateStatusEntry,
  ValidationError,
  toPortableStatusEntry,
  validateUid,
  parseTime,
  sources,
} from "./domain.js";

export type Ledger = Database.Database;
export type InsertResult = { entry: StatusEntry; inserted: boolean };
export type HistoryOptions = {
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

const migration1 = `
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

const migration2 = `
ALTER TABLE projects ADD COLUMN description TEXT;
ALTER TABLE projects ADD COLUMN notes TEXT;
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
      db.exec(migration1);
      db.prepare("INSERT INTO schema_migrations(version) VALUES (1)").run();
    }
    if (
      !db.prepare("SELECT 1 FROM schema_migrations WHERE version = 2").get()
    ) {
      db.exec(migration2);
      db.prepare("INSERT INTO schema_migrations(version) VALUES (2)").run();
    }
    if (
      !db.prepare("SELECT 1 FROM schema_migrations WHERE version = 3").get()
    ) {
      db.exec(`ALTER TABLE status_entries ADD COLUMN uid TEXT;
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
        CREATE INDEX idx_completion_target ON completion_events(target_uid, id DESC);`);
      for (const row of db.prepare("SELECT id FROM status_entries").all() as {
        id: number;
      }[]) {
        db.prepare("UPDATE status_entries SET uid = ? WHERE id = ?").run(
          randomUUID(),
          row.id,
        );
      }
      db.exec(`CREATE TRIGGER require_entry_uid BEFORE INSERT ON status_entries
        WHEN NEW.uid IS NULL
        BEGIN SELECT RAISE(ABORT, 'entry uid required; upgrade the writer'); END;`);
      db.prepare("INSERT INTO schema_migrations(version) VALUES (3)").run();
    }
  }).immediate();
  return db;
}

function entryFromRow(row: Record<string, unknown>): StatusEntry {
  return {
    id: row.id as number,
    uid: row.uid as string,
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
    source: row.source as Source,
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

function upsertProjectMetadata(
  db: Ledger,
  input: {
    project: string;
    displayName?: string;
    description?: string | null;
    notes?: string | null;
  },
): void {
  const existing = db
    .prepare("SELECT 1 FROM projects WHERE slug = ?")
    .get(input.project);
  if (!existing) {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO projects(slug, display_name, description, notes, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      input.project,
      input.displayName ?? input.project,
      input.description ?? null,
      input.notes ?? null,
      now,
    );
  } else {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (input.displayName !== undefined) {
      updates.push("display_name = ?");
      params.push(input.displayName);
    }
    if (input.description !== undefined) {
      updates.push("description = ?");
      params.push(input.description);
    }
    if (input.notes !== undefined) {
      updates.push("notes = ?");
      params.push(input.notes);
    }
    if (updates.length > 0) {
      params.push(input.project);
      db.prepare(
        `UPDATE projects SET ${updates.join(", ")} WHERE slug = ?`,
      ).run(...params);
    }
  }
}

export function setProjectMetadata(
  db: Ledger,
  value: unknown,
): ProjectMetadata {
  const input = validateProjectMetadataInput(value);
  return db.transaction(() => {
    upsertProjectMetadata(db, input);
    const row = db
      .prepare("SELECT * FROM projects WHERE slug = ?")
      .get(input.project) as Record<string, unknown>;
    return {
      project: row.slug as string,
      displayName: row.display_name as string,
      ...(row.description ? { description: row.description as string } : {}),
      ...(row.notes ? { notes: row.notes as string } : {}),
      createdAt: row.created_at as string,
    };
  })();
}

export function listProjects(
  db: Ledger,
  options: { query?: string } = {},
): ProjectOverview[] {
  const query = options.query?.trim().toLowerCase();
  const projects = db
    .prepare("SELECT * FROM projects ORDER BY slug ASC")
    .all() as Record<string, unknown>[];

  const latestStatuses = current(db);
  const statusMap = new Map<string, StatusEntry>();
  for (const entry of latestStatuses) {
    statusMap.set(entry.project, entry);
  }

  const overviews: ProjectOverview[] = projects.map((row) => {
    const slug = row.slug as string;
    const latestStatus = statusMap.get(slug);
    return {
      project: slug,
      displayName: row.display_name as string,
      ...(row.description ? { description: row.description as string } : {}),
      ...(row.notes ? { notes: row.notes as string } : {}),
      createdAt: row.created_at as string,
      ...(latestStatus ? { latestStatus } : {}),
    };
  });

  overviews.sort((a, b) => {
    const timeA = a.latestStatus?.occurredAt ?? a.createdAt;
    const timeB = b.latestStatus?.occurredAt ?? b.createdAt;
    if (timeA !== timeB) {
      return timeB.localeCompare(timeA);
    }
    return a.project.localeCompare(b.project);
  });

  if (!query) return overviews;

  return overviews.filter((overview) => {
    if (overview.project.toLowerCase().includes(query)) return true;
    if (overview.displayName.toLowerCase().includes(query)) return true;
    if (overview.description?.toLowerCase().includes(query)) return true;
    if (overview.notes?.toLowerCase().includes(query)) return true;
    if (overview.latestStatus) {
      const st = overview.latestStatus;
      const match =
        st.status.toLowerCase().includes(query) ||
        st.summary.toLowerCase().includes(query) ||
        (st.progress && st.progress.toLowerCase().includes(query)) ||
        st.tags.some((t) => t.toLowerCase().includes(query));
      if (match) return true;
    }
    return false;
  });
}

export function addStatus(
  db: Ledger,
  value: unknown,
  defaultSource: Source = "human",
  completes: string[] = [],
): InsertResult {
  const input = validateStatusEntry(value, defaultSource);
  return db
    .transaction(() => {
      const result = addValidatedStatus(db, input);
      for (const target of completes)
        changeCompletion(
          db,
          target,
          result.entry.uid,
          "complete",
          undefined,
          input.source,
        );
      return result;
    })
    .immediate();
}

function addValidatedStatus(
  db: Ledger,
  input: StatusEntryInput & { occurredAt: string; source: Source },
  recordedAt?: string,
): InsertResult {
  if (input.uid) {
    const existing = one(db, `${select} WHERE e.uid = ?`, input.uid);
    if (existing) {
      const candidate = toPortableStatusEntry({
        ...input,
        id: existing.id,
        recordedAt: existing.recordedAt,
      } as StatusEntry);
      if (
        !isDeepStrictEqual(toPortableStatusEntry(existing), candidate) ||
        (recordedAt !== undefined && recordedAt !== existing.recordedAt)
      )
        throw new ValidationError("conflicting entry uid");
      return { entry: existing, inserted: false };
    }
  }
  if (input.externalRef) {
    const existing = one(
      db,
      `${select} WHERE e.external_ref = ?`,
      input.externalRef,
    );
    if (existing) {
      if (input.uid)
        throw new ValidationError("externalRef conflicts with portable uid");
      if (existing.project !== input.project)
        throw new ValidationError(
          `externalRef is already used by project ${existing.project}`,
        );
      return { entry: existing, inserted: false };
    }
  }
  const now = recordedAt ?? new Date().toISOString();
  upsertProjectMetadata(db, { project: input.project });

  const project = db
    .prepare("SELECT id FROM projects WHERE slug = ?")
    .get(input.project) as { id: number };
  const result = db
    .prepare(
      `INSERT INTO status_entries(project_id, status, summary, progress, blockers_json, next_steps_json, decisions_json, tags_json, occurred_at, recorded_at, source, external_ref, uid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.uid ?? randomUUID(),
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
  return rows.map((row) => annotateEntry(db, entryFromRow(row)));
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
  return rows.map((row) => annotateEntry(db, entryFromRow(row)));
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

export function countEntries(db: Ledger, project?: string): number {
  if (project) {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS count FROM status_entries e JOIN projects p ON p.id = e.project_id WHERE p.slug = ?",
      )
      .get(project) as { count: number };
    return row.count;
  }
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM status_entries")
    .get() as { count: number };
  return row.count;
}

export type CompletionEvent = {
  uid: string;
  targetUid: string;
  byUid: string;
  previousUid: string | null;
  action: "complete" | "revoke";
  reason?: string;
  recordedAt: string;
  source: Source;
};

function completionFromRow(row: Record<string, unknown>): CompletionEvent {
  return {
    uid: row.uid as string,
    targetUid: row.target_uid as string,
    byUid: row.by_uid as string,
    previousUid: row.previous_uid as string | null,
    action: row.action as CompletionEvent["action"],
    ...(row.reason === null ? {} : { reason: row.reason as string }),
    recordedAt: row.recorded_at as string,
    source: row.source as Source,
  };
}

function latestCompletion(
  db: Ledger,
  uid: string,
): CompletionEvent | undefined {
  const row = db
    .prepare(
      "SELECT * FROM completion_events WHERE target_uid = ? ORDER BY id DESC LIMIT 1",
    )
    .get(uid) as Record<string, unknown> | undefined;
  return row && completionFromRow(row);
}

export function getEntry(db: Ledger, ref: string): StatusEntry | undefined {
  const entry = /^\d+$/.test(ref)
    ? one(db, `${select} WHERE e.id = ?`, ref)
    : one(db, `${select} WHERE e.uid = ?`, ref);
  return entry && annotateEntry(db, entry);
}

function annotateEntry(db: Ledger, entry: StatusEntry): StatusEntry {
  const latest = latestCompletion(db, entry.uid);
  const followUp =
    latest?.action === "complete"
      ? one(db, `${select} WHERE e.uid = ?`, latest.byUid)
      : undefined;
  const newest = one(
    db,
    `${select} WHERE p.slug = ? ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1`,
    entry.project,
  );
  return {
    ...entry,
    effectiveStatus: followUp ? "completed" : entry.status,
    isCurrent: newest?.id === entry.id,
    ...(followUp && latest
      ? {
          completedBy: {
            uid: followUp.uid,
            id: followUp.id,
            summary: followUp.summary,
            occurredAt: followUp.occurredAt,
            recordedAt: latest.recordedAt,
          },
        }
      : {}),
  };
}

function validateCompletionPair(
  db: Ledger,
  targetRef: string,
  byRef: string,
): [StatusEntry, StatusEntry] {
  const target = getEntry(db, targetRef);
  const by = getEntry(db, byRef);
  if (!target || !by) throw new ValidationError("completion entry not found");
  if (target.project !== by.project)
    throw new ValidationError(
      "completion entries must belong to the same project",
    );
  if (target.occurredAt >= by.occurredAt)
    throw new ValidationError(
      "completion target must have a strictly earlier occurrence time",
    );
  return [target, by];
}

function insertCompletion(db: Ledger, event: CompletionEvent): void {
  const existing = db
    .prepare("SELECT * FROM completion_events WHERE uid = ?")
    .get(event.uid) as Record<string, unknown> | undefined;
  if (existing) {
    if (!isDeepStrictEqual(completionFromRow(existing), event))
      throw new ValidationError("conflicting completion uid");
    return;
  }
  validateCompletionPair(db, event.targetUid, event.byUid);
  const latest = latestCompletion(db, event.targetUid);
  // A per-target chain preserves event order and detects divergent imported histories.
  if ((latest?.uid ?? null) !== event.previousUid)
    throw new ValidationError(
      "completion event order conflicts with target history",
    );
  if (event.action === "complete" && latest?.action === "complete")
    throw new ValidationError("target already completed; revoke first");
  if (
    event.action === "revoke" &&
    (latest?.action !== "complete" || latest.byUid !== event.byUid)
  )
    throw new ValidationError("no matching active completion to revoke");
  db.prepare(
    `INSERT INTO completion_events(uid, target_uid, by_uid, previous_uid, action, reason, recorded_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.uid,
    event.targetUid,
    event.byUid,
    event.previousUid,
    event.action,
    event.reason ?? null,
    event.recordedAt,
    event.source,
  );
}

export function changeCompletion(
  db: Ledger,
  targetRef: string,
  byRef: string,
  action: CompletionEvent["action"] = "complete",
  reason?: string,
  source: Source = "human",
): CompletionEvent {
  if (action !== "complete" && action !== "revoke")
    throw new ValidationError("invalid completion action");
  if (!sources.includes(source)) throw new ValidationError("source is invalid");
  if (
    reason !== undefined &&
    (typeof reason !== "string" || !reason.trim() || reason.length > 2000)
  )
    throw new ValidationError(
      "reason must be a non-empty string of at most 2000 characters",
    );
  if (action === "revoke" && !reason)
    throw new ValidationError("revocation requires a reason");
  return db
    .transaction(() => {
      const [target, by] = validateCompletionPair(db, targetRef, byRef);
      const latest = latestCompletion(db, target.uid);
      if (
        action === "complete" &&
        latest?.action === "complete" &&
        latest.byUid === by.uid
      )
        return latest;
      const event: CompletionEvent = {
        uid: randomUUID(),
        targetUid: target.uid,
        byUid: by.uid,
        previousUid: latest?.uid ?? null,
        action,
        ...(reason ? { reason: reason.trim() } : {}),
        source,
        recordedAt: new Date().toISOString(),
      };
      insertCompletion(db, event);
      return event;
    })
    .immediate();
}

export function exportLedger(db: Ledger, project?: string) {
  return db.transaction(() => {
    const entries = (
      db
        .prepare(
          `${select}${project ? " WHERE p.slug = ?" : ""} ORDER BY e.occurred_at, e.id`,
        )
        .all(...(project ? [project] : [])) as Record<string, unknown>[]
    )
      .map(entryFromRow)
      .map((entry) => ({
        ...toPortableStatusEntry(entry),
        recordedAt: entry.recordedAt,
      }));
    const rows = db
      .prepare(
        `SELECT c.* FROM completion_events c JOIN status_entries e ON e.uid = c.target_uid JOIN projects p ON p.id = e.project_id ${project ? "WHERE p.slug = ?" : ""} ORDER BY c.id`,
      )
      .all(...(project ? [project] : [])) as Record<string, unknown>[];
    return { version: 2, entries, completions: rows.map(completionFromRow) };
  })();
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError("expected an object");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result))
    if (!keys.includes(key)) throw new ValidationError(`unknown field: ${key}`);
  return result;
}

function validateCompletionEvent(value: unknown): CompletionEvent {
  const row = record(value, [
    "uid",
    "targetUid",
    "byUid",
    "previousUid",
    "action",
    "reason",
    "recordedAt",
    "source",
  ]);
  if (row.action !== "complete" && row.action !== "revoke")
    throw new ValidationError("invalid completion action");
  if (!sources.includes(row.source as Source))
    throw new ValidationError("source is invalid");
  if (
    row.reason !== undefined &&
    (typeof row.reason !== "string" ||
      !row.reason.trim() ||
      row.reason.length > 2000)
  )
    throw new ValidationError("invalid completion reason");
  if (row.action === "revoke" && !row.reason)
    throw new ValidationError("revocation requires a reason");
  return {
    uid: validateUid(row.uid),
    targetUid: validateUid(row.targetUid),
    byUid: validateUid(row.byUid),
    previousUid: row.previousUid === null ? null : validateUid(row.previousUid),
    action: row.action,
    ...(row.reason === undefined ? {} : { reason: row.reason as string }),
    recordedAt: parseTime(row.recordedAt, "recordedAt"),
    source: row.source as Source,
  };
}

export function importLedger(db: Ledger, values: unknown[]): InsertResult[] {
  // Both legacy entries and versioned bundles are accepted atomically, including JSONL.
  return db
    .transaction(() => {
      const results: InsertResult[] = [];
      for (const value of values) {
        if (value && typeof value === "object" && "version" in value) {
          const bundle = record(value, ["version", "entries", "completions"]);
          if (
            bundle.version !== 2 ||
            !Array.isArray(bundle.entries) ||
            !Array.isArray(bundle.completions)
          )
            throw new ValidationError("invalid ledger bundle");
          for (const item of bundle.entries) {
            if (!item || typeof item !== "object" || Array.isArray(item))
              throw new ValidationError("entry must be an object");
            const { recordedAt, ...input } = item as Record<string, unknown>;
            validateUid(input.uid);
            results.push(
              addValidatedStatus(
                db,
                validateStatusEntry(input, "import"),
                parseTime(recordedAt, "recordedAt"),
              ),
            );
          }
          for (const event of bundle.completions)
            insertCompletion(db, validateCompletionEvent(event));
        } else
          results.push(
            addValidatedStatus(db, validateStatusEntry(value, "import")),
          );
      }
      return results;
    })
    .immediate();
}
