---
name: project-mgr
description: Manage project status with the local-first project-mgr CLI. Use when an AI agent needs to add an append-only project update, set project descriptions/notes, list or fuzzy-search projects, start the local Web Dashboard, import status records, query current or historical project state, or export a status ledger.
---

# project-mgr

Use `npx --yes --package project-mgr@latest pmgr`. In a source checkout, use `pnpm pmgr` instead.

Completion links and version-2 exports require project-mgr 0.3.0 or later. This skill is updated through Git and has no independent release version.

## Database safety

- Read `PMGR_DB_PATH` before operating. If unset, the CLI uses `~/.local/share/project-mgr/project-mgr.sqlite`.
- For exploratory or test work, set `PMGR_DB_PATH` to a dedicated absolute SQLite path for every command. Do not use `:memory:` when more than one CLI invocation must share data.
- Query before writing. `add` appends a snapshot; it does not edit the previous one.
- Set `--source agent` for agent-authored updates. Use `--external-ref` only when a stable idempotency key is available.
- If the project is not yet in the ledger database, initialize its metadata with `set-project`, backfill 3–5 historical major changes/milestones using `add` (setting appropriate historical `--at` timestamps), and then append the latest status snapshot.

## Metadata vs. status entries

- **Project notes (`--notes`)**: Reserved for persistent, medium-to-long-term project context (e.g., architectural constraints, permanent tech stack choices, long-term goals, or critical environment caveats).
  - Manage notes via `set-project --project <name> --notes "..."`.
  - **Do NOT** put transient progress, session logs, or one-off status messages into `--notes`.
  - Avoid passing `--notes` during routine `add` commands to prevent accidentally overwriting long-term project notes.
- **Project description (`--description`)**: A high-level, stable summary of the project's purpose.
- **Status snapshots (`add`)**: Use `--summary` (concise milestone headline), `--progress` (detailed work accomplished), `--next` (immediate next steps), `--blocker` (current obstacles), and `--decision` for transactional, append-only updates.

## Operations

Prefer `--json` for data that must be interpreted or reported programmatically.

```bash
# Set, update, or clear project metadata (description, notes, display name).
npx --yes --package project-mgr@latest pmgr set-project --project my-project --description "Project summary" --notes "Internal notes" --json
npx --yes --package project-mgr@latest pmgr set-project --project my-project --clear-description --clear-notes --json

# List all projects or fuzzy search across project names, descriptions, notes, status summaries, and tags.
npx --yes --package project-mgr@latest pmgr projects --json
npx --yes --package project-mgr@latest pmgr list --query "keyword" --json

# Start the local Web Dashboard & REST API server.
npx --yes --package project-mgr@latest pmgr serve --port 3000 --no-open --json

# Add an agent-authored status snapshot (status defaults to completed if omitted).
npx --yes --package project-mgr@latest pmgr add --project my-project --summary "Implemented the CLI" \
  --progress "Tests pass" --next "Publish the package" --source agent --json

# Query current state, history, or state at a time.
npx --yes --package project-mgr@latest pmgr current --project my-project --json
npx --yes --package project-mgr@latest pmgr history --project my-project --limit 20 --json
npx --yes --package project-mgr@latest pmgr history --limit 20 --json
npx --yes --package project-mgr@latest pmgr at --project my-project --at 2026-08-03T12:00:00+08:00 --json

# Import validated JSON/JSONL, or export portable records.
npx --yes --package project-mgr@latest pmgr import statuses.jsonl --json
npx --yes --package project-mgr@latest pmgr export --project my-project --format jsonl > statuses.jsonl
```

Use `PMGR_DB_PATH=/absolute/path/test.sqlite npx --yes --package project-mgr@latest pmgr ...` to isolate a manual test database. Import validates and writes the entire batch within one transaction; export output can be imported directly.

## Complete predecessor activities

Before recording follow-up work, inspect `history --project <name> --json`, including the original `status`, `effectiveStatus`, and `completedBy` evidence. Do not interpret a missing completion link as unfinished work. Inspect older pages with `--offset` when needed.

When this update resolves all commitments of earlier entries (including blockers and next steps), pass repeatable `--completes <id-or-uid>` to `add`. One follow-up may complete several entries. For partial progress, describe the remaining work and do not link. A commit/deployment is sufficient only when it resolves all the targeted entry's commitments.

Use `complete --entry <id-or-uid> --by <id-or-uid> --source agent` for an existing follow-up. Use `revoke-completion --entry <id-or-uid> --by <id-or-uid> --reason "..." --source agent` to correct a mistaken link. Links require the same project and strictly increasing occurrence times. Query the affected history afterward to verify effective completion. Do not bulk-close old entries without evidence.

Export produces version-2 bundles (one bundle per line for JSONL), preserving entry/event identities and audit history; legacy imports remain supported. `at` has no completion annotations. Project current state still comes from the latest snapshot.
