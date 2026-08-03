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

## Data model

The database contains three structures:

- `schema_migrations`: Applied migration versions.
- `projects`: Project slug, display name, and creation time.
- `status_entries`: Immutable status snapshots and their project foreign keys.

Key `status_entries` fields:

| Field                                                             | Meaning                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `status`, `summary`, `progress`                                   | Status enum, summary, and completed work                                                 |
| `blockers_json`, `next_steps_json`, `decisions_json`, `tags_json` | JSON-encoded string arrays                                                               |
| `occurred_at`                                                     | When the status actually occurred, supplied by the caller or generated during validation |
| `recorded_at`                                                     | When the database actually wrote the entry                                               |
| `source`                                                          | `human`, `agent`, or `import`                                                            |
| `external_ref`                                                    | Optional globally unique idempotency key                                                 |

The `project_id, occurred_at DESC, id DESC` index supports current-status and history queries.

## Initialization and migrations

After opening the database, `openLedger()` enables foreign keys, creates the migration table, and checks for and applies migration 1 within a `BEGIN IMMEDIATE` transaction. The immediate transaction prevents migration checks and writes from interleaving when several local processes open the database for the first time at once.

The database path is read from `PMGR_DB_PATH` first; otherwise, it uses `data/project-mgr.sqlite` in the process working directory. Non-memory databases create their parent directory automatically.

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

Complete records returned by database queries include the internal `id` and `recordedAt`. The export layer removes these read-only fields while preserving business fields, original source, and the idempotency key, so JSON and JSONL can pass strict input validation when imported again.

Exports have no record limit and reverse descending history results into oldest-to-newest order. When restoring to an empty database, entries with the same `occurredAt` receive IDs in their original append order, so the current status remains the same.

## Consistency and limits

- SQLite transactions guarantee atomic single writes and bulk imports.
- `externalRef` is unique across the entire database; cross-project reuse is explicitly rejected.
- Current status is derived from history; no separate cache table can drift.
- Version 1 is for trusted local users and includes no authentication, authorization, multi-user synchronization, or encryption.
- JSON arrays are stored as text. Evaluate a normalized schema only when cross-field full-text search or complex tag statistics are needed.
