# Changelog

## Unreleased

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
