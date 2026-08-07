# Changelog

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
