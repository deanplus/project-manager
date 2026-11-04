---
name: project-mgr
description: Manage project status with the local-first project-mgr CLI. Use when an AI agent needs to add an append-only project update, set project descriptions/notes, list or fuzzy-search projects, start the local Web Dashboard, import status records, query current or historical project state, or export a status ledger. When one effort contains multiple sub-projects, ask whether they share one project name or should be distinguished with tags.
---

# project-mgr

## CLI selection

Prefer an installed `pmgr`: locate it with `command -v pmgr` and check the installed package metadata/documentation for the required version and capabilities. This source revision supports `-h` / `--help`, `help [command]`, and `-v` / `-V` / `--version` / `version` without opening the database. Older installed releases may not support these flags; inspect their package metadata instead. In a source checkout, use `pnpm pmgr` only when the local dependencies are already installed and the package manager is available without downloading it.

Do not automatically install or upgrade dependencies, or fall back to `npx` / `npm exec`. If no usable CLI is available, report the missing executable, dependency, or capability and the setup needed. Perform installation or upgrades only when the user authorizes that setup.

Completion links and version-2 exports require project-mgr 0.3.0 or later. This skill is updated through Git and has no independent release version.

## Database safety

- Read `PMGR_DB_PATH` before operating. If unset, the CLI uses `~/.local/share/project-mgr/project-mgr.sqlite`.
- For exploratory or test work, set `PMGR_DB_PATH` to a dedicated absolute SQLite path for every command. Do not use `:memory:` when more than one CLI invocation must share data.
- The database file and its parent directory must be accessible with the permissions SQLite needs for journal files and writes. Even query commands open the ledger and may initialize or migrate it; do not assume they are filesystem-read-only.
- On a permission or read-only database error, report the command, resolved database path, and error without exposing credentials. Use the environment's approved permission mechanism when available; otherwise report the blocked operation. Do not reinstall the CLI, change permissions, or silently switch to another database to work around the error. Change the ledger location only when the user requests it.
- Query before writing. `add` appends a snapshot; it does not edit the previous one. Read back the affected state after writing and report success only when verified. If a write's outcome is uncertain, query before retrying to avoid duplicates.
- Set `--source agent` for agent-authored updates. Use `--external-ref` only when a stable idempotency key is available.
- Explicitly pass `--status` on every `add`, and include `status` in every agent-authored import entry. The CLI defaults to `completed`; do not rely on that default. Choose the status from the evidence and inspect the current snapshot when unclear. `--status` is the project's status: the latest snapshot supplies `current.status`, and open Todos do not keep or restore `active`. Report a finished milestone in `--summary` / `--progress` and keep `active` while project work continues; use `completed` only with evidence that the whole project is complete. If the status remains uncertain, clarify before writing.
- If the project is not yet in the ledger database, initialize its metadata with `set-project`. Backfill only milestones supported by verifiable Git commits, dated documents, or historical records, and include the evidence reference in `--progress`. Use historical `--at` timestamps only when supported by that evidence; a commit timestamp proves a commit, not a deployment. There is no required number of entries. Never invent milestones or dates; when evidence is unavailable, skip backfill and append only the current known status.
- If one effort contains multiple sub-projects and the user has not already chosen how to identify them, ask before writing. See "Multiple sub-projects".

## Metadata vs. status entries

- **Project notes (`--notes`)**: Reserved for persistent, medium-to-long-term project context (e.g., architectural constraints, permanent tech stack choices, long-term goals, or critical environment caveats).
  - Manage notes via `set-project --project <name> --notes "..."`.
  - **Do NOT** put transient progress, session logs, or one-off status messages into `--notes`.
  - Avoid passing `--notes` during routine `add` commands to prevent accidentally overwriting long-term project notes.
- **Project description (`--description`)**: A high-level, stable summary of the project's purpose.
- **Status snapshots (`add`)**: Use `--summary` (concise milestone headline), `--progress` (work done, evidence, and watch/check context, including what was not verified), `--next` (concrete actions only; see "Actions vs. watch items"), `--blocker` (current obstacles that stop an action), `--decision`, and repeatable `--tag` for transactional, append-only updates.

## Multiple sub-projects

