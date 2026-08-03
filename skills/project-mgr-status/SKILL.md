---
name: project-mgr-status
description: Manage project status with the local-first project-mgr CLI. Use when an AI agent needs to add an append-only project update, import status records, query current or historical project state, or export a status ledger.
---

# Project Mgr Status

Use `npx --yes --package project-mgr pmgr`. In a source checkout, use `pnpm pmgr` instead.

## Database safety

- Read `PMGR_DB_PATH` before operating. If unset, the CLI uses `~/.local/share/project-mgr/project-mgr.sqlite`.
- For exploratory or test work, set `PMGR_DB_PATH` to a dedicated absolute SQLite path for every command. Do not use `:memory:` when more than one CLI invocation must share data.
- Query before writing. `add` appends a snapshot; it does not edit the previous one.
- Set `--source agent` for agent-authored updates. Use `--external-ref` only when a stable idempotency key is available.

## Operations

Prefer `--json` for data that must be interpreted or reported programmatically.

```bash
# Add an agent-authored status snapshot.
npx --yes --package project-mgr pmgr add --project my-project --status active --summary "Implemented the CLI" \
  --progress "Tests pass" --next "Publish the package" --source agent --json

# Query current state, history, or state at a time.
npx --yes --package project-mgr pmgr current --project my-project --json
npx --yes --package project-mgr pmgr history --project my-project --limit 20 --json
npx --yes --package project-mgr pmgr at --project my-project --at 2026-08-03T12:00:00+08:00 --json

# Import validated JSON/JSONL, or export portable records.
npx --yes --package project-mgr pmgr import statuses.jsonl --json
npx --yes --package project-mgr pmgr export --project my-project --format jsonl > statuses.jsonl
```

Use `PMGR_DB_PATH=/absolute/path/test.sqlite npx --yes --package project-mgr pmgr ...` to isolate a manual test database. Import validates the entire batch before one transaction writes it; export output can be imported directly.
