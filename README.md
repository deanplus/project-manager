# Project Manager

[Chinese](README_CN.md)

`project-mgr` is a local-first, append-only ledger for project status. It stores progress, blockers, decisions, and next steps as timestamped status snapshots, so people and AI agents can quickly inspect each project's current state, complete history, or state at a particular time.

The first release provides a local CLI, SQLite, and an optional Agent Skill. It has no HTTP API or long-running service. Data stays on the local machine and requires no account or cloud service.

## Run from npm

Requires Node.js 22+.

Run without installing:

```bash
npx --yes --package project-mgr pmgr current
```

Or install the CLI globally:

```bash
npm install --global project-mgr
pmgr current
```

The database defaults to `~/.local/share/project-mgr/project-mgr.sqlite`, regardless of the directory where `pmgr` is executed. The CLI resolves this to an absolute path using the current user's home directory and creates the parent directory automatically.

Set `PMGR_DB_PATH` to use another location:

```bash
PMGR_DB_PATH=/absolute/path/projects.sqlite npx --yes --package project-mgr pmgr current
```

## Install the Agent Skill

The repository includes the `project-mgr` skill, shown as **project-mgr** in skill pickers. It guides compatible AI agents to add, import, query, and export local project status history. Install it with the [skills CLI](https://skills.sh/docs/cli):

```bash
npx skills add deanplus/project-manager
```

The installer detects supported agents and asks where to install the skill. No separate `project-mgr` installation is required: the skill runs the CLI through `npx`. Restart or reload the selected agent after installation.

### Invoke the skill

In Codex, write `$project-mgr` in the prompt. Alternatively, type `/pro` and select **project-mgr** from the picker. In other agents, use their explicit skill syntax or select `project-mgr` from the skills menu.

Use normal language after the skill name; the agent translates the request into CLI commands. For example:

```text
Use $project-mgr to show the current status and latest 10 updates for project-mgr.

Use $project-mgr to record this update for project-mgr: active; released the Agent Skill;
next, collect user feedback.

Use $project-mgr to record these updates: api is blocked by authentication; web is active
and the dashboard is complete.

Use $project-mgr with PMGR_DB_PATH=/tmp/project-mgr-test.sqlite to add a test update,
then show its history.
```

The agent should query before writing and ask for missing required values such as the project name, status, or summary.

The skill uses the same `PMGR_DB_PATH` behavior as the CLI: it defaults to `~/.local/share/project-mgr/project-mgr.sqlite`; set an absolute path to work in another ledger. For manual or exploratory work, use a dedicated database such as `PMGR_DB_PATH=/tmp/project-mgr-skill-test.sqlite` rather than the default ledger.

## Build from source

Requires Node.js 22+ and pnpm 10.30.2.

```bash
pnpm install --frozen-lockfile
cp .env_sample .env
pnpm build
```

`.env_sample` provides examples for all environment settings. The copied `.env` file is ignored by Git. `pnpm start` and `pnpm pmgr` automatically load the root `.env`; existing shell environment variables take precedence.

After building, run:

```bash
pnpm start current
```

During development, run the TypeScript CLI directly:

```bash
pnpm pmgr current
```

The default database path is:

```text
~/.local/share/project-mgr/project-mgr.sqlite
```

`PMGR_DB_PATH` is optional in `.env_sample`. Set it in `.env` to use another location, or override it for one command:

```bash
PMGR_DB_PATH=/absolute/path/projects.sqlite pnpm start current
```

Use a literal absolute path in `.env`; `.env` files do not expand `~` or `$HOME`. The database is created automatically when the first valid command runs.

### Use an isolated test database

For manual testing, set a persistent path in `.env` that is separate from production data:

```dotenv
PMGR_DB_PATH=/tmp/project-mgr-manual-test.sqlite
```

Then run commands normally:

```bash
pnpm start add \
  --project test-project \
  --status active \
  --summary "Testing the isolated database"

pnpm start history --project test-project
```

Project keys must match exactly: a record added to `test-project` is not part of `project-mgr` history. Empty human-readable list queries print `No entries found.`; with `--json`, they print `[]`.

Delete `/tmp/project-mgr-manual-test.sqlite` when it is no longer needed.

Automated tests use an in-memory database or SQLite files in the system temporary directory; they do not read or write the default database. `PMGR_DB_PATH=:memory:` also works for one command, but each CLI command runs in a separate process and its data disappears when the command exits, so it is not suitable for consecutive manual tests.

## Quick start

Append a project status:

```bash
pnpm start add \
  --project project-mgr \
  --status active \
  --summary "The local status ledger is available" \
  --progress "Completed SQLite and CLI support" \
  --next "Connect a real project" \
  --tag mvp
```

Query the current status of all projects or one project:

```bash
pnpm start current
pnpm start current --project project-mgr --json
```

Query history and the status at a specified time:

```bash
pnpm start history \
  --project project-mgr \
  --since 2026-08-01T00:00:00Z \
  --limit 20 \
  --offset 0

pnpm start at \
  --project project-mgr \
  --at 2026-08-03T12:00:00+08:00 \
  --json
```

## Write status

`add` requires:

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

`import` accepts a JSON object, a JSON array, or a JSONL file containing one object per line. Every record is validated before the whole batch is written in one SQLite transaction; any failure rolls back the entire batch.

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
pnpm start import statuses.jsonl
# Equivalent form
pnpm start import --file statuses.jsonl --json
```

Unknown fields, unknown CLI options, extra positional arguments, invalid statuses, and timestamps without a timezone are rejected.

## Query and export

| Command   | Purpose                                         | Key options                                                        |
| --------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `current` | Current status for all projects or one project  | `--project`, `--json`                                              |
| `history` | One project's history, newest first             | `--project`, `--since`, `--until`, `--limit`, `--offset`, `--json` |
| `at`      | The latest status at or before a specified time | `--project`, `--at`, `--json`                                      |
| `export`  | Export all records or one project's records     | `--project`, `--format json\|jsonl`                                |

All six actions can also use the compatible `status <action>` form, for example `pmgr status export`. Human-readable multi-record results list project, status, occurrence time, and summary, or `No entries found.` when empty. `add`, `import`, `current`, `history`, and `at` support `--json`; `export` uses `--format` to select its format.

Exports omit the database-internal `id` and `recordedAt` fields and can be imported directly. Records are exported from oldest to newest so that restoring them preserves the insertion order of records with the same timestamp:

```bash
pnpm start export --format jsonl > project-statuses.jsonl

PMGR_DB_PATH=/tmp/project-mgr-restored.sqlite \
  pnpm start import project-statuses.jsonl
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
