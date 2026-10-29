# Changelog

## 0.5.0 - 2026-10-29

### Added

- Store new snapshot next work as `nextTodoUids` references. `add --next` creates Todos and those refs in one transaction; `add --next-todo` pins existing UIDs.
- Reject mixed prose and refs, duplicate UIDs, combining `--next` with `--next-todo`, cross-project refs, and project changes that conflict with any historical reference.
- Export version 4 carries refs and every Todo they need, including unassigned Todos referenced by a project export.
- `todos --status open` lists open work. With `--project`, current snapshot pins are ordered first.
- Dashboard activity history and project cards show referenced Todos with live status.

### Changed

- New snapshots no longer persist next-step prose. Legacy string `nextSteps` stay readable. Per-index conversion does not rewrite history; completion copies the full string list until every source index has a Todo, then materializes refs without creating Todos or changing their status.

### Fixed

- Detach the dashboard browser launch so a long-lived browser does not keep the process alive.
- Reject dangling and cross-project `nextTodoUids` from `importStatuses`, and require imported refs to name Todos in the same payload.
- Treat a fixed-UID retry of `--next` text as the same write after it has been stored as refs.

## 0.4.0 - 2026-10-28

### Added

- Add independent Todos with optional project/source links, per-item completion, cancellation, reopening, and CLI commands.
- Create Todos atomically from new next steps and explicitly convert legacy steps without rewriting history.
- Add dashboard activity completion controls and project-filtered Todo views.
- Preserve Todo state in version-3 exports and enforce same-origin local JSON writes.

### Changed

- Guide agents to ask before recording multiple sub-projects, either under one project name or with snapshot tags.
- Sync the Chinese README with CLI help, activity completion, and Todo documentation.

## 0.3.2 - 2026-10-16

- Add general and per-command CLI help, no-argument help, and package version aliases without opening the database.

## 0.3.1 - 2026-10-16

### Changed

- Prefer an installed `pmgr` in the Skill and remove automatic `npx @latest` execution from examples.
- Require explicit status values and evidence-backed historical backfills without a minimum entry count.
- Document database permission handling, stable ledger paths, and read-back verification after writes.

This release updates Skill guidance only; CLI behavior and storage architecture are unchanged.

## 0.3.0 - 2026-10-16

### Added

- Explicit completion of multiple predecessor activities, append-only revocation, and completion-source links in the activity feed.
- Independent Current/Superseded markers, preserved original snapshot details, and a direct entry route with a return-to-list control.
- Migration 3 adds portable entry and event identities and rejects obsolete writers that omit entry UUIDs.

### Changed

- Export is now a version-2 bundle rather than a JSON array or entry-per-line JSONL. JSONL emits one complete bundle per line. Existing consumers must adapt; legacy imports remain supported.
- Imports preserve completion history and recording times, reject conflicting identities atomically, and deduplicate version-2 re-imports. Independently migrated legacy databases may require restoring into a fresh database due to differing UUIDs.

### Fixed

- Invalid percent-encoding in entry/project detail routes returns 400 instead of 500.

## 0.2.0 - 2026-08-07

### Added

- Added local HTTP Web Server & SPA Dashboard via `pmgr serve` (`GET /`, REST API `/api/projects`, `/api/history`, `/api/stats`).
- Added Activity Feed date filtering with native Date Picker (defaulting to Today's local date).
- Added Activity Feed Grouping Mode toggle: Grouped by Project (Default) vs Flat List.
- Made `--status` parameter in `pmgr add` optional (defaults to `completed`, with `done` as a normalized alias).
- Added `countEntries` query for accurate database metrics.
- Fixed XSS vulnerability in Web UI event handling via HTML5 data attribute event delegation.
- Added descending project sorting by latest update timestamp.

## 0.1.7 - 2026-08-07

### Added

- Added project metadata management (`displayName`, `description`, `notes`) and fuzzy search via `projects` / `list --query`.
- Added explicit field clearing for project metadata via `--clear-description` and `--clear-notes` flags in `pmgr set-project`.

## 0.1.6 - 2026-08-03

### Fixed

- Allowed `history` to query recent entries across all projects without `--project`.

## 0.1.5 - 2026-08-03

### Changed

- Matched the Skill picker label to the project name, `project-mgr`, and documented explicit invocation.

## 0.1.4 - 2026-08-03

### Changed

- Renamed the Agent Skill from `project-mgr-status` to `project-mgr`.

## 0.1.3 - 2026-08-03

### Added

- Packaged the `project-mgr-status` Agent Skill for status ledger operations.

### Fixed

- Made the CLI run through npm-created `pmgr` symlinks and corrected the no-install examples.

## 0.1.2 - 2026-08-03

### Changed

- Moved the default database from the command's working directory to the stable per-user path `~/.local/share/project-mgr/project-mgr.sqlite`.

## 0.1.1 - 2026-08-03

### Changed

- Documented npm execution with `npx` and optional global installation.

## 0.1.0 - 2026-08-03

### Fixed

- Approved the required `better-sqlite3` and `esbuild` build scripts for reproducible frozen pnpm installs.
- Made empty human-readable list queries explicit while preserving `[]` JSON output.
- Added top-level CLI action shorthand while keeping `status <action>` compatibility.

### Added

- A local TypeScript CLI and SQLite append-only project status ledger.
- Single-record, JSON, and JSONL atomic writes; current, historical, and point-in-time queries; and restorable exports.
- Strict input validation, `externalRef` idempotency, automatic migrations, and deterministic time ordering.
- `.env_sample` and automatic loading of local `.env` database configuration by the run scripts.
- English usage documentation and a standalone architecture document.
- 100% coverage thresholds for statements, branches, functions, and lines.
