# Architecture

## Design goals

`project-mgr` is a local, single-machine, append-only project status ledger. The first release follows four principles:

- History is never overwritten: every write appends a status snapshot.
- One source of truth: the CLI and any future interfaces must reuse the same domain and database logic.
- Clear time semantics: distinguish when a status occurred from when the system recorded it.
- Portable: exports can be imported into a new database to restore the status timeline.

The first release has no work that needs to run continuously, so it provides neither an HTTP API nor PM2 configuration. Consider a service layer only when other local processes need a stable interface or background jobs.

## Module boundaries

```text
User / script
    │
    ▼
src/cli.ts       Argument parsing, file input, output formatting, command-level constraints
    │
    ├──────────────► src/domain.ts
    │                 Types, field validation, time normalization, portable record conversion
    ▼
src/db.ts        SQLite connection, migrations, transactions, idempotent writes, and queries
    │
    ▼
SQLite file
```

`src/index.ts` exports only public types and functions. Business validation does not depend on the CLI, so bulk imports and direct database API calls use the same rules.

The CLI accepts `pmgr <action>` for `add`, `import`, `current`, `history`, `at`, `export`, `complete`, and `revoke-completion`; `pmgr status <action>` remains a compatible form. Both forms share the same validation and execution path.

## Data model

The database contains four structures:

- `schema_migrations`: Applied migration versions (1: base tables, 2: project description & notes columns, 3: portable identities and completion events).
- `projects`: Project slug, display name, description, notes, and creation time.
- `status_entries`: Immutable status snapshots, stable UUIDs, and project foreign keys.
- `completion_events`: Append-only complete/revoke events with UUIDs, source/target entry UUIDs, per-target predecessor UUIDs, recording time, author source, and optional reason.

Key `status_entries` fields:

| Field                                                             | Meaning                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `status`, `summary`, `progress`                                   | Status enum, summary, and completed work                                                 |
| `blockers_json`, `next_steps_json`, `decisions_json`, `tags_json` | JSON-encoded string arrays                                                               |
| `next_todo_uids_json`                                             | NULL for legacy snapshots; a JSON UID array (including `[]`) for ref snapshots           |
| `occurred_at`                                                     | When the status actually occurred, supplied by the caller or generated during validation |
| `recorded_at`                                                     | When the database actually wrote the entry                                               |
| `source`                                                          | `human`, `agent`, or `import`                                                            |
| `external_ref`                                                    | Optional globally unique idempotency key                                                 |

The `project_id, occurred_at DESC, id DESC` index supports current-status and history queries.

## Initialization and migrations

After opening the database, `openLedger()` enables foreign keys, creates the migration table, and checks for and applies migrations 1 through 5 within a `BEGIN IMMEDIATE` transaction. The immediate transaction prevents migration checks and writes from interleaving when several local processes open the database for the first time at once.

The database path is read from `PMGR_DB_PATH` first; otherwise, it uses the absolute path `~/.local/share/project-mgr/project-mgr.sqlite`, resolved from the current user's home directory. Non-memory databases create their parent directory automatically.

## Write flow

A single write proceeds as follows:

1. Reject unknown fields and validate the project name, status, source, string arrays, and time.
2. Normalize all timestamps to UTC ISO 8601 strings.
3. In a transaction, check `externalRef`: repeated calls for the same project return the existing entry; cross-project conflicts fail.
4. Create the project when needed, then append a status snapshot.
5. Read and return the final entry from the database.

Bulk import validates all input first, then executes the same write logic for each entry in one transaction. A database constraint or any failed write rolls back the entire batch.

## Query semantics

- Current status: take the first entry for each project ordered by `occurred_at DESC, id DESC`.
- History: use the same occurrence-time and ID descending order, with inclusive `since` / `until` bounds and `limit` / `offset`.
- Status at a time: take the first entry with `occurred_at <=` the specified time.
- Same occurrence time: the later-written, larger `id` wins, keeping results deterministic.

All ISO 8601 timestamps are converted to UTC on write, so SQLite string ordering matches time ordering.

## Import and export

Version-2 exports contain `{version: 2, entries, completions}`. Both JSON and JSONL emit a complete bundle, with one bundle per line for JSONL. Local numeric IDs and computed annotations are excluded; UUIDs, original source, occurrence/recording times, and all completion/revocation events are retained. Legacy entry-only objects, arrays, and JSONL remain importable. A file is applied atomically. UUID conflicts and divergent per-target event chains fail explicitly; repeated bundle imports are idempotent. Export reads raw snapshots in a single read transaction rather than computing discarded annotations.

Exports have no record limit and read raw snapshots directly in oldest-to-newest order. When restoring to an empty database, entries with the same `occurredAt` receive IDs in their original append order, so the current status remains the same.

## Consistency and limits

- SQLite transactions guarantee atomic single writes and bulk imports.
- `externalRef` is unique across the entire database; cross-project reuse is explicitly rejected.
- Current status is derived from history; no separate cache table can drift.
- Version 1 is for trusted local users and includes no authentication, authorization, multi-user synchronization, or encryption.
- JSON arrays are stored as text. Evaluate a normalized schema only when cross-field full-text search or complex tag statistics are needed.

## Activity completion

`add --completes` inserts the snapshot and explicit links atomically. `complete` links an existing follow-up; `revoke-completion` appends a correction with a required reason. Only strictly later same-project follow-ups are valid. Exactly one active completion source is allowed per target. Original snapshot fields remain unchanged.

History/current/detail reads return original status, effective status, recency, and completion evidence independently of pagination/date filters. `at` retains snapshot-only semantics. Cards display Completed plus a navigable source while retaining original details. The project current state still comes from the latest snapshot.

Migration 3 backfills random UUIDs and rejects inserts lacking a UUID, so old writers fail explicitly instead of creating unreadable records. Independently migrated copies of legacy data have different UUIDs; importing across them may fail on an existing external reference. There is no automatic identity adoption or cross-database reconciliation. Export from one authoritative ledger and restore into a fresh database when migrating.

## Independent Todos (migration 4)

`todos` stores stable UUIDs, title, optional project/source UUID, optional legacy
step index, status, creation time, and completion time. Source links constrain
project ownership. A unique source/index pair makes conversion retry-safe.
New `addStatus` calls with `--next` text create Todos and `nextTodoUids` in the
same transaction and leave string `nextSteps` empty. Imports do not implicitly
create work. Legacy rows keep string `nextSteps` and leave `next_todo_uids_json`
NULL. Todos are editable current state, while activity snapshots and their
completion events remain append-only. Version-3 bundles include Todos without
refs. Version-4 bundles also carry `nextTodoUids`. Conflicts, dangling refs,
and cross-project refs reject the entire import rather than overwrite changes.

The local dashboard exposes JSON POST routes for Todo creation/update, explicit
step conversion, and activity completion. Activity completion appends a follow-up
retaining current project status and links the original activity. Todo state is
independent. Mutations reject non-local Host headers, cross-origin requests,
non-JSON bodies, and bodies exceeding 32 KiB.

Completion follow-ups preserve all current snapshot context. If the latest
snapshot already stores `nextTodoUids`, the follow-up copies that list and does
not create Todos. If it still has legacy strings, the follow-up copies the full
original list and `nextStepsSourceUid` until every source index has a Todo, then
writes refs in that index order without changing Todo status. `nextStepsSourceUid`
points directly at the original string source (same project and identical text).
UI rendering and server-side conversion reuse that source's Todos, including
after export/import; copying context never creates a second conversion identity.

`current` and `history` add `nextTodos`, a live resolution of stored refs.
`at` returns the stored snapshot only, so resolved titles there are not historical.
