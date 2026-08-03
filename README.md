# Project Manager

[Chinese](README_CN.md)

`project-mgr` is a local-first, append-only ledger for project status. It stores progress, blockers, decisions, and next steps as timestamped status snapshots, so people and AI agents can quickly inspect each project's current state, complete history, or state at a particular time.

The first release provides only a local CLI and SQLite. It has no HTTP API, long-running service, or agent skills. Data stays on the local machine and requires no account or cloud service.

## Install and run

Requires Node.js 22+ and pnpm 10.30.2.

```bash
pnpm install --frozen-lockfile
cp .env_sample .env
pnpm build
```

`.env_sample` provides examples for all environment settings. The copied `.env` file is ignored by Git. `pnpm start` and `pnpm pmgr` automatically load the root `.env`; existing shell environment variables take precedence.

After building, run:

```bash
pnpm start status current
```

During development, run the TypeScript CLI directly:

```bash
pnpm pmgr status current
```

The default configuration in `.env_sample` is:

```dotenv
PMGR_DB_PATH=./data/project-mgr.sqlite
```

Set `PMGR_DB_PATH` in `.env` to use another location, or override it for one command:

```bash
PMGR_DB_PATH=/absolute/path/projects.sqlite pnpm start status current
```

Relative paths are resolved from the working directory of the command. When `pnpm start ...` runs from this project's root, the default database is `./data/project-mgr.sqlite`. It is created automatically when the first valid command runs.

### Use an isolated test database

For manual testing, set a persistent path in `.env` that is separate from production data:

```dotenv
PMGR_DB_PATH=./data/manual-test.sqlite
```

Then run commands normally:

```bash
pnpm start status add \
  --project test-project \
  --status active \
  --summary "Testing the isolated database"

pnpm start status current --json
```

`data/` is ignored by Git, so test data is not committed. Delete `data/manual-test.sqlite` when it is no longer needed.

Automated tests use an in-memory database or SQLite files in the system temporary directory; they do not read or write the default database. `PMGR_DB_PATH=:memory:` also works for one command, but each CLI command runs in a separate process and its data disappears when the command exits, so it is not suitable for consecutive manual tests.

## Quick start

Append a project status:

```bash
pnpm start status add \
  --project project-mgr \
  --status active \
  --summary "The local status ledger is available" \
  --progress "Completed SQLite and CLI support" \
  --next "Connect a real project" \
  --tag mvp
```

Query the current status of all projects or one project:

```bash
pnpm start status current
pnpm start status current --project project-mgr --json
```

Query history and the status at a specified time:

```bash
pnpm start status history \
  --project project-mgr \
  --since 2026-08-01T00:00:00Z \
  --limit 20 \
  --offset 0

pnpm start status at \
  --project project-mgr \
  --at 2026-08-03T12:00:00+08:00 \
  --json
```

## Write status

`status add` requires:

- `--project`: Unique project name. It may contain English letters, numbers, `.`, `_`, and `-`, and must start with a letter or number.
- `--status`: One of `idea`, `planned`, `active`, `blocked`, `paused`, `completed`, or `archived`.
- `--summary`: A summary of this status.

Optional arguments:

- `--progress`: Work already completed.
- `--blocker`, `--next`, `--decision`, and `--tag`: May be specified repeatedly.
- `--at`: When the status actually occurred. It must be an ISO 8601 timestamp with a timezone; defaults to the current time.
- `--source`: `human`, `agent`, or `import`; defaults to `human`.
- `--external-ref`: A globally idempotent key. A duplicate write to the same project returns the existing record; use by another project is an error.
- `--json`: Emit stable JSON.

## Bulk import

`status import` accepts a JSON object, a JSON array, or a JSONL file containing one object per line. Every record is validated before the whole batch is written in one SQLite transaction; any failure rolls back the entire batch.

```json
{
  "project": "project-mgr",
  "status": "active",
  "summary": "Core functionality is complete",
  "progress": "CLI and SQLite have passed tests",
  "blockers": [],
  "nextSteps": ["Connect a real project"],
  "decisions": ["The first release provides only a local CLI"],
  "tags": ["mvp"],
  "occurredAt": "2026-08-03T12:00:00+08:00",
  "source": "human",
  "externalRef": "project-mgr-2026-08-03-core"
}
```

```bash
pnpm start status import statuses.jsonl
# Equivalent form
pnpm start status import --file statuses.jsonl --json
```

Unknown fields, unknown CLI options, extra positional arguments, invalid statuses, and timestamps without a timezone are rejected.

## Query and export

| Command          | Purpose                                         | Key options                                                        |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `status current` | Current status for all projects or one project  | `--project`, `--json`                                              |
| `status history` | One project's history, newest first             | `--project`, `--since`, `--until`, `--limit`, `--offset`, `--json` |
| `status at`      | The latest status at or before a specified time | `--project`, `--at`, `--json`                                      |
| `status export`  | Export all records or one project's records     | `--project`, `--format json\|jsonl`                                |

Human-readable multi-record results list project, status, occurrence time, and summary. `add`, `import`, `current`, `history`, and `at` support `--json`; `export` uses `--format` to select its format.

Exports omit the database-internal `id` and `recordedAt` fields and can be imported directly. Records are exported from oldest to newest so that restoring them preserves the insertion order of records with the same timestamp:

```bash
pnpm start status export --format jsonl > project-statuses.jsonl

PMGR_DB_PATH=./data/restored.sqlite \
  pnpm start status import project-statuses.jsonl
```

## Development and verification

```bash
pnpm typecheck
pnpm lint
pnpm format-check
pnpm test
pnpm coverage
pnpm build
```

Coverage thresholds for statements, branches, functions, and lines are all 100%. See the [architecture document](docs/architecture.md) for the detailed design.