One repository or effort may contain several sub-projects, such as separate packages, apps, services, or contracts. `--project` is the ledger identity: current status, history, and completion links all belong to that slug. `--tag` is a repeatable label on a single status snapshot. Tags do not create a project, a separate current status, or a separate completion history. `projects` / `list --query` can match tags on the latest snapshot.

When several sub-projects are in scope and the user has not already chosen how to identify them, ask before the first write. Do not decide silently. Do not create a separate project slug per sub-project unless the user explicitly asks for separate ledger projects.

Offer these two choices:

1. **Share one project name.** Append every sub-project to the same `--project`. Use this when the user wants one current status and one history for the whole effort. Do not add sub-project tags unless the user also asks for them.
2. **Distinguish sub-projects with tags.** Keep that same `--project`, and pass repeatable `--tag` values naming the sub-project this snapshot covers, for example `--project acme --tag web`. Reuse the same tag on later updates for that sub-project. A tag describes that snapshot only; older snapshots keep the tags they were written with. Search with `pmgr list --query web --json`. Completion links still apply to the whole project, so link an earlier entry only when this update resolves all of that entry's commitments.

Follow a choice the user already recorded. Do not store the choice in `--notes` unless the user asks; notes are long-term project context, and `set-project --notes` replaces them.

## Operations

Prefer `--json` for data that must be interpreted or reported programmatically.

```bash
# Set, update, or clear project metadata (description, notes, display name).
pmgr set-project --project my-project --description "Project summary" --notes "Internal notes" --json
pmgr set-project --project my-project --clear-description --clear-notes --json

# List all projects or fuzzy search across project names, descriptions, notes, status summaries, and tags.
pmgr projects --json
pmgr list --query "keyword" --json

# Start the local Web Dashboard & REST API server.
pmgr serve --port 3000 --no-open --json

# Record a completed milestone while the project remains active.
# Inspect open work before every add. Existing open pins carry automatically.
pmgr next --project my-project --json
# Use --next for new actions; exact prior open titles reuse their Todo UID.
pmgr add --project my-project --status active --summary "Implemented the CLI" \
  --progress "Tests pass" --next "Publish the package" --source agent --json
pmgr next --project my-project --json

# Same project, with a tag naming the sub-project this snapshot covers.
pmgr add --project acme --status active --summary "Shipped the web dashboard" \
  --tag web --source agent --json

# Query current state, history, or state at a time.
pmgr current --project my-project --json
pmgr history --project my-project --limit 20 --json
pmgr history --limit 20 --json
pmgr at --project my-project --at 2026-08-03T12:00:00+08:00 --json

# Import validated JSON/JSONL, or export portable records.
pmgr import statuses.jsonl --json
pmgr export --project my-project --format jsonl > statuses.jsonl
```

Use `PMGR_DB_PATH=/absolute/path/test.sqlite pmgr ...` to isolate a manual test database. Import validates and writes the entire batch within one transaction; export output can be imported directly.

## Complete predecessor activities

Before recording follow-up work, inspect `history --project <name> --json`, including the original `status`, `effectiveStatus`, and `completedBy` evidence. Do not interpret a missing completion link as unfinished work. Inspect older pages with `--offset` when needed.

When this update resolves all commitments of earlier entries (including blockers and next steps), pass repeatable `--completes <id-or-uid>` to `add`. One follow-up may complete several entries. For partial progress, describe the remaining work and do not link. A commit/deployment is sufficient only when it resolves all the targeted entry's commitments.

Use `complete --entry <id-or-uid> --by <id-or-uid> --source agent` for an existing follow-up. Use `revoke-completion --entry <id-or-uid> --by <id-or-uid> --reason "..." --source agent` to correct a mistaken link. Links require the same project and strictly increasing occurrence times. Query the affected history afterward to verify effective completion. Do not bulk-close old entries without evidence.

## Actions vs. watch items

A Todo is concrete work. Before writing `--next`, ask: **"If someone were free right now, could they start this and finish it by working on it?"**

| Kind         | Test result                                                | Example                                     | Where it goes                                                                                                                                                          |
| ------------ | ---------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action       | Yes                                                        | "Add backoff to the fetch retry"            | `--next` (a Todo)                                                                                                                                                      |
| Timed action | Yes, at a known time                                       | "Renew the API quota"                       | `todo-add --due-at <ISO-time>`, then `add --next-todo <uid>`; keep time out of the title                                                                               |
| Watch        | No; waits on a sample, an external event, or a time window | "Wait for the first large-crash sample"     | Repo `todo.md` (gate and evidence) and a scheduled task when there is a check time; mention it in `--progress` (topic, gate, next check time, timer id, evidence link) |
| Disclaimer   | Not work                                                   | "Production deploy not verified this round" | `--progress` only                                                                                                                                                      |

