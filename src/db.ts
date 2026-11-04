import assert from "node:assert/strict";
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
export type AddStatusInput = StatusEntryInput & {
  nextMode?: "carry" | "replace";
  closeTodos?: { uid: string; status: "completed" | "cancelled" }[];
};
export type OpenWorkItem =
  | {
      kind: "todo";
      uid: string;
      title: string;
      project: string | null;
      pinned: boolean;
      pinIndex: number | null;
      createdAt: string;
      entryUid: string | null;
      startAt: string | null;
      dueAt: string | null;
      content: string | null;
    }
  | {
      kind: "legacy-step";
      project: string;
      entryUid: string;
      stepIndex: number;
      title: string;
      pinned: true;
      pinIndex: number;
    };
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
    if (
      !db.prepare("SELECT 1 FROM schema_migrations WHERE version = 4").get()
    ) {
      db.exec(`ALTER TABLE status_entries ADD COLUMN next_steps_source_uid TEXT REFERENCES status_entries(uid);
        CREATE TABLE todos (
        uid TEXT PRIMARY KEY, title TEXT NOT NULL,
        project TEXT REFERENCES projects(slug),
        entry_uid TEXT REFERENCES status_entries(uid),
        step_index INTEGER, status TEXT NOT NULL CHECK(status IN ('open','completed','cancelled')),
        created_at TEXT NOT NULL, completed_at TEXT,
        UNIQUE(entry_uid, step_index)
      );
      CREATE INDEX idx_todos_project ON todos(project);
      INSERT INTO schema_migrations(version) VALUES (4);`);
    }
    if (
      !db.prepare("SELECT 1 FROM schema_migrations WHERE version = 5").get()
    ) {
      db.exec(`ALTER TABLE status_entries ADD COLUMN next_todo_uids_json TEXT;
        INSERT INTO schema_migrations(version) VALUES (5);`);
    }
    if (
      !db.prepare("SELECT 1 FROM schema_migrations WHERE version = 6").get()
    ) {
      db.exec(`ALTER TABLE todos ADD COLUMN start_at TEXT DEFAULT NULL;
        ALTER TABLE todos ADD COLUMN due_at TEXT DEFAULT NULL;
        ALTER TABLE todos ADD COLUMN content TEXT DEFAULT NULL;
        INSERT INTO schema_migrations(version) VALUES (6);`);
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
    // NULL means legacy (field absent). An explicit JSON array, including [], is new format.
    ...(row.next_todo_uids_json == null
      ? {}
      : {
          nextTodoUids: JSON.parse(
            row.next_todo_uids_json as string,
          ) as string[],
        }),
    ...(row.next_steps_source_uid
      ? { nextStepsSourceUid: row.next_steps_source_uid as string }
      : {}),
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

function linkCompletions(
  db: Ledger,
  targets: string[],
  byUid: string,
  source: Source,
): void {
  for (const target of targets)
    changeCompletion(db, target, byUid, "complete", undefined, source);
}

function existingIdentity(
  db: Ledger,
  input: StatusEntryInput & { occurredAt: string; source: Source },
  recordedAt?: string,
  textRetry = false,
  carry = false,
): InsertResult | undefined {
  if (input.uid) {
    const existing = one(db, `${select} WHERE e.uid = ?`, input.uid);
    if (existing) {
      const candidate = toPortableStatusEntry({
        ...input,
        id: existing.id,
        recordedAt: existing.recordedAt,
      } as StatusEntry);
      // Text/ref equivalence is only for addStatus sugar retries, not imports.
      const sameWrite =
        isDeepStrictEqual(toPortableStatusEntry(existing), candidate) ||
        (textRetry && textRefEquivalent(db, existing, input, carry));
      if (
        !sameWrite ||
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
  return undefined;
}

function textRefEquivalent(
  db: Ledger,
  existing: StatusEntry,
  input: StatusEntryInput & { occurredAt: string; source: Source },
  carry = false,
): boolean {
  // Retry against stored pins, never today's open status or latest snapshot.
  if (existing.nextTodoUids === undefined) {
    if (!carry || input.nextTodoUids !== undefined || input.nextSteps?.length)
      return false;
    return isDeepStrictEqual(
      toPortableStatusEntry(existing),
      toPortableStatusEntry({
        ...input,
        nextSteps: existing.nextSteps,
        nextStepsSourceUid: existing.nextStepsSourceUid,
      } as StatusEntry),
    );
  }
  if (!carry && input.nextTodoUids !== undefined) return false;
  assert.ok(input.nextSteps);
  const titles = input.nextSteps;
  const size = input.nextTodoUids?.length ?? titles.length;
  if (
    carry
      ? size > existing.nextTodoUids.length
      : size !== existing.nextTodoUids.length
  )
    return false;
  const candidate = toPortableStatusEntry({
    ...input,
    nextSteps: [],
    nextTodoUids: existing.nextTodoUids,
    id: existing.id,
    recordedAt: existing.recordedAt,
  } as StatusEntry);
  if (!isDeepStrictEqual(toPortableStatusEntry(existing), candidate))
    return false;
  const suffix = existing.nextTodoUids.slice(
    existing.nextTodoUids.length - size,
  );
  return suffix.every((uid, index) => {
    if (input.nextTodoUids !== undefined)
      return uid === input.nextTodoUids[index];
    const todo = todoByUid(db, uid);
    return todo !== undefined && todo.title === titles[index];
  });
}

export function addStatus(
  db: Ledger,
  value: unknown,
  defaultSource: Source = "human",
  completes: string[] = [],
): InsertResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError("entry must be an object");
  const {
    nextMode = "replace",
    closeTodos = [],
    ...fields
  } = value as Record<string, unknown>;
  if (nextMode !== "carry" && nextMode !== "replace")
    throw new ValidationError("invalid nextMode");
  if (!Array.isArray(closeTodos))
    throw new ValidationError("closeTodos must be an array");
  const input = validateStatusEntry(fields, defaultSource);
  if (input.nextStepsSourceUid)
    throw new ValidationError("new snapshots cannot set nextStepsSourceUid");
  return db
    .transaction(() => {
      const replay = existingIdentity(
        db,
        input,
        undefined,
        true,
        nextMode === "carry",
      );
      if (replay) {
        linkCompletions(db, completes, replay.entry.uid, input.source);
        return replay;
      }
      const latest = current(db, input.project)[0];
      const preserved = latest
        ? preservedNextWork(db, latest)
        : { nextSteps: [], nextTodoUids: [] };
      // Without refs, latest is a pending legacy snapshot: pin its converted indices.
      const legacy =
        preserved.nextTodoUids === undefined
          ? legacySource(db, latest!)
          : undefined;
      const pins =
        preserved.nextTodoUids ??
        legacy!.nextSteps.flatMap((_, index) => {
          const todo = stepTodo(db, legacy!.uid, index);
          return todo ? [todo.uid] : [];
        });
      const closing = new Map<string, "completed" | "cancelled">();
      for (const value of closeTodos) {
        const close = record(value, ["uid", "status"]);
        const uid = validateUid(close.uid);
        if (close.status !== "completed" && close.status !== "cancelled")
          throw new ValidationError("invalid closeTodos status");
        if (
          (closing.has(uid) && closing.get(uid) !== close.status) ||
          input.nextTodoUids?.includes(uid)
        )
          throw new ValidationError(
            "cannot close a Todo in both statuses or also pin it",
          );
        const todo = todoByUid(db, uid);
        if (!todo || (todo.project !== input.project && !pins.includes(uid)))
          throw new ValidationError(
            `todo ${uid} does not belong to project ${input.project} or its current pins`,
          );
        closing.set(uid, close.status);
      }
      for (const [uid, status] of closing) updateTodo(db, uid, { status });
      if (nextMode === "carry" && preserved.nextTodoUids === undefined) {
        if (input.nextSteps.length || input.nextTodoUids !== undefined)
          throw new ValidationError(
            `project ${input.project} has unconverted legacy next steps; run pmgr todo-convert --project ${input.project} or pass --replace-next`,
          );
        const result = addValidatedStatus(db, { ...input, ...preserved });
        linkCompletions(db, completes, result.entry.uid, input.source);
        return result;
      }
      if (input.nextTodoUids !== undefined)
        assertSnapshotRefs(db, input.project, input.nextTodoUids);
      // Freeze candidates before creating this write's Todos: repeated new titles stay separate.
      // Same-project open Todos plus unassigned open Todos already pinned here.
      const candidates = [
        ...listTodos(db, input.project, { status: "open" }),
        ...pins.flatMap((pin) => {
          const todo = todoByUid(db, pin);
          return todo?.project === null && todo.status === "open" ? [todo] : [];
        }),
      ];
      candidates.sort(
        (a, b) =>
          Number(pins.includes(b.uid)) - Number(pins.includes(a.uid)) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.uid.localeCompare(b.uid),
      );
      const uid = input.uid ?? randomUUID();
      const newTodos: { uid: string; title: string }[] = [];
      const resolved =
        input.nextTodoUids ??
        input.nextSteps.map((title, index) => {
          const match =
            input.nextSteps.indexOf(title) === index
              ? candidates.find((todo) => todo.title === title)
              : undefined;
          if (match) return match.uid;
          const uid = randomUUID();
          newTodos.push({ uid, title });
          return uid;
        });
      const nextTodoUids = [
        ...new Set([
          ...(nextMode === "carry"
            ? pins.filter((uid) => todoByUid(db, uid)?.status === "open")
            : []),
          ...resolved,
        ]),
      ];
      if (nextTodoUids.length > 100)
        throw new ValidationError(
          "nextTodoUids must be an array of at most 100 uuids",
        );
      const recordedAt = new Date().toISOString();
      const result = addValidatedStatus(
        db,
        { ...input, uid, nextSteps: [], nextTodoUids },
        recordedAt,
      );
      assert.equal(result.inserted, true);
      newTodos.forEach(({ uid, title }) => {
        insertTodo(db, {
          uid,
          title,
          project: result.entry.project,
          entryUid: result.entry.uid,
          // Provenance indexes the final snapshot, including carried/reused pins.
          stepIndex: nextTodoUids.indexOf(uid),
          status: "open",
          createdAt: recordedAt,
          completedAt: null,
          startAt: null,
          dueAt: null,
          content: null,
        });
      });
      linkCompletions(db, completes, result.entry.uid, input.source);
      return result;
    })
    .immediate();
}

function addValidatedStatus(
  db: Ledger,
  input: StatusEntryInput & { occurredAt: string; source: Source },
  recordedAt?: string,
): InsertResult {
  const existing = existingIdentity(db, input, recordedAt);
  if (existing) return existing;
  if (input.nextStepsSourceUid) {
    const origin = getEntry(db, input.nextStepsSourceUid);
    if (
      !origin ||
      origin.nextStepsSourceUid !== undefined ||
      origin.project !== input.project ||
      origin.occurredAt >= input.occurredAt ||
      !isDeepStrictEqual(origin.nextSteps, input.nextSteps)
    )
      throw new ValidationError("invalid next step provenance");
  }
  const now = recordedAt ?? new Date().toISOString();
  upsertProjectMetadata(db, { project: input.project });

  const project = db
    .prepare("SELECT id FROM projects WHERE slug = ?")
    .get(input.project) as { id: number };
  const result = db
    .prepare(
      `INSERT INTO status_entries(project_id, status, summary, progress, blockers_json, next_steps_json, decisions_json, tags_json, occurred_at, recorded_at, source, external_ref, uid, next_steps_source_uid, next_todo_uids_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.nextStepsSourceUid ?? null,
      input.nextTodoUids === undefined
        ? null
        : JSON.stringify(input.nextTodoUids),
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
  return db.transaction(() => {
    const results = inputs.map((input) => addValidatedStatus(db, input));
    // Entry-only imports declare no Todos, so every ref is an omitted dependency.
    const payloadTodos = new Set<string>();
    for (const result of results)
      assertSnapshotRefs(
        db,
        result.entry.project,
        result.entry.nextTodoUids,
        payloadTodos,
      );
    return results;
  })();
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

/** Per-project open work from one current() and one Todo scan; no cross-project dedupe. */
export function openWorkByProject(
  db: Ledger,
  project?: string,
): { groups: Map<string, OpenWorkItem[]>; unassigned: Todo[] } {
  const latest = current(db, project);
  const byProject = new Map<string, Todo[]>();
  const unassigned: Todo[] = [];
  for (const todo of listTodos(db, project)) {
    if (todo.project === null) unassigned.push(todo);
    else
      byProject.set(todo.project, [
        ...(byProject.get(todo.project) ?? []),
        todo,
      ]);
  }
  const names =
    project !== undefined
      ? [project]
      : [
          ...latest.map((entry) => entry.project),
          ...[...byProject.keys()]
            .filter((name) => !latest.some((entry) => entry.project === name))
            .sort(),
        ];
  const groups = new Map<string, OpenWorkItem[]>();
  for (const name of names) {
    const items: OpenWorkItem[] = [];
    const seen = new Set<string>();
    const add = (todo: Todo, pinIndex: number | null) => {
      if (todo.status !== "open" || seen.has(todo.uid)) return;
      seen.add(todo.uid);
      items.push({
        kind: "todo",
        uid: todo.uid,
        title: todo.title,
        project: name,
        pinned: pinIndex !== null,
        pinIndex,
        createdAt: todo.createdAt,
        entryUid: todo.entryUid,
        startAt: todo.startAt,
        dueAt: todo.dueAt,
        content: todo.content,
      });
    };
    const entry = latest.find((entry) => entry.project === name);
    if (entry?.nextTodoUids !== undefined) {
      entry.nextTodoUids.forEach((uid, index) => {
        const todo = todoByUid(db, uid);
        if (todo) add(todo, index);
      });
    } else if (entry) {
      const source = legacySource(db, entry);
      source.nextSteps.forEach((title, index) => {
        const todo = stepTodo(db, source.uid, index);
        if (todo) add(todo, index);
        else
          items.push({
            kind: "legacy-step",
            project: name,
            entryUid: source.uid,
            stepIndex: index,
            title,
            pinned: true,
            pinIndex: index,
          });
      });
    }
    for (const todo of byProject.get(name) ?? []) add(todo, null);
    groups.set(name, items);
  }
  return { groups, unassigned };
}

export function openWork(db: Ledger, project?: string): OpenWorkItem[] {
  const { groups, unassigned } = openWorkByProject(db, project);
  if (project !== undefined) return groups.get(project)!;
  // Globally, a Todo pinned by several projects appears only under the first.
  const items: OpenWorkItem[] = [];
  const seen = new Set<string>();
  for (const group of groups.values())
    for (const item of group) {
      if (item.kind === "todo") {
        if (seen.has(item.uid)) continue;
        seen.add(item.uid);
      }
      items.push(item);
    }
  for (const todo of unassigned)
    if (todo.status === "open" && !seen.has(todo.uid))
      items.push({
        kind: "todo",
        uid: todo.uid,
        title: todo.title,
        project: null,
        pinned: false,
        pinIndex: null,
        createdAt: todo.createdAt,
        entryUid: todo.entryUid,
        startAt: todo.startAt,
        dueAt: todo.dueAt,
        content: todo.content,
      });
  return items;
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
  // Stored snapshot only. Refs may be present; live Todo titles are not historical.
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
    ...(entry.nextTodoUids !== undefined
      ? { nextTodos: entry.nextTodoUids.map((uid) => resolveNextTodo(db, uid)) }
      : {}),
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
    const todos = project ? todosVisibleToProject(db, project) : listTodos(db);
    const version = ledgerVersion(entries, todos);
    return {
      version,
      entries,
      completions: rows.map(completionFromRow),
      ...(version >= 3 ? { todos } : {}),
    };
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

function declaredTodoUids(values: unknown[]): Set<string> {
  const uids = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== "object" || !("todos" in value)) continue;
    const todos = (value as { todos?: unknown }).todos;
    if (!Array.isArray(todos)) continue;
    for (const todo of todos) {
      if (
        todo &&
        typeof todo === "object" &&
        "uid" in todo &&
        typeof (todo as { uid?: unknown }).uid === "string"
      )
        uids.add((todo as { uid: string }).uid);
    }
  }
  return uids;
}

export function importLedger(db: Ledger, values: unknown[]): InsertResult[] {
  // Both legacy entries and versioned bundles are accepted atomically, including JSONL.
  return db
    .transaction(() => {
      const results: InsertResult[] = [];
      // Refs must name Todos declared in this payload, not only rows already stored.
      const payloadTodos = declaredTodoUids(values);
      for (const value of values) {
        if (value && typeof value === "object" && "version" in value) {
          const bundle = record(value, [
            "version",
            "entries",
            "completions",
            "todos",
          ]);
          const version = bundle.version;
          if (
            (version !== 2 &&
              version !== 3 &&
              version !== 4 &&
              version !== 5) ||
            ((version === 3 || version === 4 || version === 5) &&
              !Array.isArray(bundle.todos)) ||
            (version === 2 && bundle.todos !== undefined) ||
            !Array.isArray(bundle.entries) ||
            !Array.isArray(bundle.completions)
          )
            throw new ValidationError("invalid ledger bundle");
          const imported: StatusEntry[] = [];
          for (const item of bundle.entries) {
            if (!item || typeof item !== "object" || Array.isArray(item))
              throw new ValidationError("entry must be an object");
            const { recordedAt, ...input } = item as Record<string, unknown>;
            validateUid(input.uid);
            const result = addValidatedStatus(
              db,
              validateStatusEntry(input, "import"),
              parseTime(recordedAt, "recordedAt"),
            );
            imported.push(result.entry);
            results.push(result);
          }
          for (const event of bundle.completions)
            insertCompletion(db, validateCompletionEvent(event));
          if (version === 3 || version === 4 || version === 5)
            for (const todo of bundle.todos as unknown[])
              importTodo(db, todo, version);
          for (const entry of imported)
            assertSnapshotRefs(
              db,
              entry.project,
              entry.nextTodoUids,
              payloadTodos,
            );
        } else {
          const result = addValidatedStatus(
            db,
            validateStatusEntry(value, "import"),
          );
          results.push(result);
          assertSnapshotRefs(
            db,
            result.entry.project,
            result.entry.nextTodoUids,
            payloadTodos,
          );
        }
      }
      return results;
    })
    .immediate();
}

export type Todo = {
  uid: string;
  title: string;
  project: string | null;
  entryUid: string | null;
  stepIndex: number | null;
  status: "open" | "completed" | "cancelled";
  createdAt: string;
  completedAt: string | null;
  startAt: string | null;
  dueAt: string | null;
  content: string | null;
};
const todoSelect = `SELECT uid, title, project, entry_uid AS entryUid,
  step_index AS stepIndex, status, created_at AS createdAt, completed_at AS completedAt, start_at AS startAt, due_at AS dueAt, content FROM todos`;

function ledgerVersion(
  entries: { nextTodoUids?: string[]; nextStepsSourceUid?: string }[],
  todos: unknown[],
): 2 | 3 | 4 | 5 {
  if (todos.length > 0) return 5;
  if (entries.some((entry) => entry.nextTodoUids !== undefined)) return 4;
  if (entries.some((entry) => entry.nextStepsSourceUid !== undefined)) return 3;
  return 2;
}

function todosVisibleToProject(db: Ledger, project: string): Todo[] {
  return db
    .prepare(
      `${todoSelect} WHERE project = ?
        OR uid IN (
          SELECT j.value FROM status_entries e
          JOIN projects p ON p.id = e.project_id
          JOIN json_each(e.next_todo_uids_json) j
          WHERE p.slug = ? AND e.next_todo_uids_json IS NOT NULL
        )
        ORDER BY created_at, uid`,
    )
    .all(project, project) as Todo[];
}

function todoByUid(db: Ledger, uid: string): Todo | undefined {
  return db.prepare(todoSelect + " WHERE uid = ?").get(uid) as Todo | undefined;
}

function resolveNextTodo(
  db: Ledger,
  uid: string,
): {
  uid: string;
  title: string;
  status: Todo["status"];
  project: string | null;
} {
  const todo = todoByUid(db, uid);
  if (!todo) return { uid, title: uid, status: "open", project: null };
  return {
    uid: todo.uid,
    title: todo.title,
    status: todo.status,
    project: todo.project,
  };
}

function assertSnapshotRefs(
  db: Ledger,
  project: string,
  uids: string[] | undefined,
  payloadTodos?: Set<string>,
): void {
  if (uids === undefined) return;
  for (const uid of uids) {
    const todo = todoByUid(db, uid);
    if (!todo) throw new ValidationError("dangling next todo uid");
    if (todo.project !== null && todo.project !== project)
      throw new ValidationError("cross-project next todo ref");
    if (payloadTodos && !payloadTodos.has(uid))
      throw new ValidationError("dangling next todo uid");
  }
}

function todoIsReferenced(db: Ledger, uid: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 AS found FROM status_entries, json_each(next_todo_uids_json)
         WHERE next_todo_uids_json IS NOT NULL AND json_each.value = ? LIMIT 1`,
      )
      .get(uid) !== undefined
  );
}

function stepTodo(
  db: Ledger,
  entryUid: string,
  index: number,
): Todo | undefined {
  return db
    .prepare(todoSelect + " WHERE entry_uid = ? AND step_index = ?")
    .get(entryUid, index) as Todo | undefined;
}

function legacySource(db: Ledger, entry: StatusEntry): StatusEntry {
  if (!entry.nextStepsSourceUid) return entry;
  const origin = getEntry(db, entry.nextStepsSourceUid);
  assert.ok(origin);
  assert.equal(origin.nextStepsSourceUid, undefined);
  return origin;
}

function preservedNextWork(
  db: Ledger,
  latest: StatusEntry,
): Pick<StatusEntryInput, "nextSteps" | "nextStepsSourceUid" | "nextTodoUids"> {
  if (latest.nextTodoUids !== undefined)
    return { nextSteps: [], nextTodoUids: [...latest.nextTodoUids] };
  const source = legacySource(db, latest);
  const pending = source.nextSteps.some(
    (_, index) => stepTodo(db, source.uid, index) === undefined,
  );
  if (pending)
    return {
      nextSteps: [...source.nextSteps],
      nextStepsSourceUid: source.uid,
    };
  return {
    nextSteps: [],
    nextTodoUids: source.nextSteps.map((_, index) => {
      const todo = stepTodo(db, source.uid, index);
      assert.ok(todo);
      return todo.uid;
    }),
  };
}

export function listTodos(
  db: Ledger,
  project?: string,
  options: { status?: Todo["status"] } = {},
): Todo[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (project) {
    clauses.push("project = ?");
    params.push(project);
  }
  if (options.status !== undefined) {
    if (!["open", "completed", "cancelled"].includes(options.status))
      throw new ValidationError("invalid todo status");
    clauses.push("status = ?");
    params.push(options.status);
  }
  const rows = db
    .prepare(
      todoSelect +
        (clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "") +
        " ORDER BY created_at, uid",
    )
    .all(...params) as Todo[];
  const pins =
    options.status === "open" && project
      ? current(db, project)[0]?.nextTodoUids
      : undefined;
  if (pins?.length) {
    const rank = new Map(pins.map((uid, index) => [uid, index]));
    rows.sort((left, right) => {
      const leftRank = rank.get(left.uid) ?? pins.length;
      const rightRank = rank.get(right.uid) ?? pins.length;
      return leftRank - rightRank;
    });
  }
  return rows;
}
function insertTodo(db: Ledger, todo: Todo): Todo {
  db.prepare(
    `INSERT INTO todos(uid,title,project,entry_uid,step_index,status,created_at,completed_at,start_at,due_at,content)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    todo.uid,
    todo.title,
    todo.project,
    todo.entryUid,
    todo.stepIndex,
    todo.status,
    todo.createdAt,
    todo.completedAt,
    todo.startAt,
    todo.dueAt,
    todo.content,
  );
  return todo;
}
// Scheduling accepts second-precision instants only, unlike lifecycle parseTime.
function todoTime(value: unknown, name: string): string | null {
  if (value == null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    throw new ValidationError(
      `${name} must be an ISO timestamp with seconds and an explicit timezone`,
    );
  const local = value.slice(0, 19);
  const calendar = new Date(local + "Z");
  // Round-trip the local components to reject overflow dates, 24:00 and leap seconds.
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 19) !== local ||
    (value.length > 20 &&
      (Number(value.slice(20, 22)) > 23 || Number(value.slice(23, 25)) > 59))
  )
    throw new ValidationError(`invalid ${name}`);
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()))
    throw new ValidationError(`invalid ${name}`);
  const canonical = instant.toISOString().replace(".000Z", "Z");
  // Keep canonical output within the same four-digit-year input contract.
  if (canonical.length !== 20) throw new ValidationError(`invalid ${name}`);
  return canonical;
}
function todoContent(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 8000)
    throw new ValidationError(
      "content must be text of at most 8000 code units",
    );
  return value.trim() ? value : null;
}
function todoTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2000)
    throw new ValidationError("title must contain 1 to 2000 characters");
  return value.trim();
}
function assertTodoSchedule(todo: Pick<Todo, "startAt" | "dueAt">): void {
  if (todo.startAt !== null && todo.dueAt !== null && todo.startAt > todo.dueAt)
    throw new ValidationError("startAt must not be after dueAt");
}
export function createTodo(db: Ledger, value: unknown): Todo {
  const input = record(value, [
    "title",
    "project",
    "entryUid",
    "startAt",
    "dueAt",
    "content",
  ]);
  const title = todoTitle(input.title);
  const metadata = {
    startAt: todoTime(input.startAt, "startAt"),
    dueAt: todoTime(input.dueAt, "dueAt"),
    content: todoContent(input.content),
  };
  assertTodoSchedule(metadata);
  let project: string | null = null;
  let entryUid: string | null = null;
  if (input.project != null) {
    project = validateProjectMetadataInput({ project: input.project }).project;
    if (!db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(project))
      throw new ValidationError("project not found");
  }
  if (input.entryUid != null) {
    const entry = getEntry(db, validateUid(input.entryUid));
    if (!entry) throw new ValidationError("entry not found");
    if (project && project !== entry.project)
      throw new ValidationError("source project mismatch");
    project = entry.project;
    entryUid = entry.uid;
  }
  return insertTodo(db, {
    uid: randomUUID(),
    title,
    ...metadata,
    project,
    entryUid,
    stepIndex: null,
    status: "open",
    createdAt: new Date().toISOString(),
    completedAt: null,
  });
}
export function convertNextStep(db: Ledger, ref: string, index: number): Todo {
  return db
    .transaction(() => {
      const entry = getEntry(db, ref);
      if (
        !entry ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= entry.nextSteps.length
      )
        throw new ValidationError("next step not found");
      if (entry.nextStepsSourceUid)
        return convertNextStep(db, entry.nextStepsSourceUid, index);
      const existing = db
        .prepare(todoSelect + " WHERE entry_uid = ? AND step_index = ?")
        .get(entry.uid, index) as Todo | undefined;
      if (existing) return existing;
      return insertTodo(db, {
        uid: randomUUID(),
        title: entry.nextSteps[index],
        project: entry.project,
        entryUid: entry.uid,
        stepIndex: index,
        status: "open",
        createdAt: new Date().toISOString(),
        completedAt: null,
        startAt: null,
        dueAt: null,
        content: null,
      });
    })
    .immediate();
}
export function updateTodo(db: Ledger, uid: string, value: unknown): Todo {
  validateUid(uid);
  const input = record(value, [
    "status",
    "project",
    "title",
    "content",
    "startAt",
    "dueAt",
  ]);
  return db
    .transaction(() => {
      const todo = db.prepare(todoSelect + " WHERE uid = ?").get(uid) as
        Todo | undefined;
      if (!todo) throw new ValidationError("todo not found");
      if (input.title !== undefined) todo.title = todoTitle(input.title);
      if (input.content !== undefined)
        todo.content = todoContent(input.content);
      if (input.startAt !== undefined)
        todo.startAt = todoTime(input.startAt, "startAt");
      if (input.dueAt !== undefined)
        todo.dueAt = todoTime(input.dueAt, "dueAt");
      assertTodoSchedule(todo);
      if (input.status !== undefined) {
        if (
          !["open", "completed", "cancelled"].includes(input.status as string)
        )
          throw new ValidationError("invalid todo status");
        if (todo.status !== input.status) {
          todo.status = input.status as Todo["status"];
          todo.completedAt =
            todo.status === "completed" ? new Date().toISOString() : null;
        }
      }
      if (input.project !== undefined) {
        const nextProject =
          input.project === null
            ? null
            : validateProjectMetadataInput({ project: input.project }).project;
        if (nextProject !== todo.project) {
          if (todo.entryUid || todoIsReferenced(db, todo.uid))
            throw new ValidationError(
              todo.entryUid
                ? "source-linked todo project cannot change"
                : "referenced todo project cannot change",
            );
          if (
            nextProject &&
            !db
              .prepare("SELECT 1 FROM projects WHERE slug = ?")
              .get(nextProject)
          )
            throw new ValidationError("project not found");
          todo.project = nextProject;
        }
      }
      db.prepare(
        "UPDATE todos SET status=?, completed_at=?, project=?, title=?, content=?, start_at=?, due_at=? WHERE uid=?",
      ).run(
        todo.status,
        todo.completedAt,
        todo.project,
        todo.title,
        todo.content,
        todo.startAt,
        todo.dueAt,
        uid,
      );
      return todo;
    })
    .immediate();
}
function importTodo(db: Ledger, value: unknown, version: number): void {
  const input = record(value, [
    "uid",
    "title",
    "project",
    "entryUid",
    "stepIndex",
    "status",
    "createdAt",
    "completedAt",
    ...(version === 5 ? ["startAt", "dueAt", "content"] : []),
  ]);
  if (
    version === 5 &&
    ["startAt", "dueAt", "content"].some((key) => input[key] === undefined)
  )
    throw new ValidationError(
      "version 5 Todos require startAt, dueAt, and content",
    );
  validateUid(input.uid);
  if (
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 2000
  )
    throw new ValidationError("invalid todo title");
  if (!["open", "completed", "cancelled"].includes(input.status as string))
    throw new ValidationError("invalid todo status");
  parseTime(input.createdAt, "createdAt");
  if (input.status === "completed") parseTime(input.completedAt, "completedAt");
  else if (input.completedAt !== null)
    throw new ValidationError("invalid completion timestamp");
  if (input.project !== null) {
    validateProjectMetadataInput({ project: input.project });
    upsertProjectMetadata(db, { project: input.project as string });
  }
  if (input.entryUid !== null) {
    const entry = getEntry(db, validateUid(input.entryUid));
    if (!entry || entry.project !== input.project)
      throw new ValidationError("invalid todo source");
    if (input.stepIndex !== null) {
      if (!Number.isInteger(input.stepIndex) || Number(input.stepIndex) < 0)
        throw new ValidationError("invalid next step index");
      const index = Number(input.stepIndex);
      if (entry.nextTodoUids !== undefined) {
        if (entry.nextTodoUids[index] !== input.uid)
          throw new ValidationError("invalid next step index");
      } else if (
        index >= entry.nextSteps.length ||
        (version !== 5 && entry.nextSteps[index] !== input.title)
      )
        throw new ValidationError("invalid next step index");
    }
  } else if (input.stepIndex !== null)
    throw new ValidationError("next step requires a source");
  const todo = {
    ...input,
    startAt: todoTime(input.startAt, "startAt"),
    dueAt: todoTime(input.dueAt, "dueAt"),
    content: todoContent(input.content),
  } as Todo;
  assertTodoSchedule(todo);
  const existing = db.prepare(todoSelect + " WHERE uid = ?").get(todo.uid);
  if (existing) {
    if (!isDeepStrictEqual(existing, todo))
      throw new ValidationError("conflicting todo uid");
  } else insertTodo(db, todo);
}
export function completeActivity(db: Ledger, ref: string): StatusEntry {
  return db
    .transaction(() => {
      const entry = getEntry(db, ref);
      if (!entry) throw new ValidationError("entry not found");
      if (entry.effectiveStatus === "completed") return entry;
      const latest = current(db, entry.project)[0];
      const occurredAt = new Date(
        Math.max(Date.now(), Date.parse(latest.occurredAt) + 1),
      ).toISOString();
      // Copy refs, or keep the full legacy string list until every index is converted.
      const preserved = preservedNextWork(db, latest);
      const followUp = addValidatedStatus(
        db,
        validateStatusEntry({
          project: entry.project,
          status: latest.status,
          summary: `Completed activity #${entry.id}`,
          progress: latest.progress,
          blockers: latest.blockers,
          decisions: latest.decisions,
          tags: latest.tags,
          occurredAt,
          ...preserved,
        }),
      );
      changeCompletion(db, entry.uid, followUp.entry.uid);
      return getEntry(db, entry.uid)!;
    })
    .immediate();
}