- A watch becomes an action when its gate fires; the agent that observes it then writes the action with `--next`.
- `--blocker` is for something that stops an action. A watch is not a blocker unless it stops a named action.
- Do not add `--next` items that restate this snapshot's own accomplishment, such as "finish upgrading X" on a snapshot reporting that X was upgraded.

Each item has one owner. Do not copy it to every surface:

| Surface        | Owns                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Repo `todo.md` | The repo's detailed backlog and watch items: gates, evidence, acceptance criteria                            |
| Scheduled task | When a check runs                                                                                            |
| project-mgr    | The project's current actions: short titles, at most about 5 pins, linking to detail instead of repeating it |

## Timed actions and edits

- Use `todo-add --title "<action>" --due-at <ISO-time> [--start-at <ISO-time>]`, then pin the returned UID with `add --next-todo`. Keep dates out of new titles; do not automatically rewrite existing titles.
- `startAt` is an optional planned start; due is independently optional. Both default to null, without inferred dates. Use seconds and an explicit timezone; output is UTC. When both exist, start must not exceed due. Neither field asserts that work started.
- A new deadline for the same deliverable/occurrence, including a deliberate reschedule, uses in-place `todo-update --due-at`, optionally followed by `add --progress` with the reason; supersede (cancel + new + pin) only when the deliverable, occurrence, or scope changes; separate renewals remain independent Todos. Creation and the final `add` are separate transactions; use the staging recovery below.
- `todo-update` writes no snapshot or audit record. If evidence or old wording matters, follow with `add --progress`; the edit and evidence write are not atomic. Refs-format history resolves the edited title and does not retain old wording.
- Start/due never turn a watch into an action and due triggers no reminder. Gates stay in owning records; check times belong to scheduled tasks.
- Keep `--content` brief; long details belong in the repository `todo.md` or an equivalent owning record.
- `--content` accepts multiline plain text up to 8,000 code units. Blank domain/HTTP values and whitespace-only CLI content become null; `--content ""` is an error. Use `--clear-content`, `--clear-start-at`, or `--clear-due-at` to clear. Omitted fields stay unchanged; clear/value pairs conflict. Values starting with `--` are unsupported. Todos have no `--source` or author field.
- `next`, `current`, and `todos` text append a due suffix when dated. JSON exposes start/due/content; dashboard controls are unchanged. HTTP bodies remain limited to 32 KiB, including JSON escaping.
- Migration 6 adds nullable `start_at`, `due_at`, and `content`. Portable v5 requires all three metadata keys (null allowed), normalizes before conflict checks, and preserves source/index/UID validation. Back up, run `pnpm build` for a checkout, and restart all dashboard/writer processes before writing metadata; an old-build export can silently omit metadata and is not a complete backup.

## Daily open-work checklist

Use `pmgr next --json` as the canonical daily checklist. Do not combine
`nextSteps`, `nextTodos`, and `todos` by hand. Close flags (`--done-todo <uid>`,
`--cancel-todo <uid>`) are repeatable and atomic with `add`. Unpinned Todos
remain visible as backlog. Never cancel older or similar work automatically.

### Reconcile before every add

1. Run `pmgr next --project P --json`.
2. For each action being written, find **candidates**: open items on the same topic. Topic only finds candidates; decide each one:
   - **Duplicate** (same deliverable or same occurrence) → keep the existing UID; do not create a new Todo.
   - **Superseded** (deliverable, occurrence, or scope changed; deadline-only changes keep the UID) → `--cancel-todo <old>` plus the new action in the same `add`; state the evidence in `--progress`.
   - **Independent** (for example "implement X" and "test X", or two separate renewals) → leave it open.
   - Finished → `--done-todo <uid>` with evidence for every commitment in its title.
3. Reconcile only the commitments this write touches. Report suspected duplicates or watches on other topics in your reply and in `--progress`; do not close them.
4. After the write, run `pmgr next --project P --json`: each kept or new open commitment appears once, and each completed or cancelled UID is absent. Confirm their final status with `pmgr todos --project P --json` when needed.

`add` rejects `--next` together with `--next-todo`. Use these forms:

| Situation                                     | Command                                                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep a pinned item                            | Nothing; carry mode keeps it                                                                                                                                                 |
| Pin an existing unpinned item, no new work    | `add --next-todo <uid>`                                                                                                                                                      |
| New actions only                              | `add --next "<title>"`; check the returned UIDs, because an exact title reuses an open Todo                                                                                  |
| Keep or pin an existing item and add new work | 1. `todo-add --project P --title "<new>" --json` for each new action; record each returned UID. 2. One `add --next-todo <existing> --next-todo <new> [--cancel-todo <old>]`. |
| Reuse by exact title in a `--next` write      | Only when exactly one open item of P has that title; otherwise use the `todo-add` form                                                                                       |

**Failure recovery for the `todo-add` form.** These commands are not atomic
together: each `todo-add` commits on its own, and `add` commits before it prints
its result, so a reported failure can follow a committed write. A staged Todo
belongs to this attempt only when its UID came from this attempt's successful
`todo-add` output; a title or creation-time match is a lead, never permission to
cancel or adopt it. After any failure or uncertain outcome, before retrying or
cleaning up:

1. Read `pmgr current --project P --json`, `pmgr todos --project P --json`, and
   the complete history: page `pmgr history --project P --limit 100 --offset <n> --json`
   until a page has fewer than 100 rows. Do not use `--since`; snapshots can be
   backdated with `--at`. A partial window cannot prove that something is absent.
2. If some snapshot has this write's summary and the staged UIDs in
   `nextTodoUids`, the write committed: keep every staged Todo and do not retry.
3. Otherwise, a staged Todo may be cancelled (`todo-update --uid <uid> --status cancelled`)
   or reused in a retry only when its UID was recorded from this attempt and no
   snapshot in the complete history lists it. A reference in any snapshot, even
   one later unpinned, means another write adopted it: keep it. Being unpinned
   now is not proof.
4. If staging failed partway, handle only the recorded UIDs; re-plan before
   running the final `add` with an incomplete set.
5. If the state or the complete history cannot be read, or a `todo-add` output
   was lost, change nothing for the affected Todos and report the incomplete
   operation with the known UIDs and any title matches.

### Retiring a watch Todo

Older Todos may hold watches or disclaimers. When your write touches that topic,
retire one with `--cancel-todo` only when:

1. every gate it still carries is recorded, with its evidence link, in the repo
   `todo.md` or another owning record (a Todo bundling several gates needs each one covered);
2. any check time it promises exists as a scheduled task, identified by name or
   id and verified per that tool's rules; and
3. the `add` names those destinations and the timer in `--progress`.

Otherwise keep it open and report the incomplete handoff. Retiring a watch never
claims its gate passed. Watches on topics you are not touching are left alone
and reported for triage with the user.

CLI behavior change: plain `add` keeps open pins instead of clearing them;
`--next` appends. Exact trimmed, case-sensitive titles reuse an existing open
Todo of the same project, or an unassigned Todo already pinned on it, preferring
a pin, then the oldest by creation time and UID. Its provenance stays unchanged. Duplicate new titles in one write still
create separate Todos. Do not combine `--next` and `--next-todo`.
`--replace-next` only replaces pins (or clears them with no next work); it does
not close Todos. The domain API defaults to replace; imports remain strict.

Legacy strings appear as `legacy-step` items until explicitly converted with
`pmgr todo-convert --project P --json`, or `--entry <id-or-uid> --index <n>`.
`--all` converts every current legacy source only when the user requests it;
back up first with `pmgr export --format json > backup.json`. Conversion is
idempotent and appends no snapshot. A plain `add` preserves partially converted
legacy strings; new next work requires conversion or `--replace-next`.
Once fully converted, the next carry-mode `add` pins the open converted Todos
in index order.

`current --json` adds live `openWork`, and text `current` marks pinned work.
Raw `nextSteps`, `nextTodoUids`, and `nextTodos` retain their existing meaning.
`history`, `at`, and `getEntry` do not gain `openWork`; `at` does not resolve
live Todo status. Project current state still comes from the latest snapshot.
Export emits version 5 whenever Todos are present, including null metadata; without Todos, existing version 2/3/4 selection remains. Import/export never carries, reuses, or closes work.
