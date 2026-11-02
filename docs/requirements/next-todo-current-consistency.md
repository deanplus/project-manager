# Next-Todo / current consistency

Status: Accepted and implemented — GO in review Rounds 5–6; follow-ups F2–F5 and N1–N3 closed in Round 8 (release 0.5.1)
Date: 2026-11-02 (Asia/Shanghai)
Builds on: [nextSteps as Todo references](../../requiments/nextsteps-as-todo-refs.md), [Independent Todos](../../requiments/todos.md)
Review: [docs/reviews/2026-11-02-next-todo-current-consistency.md](../reviews/2026-11-02-next-todo-current-consistency.md)

## Problem

0.5.0 made Todos the owner of concrete work and made snapshots pin Todos through `nextTodoUids`. The daily checklist still cannot answer "what is open for project P" from one place:

1. **Pins go stale or vanish.** CLI `add` always writes a new pin list. `add --next X` pins only X. `add` without `--next`/`--next-todo` pins nothing (`nextTodoUids: []`). A Todo created with `todo-add` is never pinned unless a later `add --next-todo` includes it. Cancelling a pinned Todo leaves it pinned (shown as `cancelled`) until the next `add`.
2. **Two tracks.** 26 of 34 projects in the real ledger still have a legacy latest snapshot (string `nextSteps`, `nextTodoUids` absent); 18 of those contain unconverted strings. Refs-format projects expose `nextTodos`. A consumer must read both shapes, and a partially converted legacy step appears as both a string and a Todo.
3. **Open Todos pile up out of sight.** `current` only shows the latest snapshot's pins, but the Todo table keeps every older open Todo. Real ledger, 2026-11-02: `sui-liquidate` has 11 open Todos and 2 pins. `meme-pipeline` has 4 open Todos and 0 pins. `project-mgr` has 2 open Todos and 0 pins.
4. **Repeated `--next` makes near-duplicates.** Each session's `add --next` creates a new Todo. Earlier Todos for the same work are not closed, and the CLI cannot close them in the same write.

Root cause: the pin list has replace semantics, but agents write it as a per-session append log. No read path combines pins, unpinned open Todos, and legacy strings into one list.

## Goals

- One read API gives the full open work for a project, or for all projects: pinned first, then unpinned open Todos, plus legacy strings not yet converted.
- A routine `add` keeps the current pinned work unless the author says otherwise.
- An agent can close superseded Todos in the same `add` transaction.
- The read paths stop showing a second track once legacy strings are converted.
- Append-only history and the 0.5.0 storage format stay unchanged.

## Non-goals

- Automatic cancellation of older or similar Todos (see Migration, M3).
- Semantic or fuzzy deduplication. Only exact title reuse is in scope (R4.4).
- Todo start/due timestamps (ledger Todo `21b3e139`) and editing Todo title/content (ledger Todo `589f0f47`). Each needs its own requirement.
- Cancellation timestamps or reasons. `completed_at` stays the only lifecycle timestamp.
- Dashboard UI changes. The dashboard keeps rendering `nextTodos`; adopting `openWork` there is a follow-up.
- Changes to `completeActivity` follow-up copying (it still copies pins unchanged, per the accepted RFC F1).
- Rewriting historical snapshots, schema migrations, or export format changes. The `at` semantics also stay as they are.

## Definitions

- **Latest snapshot of P**: the `current(db, P)` row (`occurred_at DESC, id DESC`).
- **Effective legacy source**: `legacySource(db, latest)` — the latest snapshot, or its `nextStepsSourceUid` origin.
- **Pins of P**: `latest.nextTodoUids` when present. For a legacy latest, pins are the effective source's indices in order. An index resolves to its Todo when one exists, otherwise to the legacy string.
- **Open work of P**: the pins whose item is open, then every other `status = 'open'` Todo with `project = P`.

## Requirements

### R1 — Domain function `openWork(db, project?)`

Add one shared read function in `src/db.ts`, exported from `src/index.ts`. Each item has one of these shapes:

```ts
type OpenWorkItem =
  | {
      kind: "todo";
      uid: string;
      title: string;
      project: string | null;
      pinned: boolean;
      pinIndex: number | null; // index in the pin list, null when unpinned
      createdAt: string;
      entryUid: string | null; // provenance, unchanged
    }
  | {
      kind: "legacy-step";
      project: string;
      entryUid: string; // effective legacy source uid
      stepIndex: number;
      title: string; // the original string
      pinned: true;
      pinIndex: number; // equals stepIndex
    };
```

Selection for project P:

1. Pins of P, in pin order. Include a pinned Todo only when its status is `open`. A pinned Todo may be unassigned; it still appears under P. Include an unconverted legacy index as a `legacy-step`.
2. Then unpinned Todos with `project = P` and `status = 'open'`, ordered by `createdAt, uid`.
3. A Todo appears at most once.

Without `project`, return the projects in `current()` order. Unassigned open Todos that no project's latest snapshot pins go last, ordered by `createdAt, uid`. Group these under `project: null`.

### R2 — CLI `pmgr next`

- `pmgr next [--project <name>] [--json]`, also available as `pmgr status next`. Add it to `allowedFlags`, `commandHelp`, and the usage error string.
- `--json` prints `OpenWorkItem[]` as one JSON line.
- Text mode prints one line per item: `<project or ->\t<uid | entryUid#stepIndex>\t<pinned|->\t<title>`. With no items it prints `No open work.`.
- An unknown `--project` returns an empty list, matching the `todos` command.
- This is the canonical daily-checklist source. It replaces reading `nextSteps` plus `nextTodos` plus `todos`.

### R3 — `current` exposes open work

- In `current --json`, every entry gains `openWork: OpenWorkItem[]` for its project, built with `openWork`. `nextSteps`, `nextTodoUids`, and `nextTodos` keep their 0.5.0 shape and meaning (raw pins with live status), for backward compatibility.
- In text mode, `current` prints each item under its project line as `  - <title>` with a ` [pinned]` suffix when pinned. `history` text output stays unchanged.
- `history`, `at`, and `getEntry` do not gain `openWork`; it describes current state only.

### R4 — `add` pin semantics

The domain `addStatus` input gains `nextMode?: "carry" | "replace"`. The default stays `"replace"`, so direct API callers, imports, existing tests, and server code keep today's behavior. CLI `add` passes `"carry"` unless `--replace-next` is given.

**R4.1 carry.** The new pin list is the carried pins, then the new uids from this write. Keep the first occurrence of each uid (no duplicate-uid error from carrying).

- If the latest snapshot has refs, carried pins are `latest.nextTodoUids` filtered to Todos whose status is `open`. Apply the filter after R4.3 closes Todos in the same write.
- If the latest snapshot is legacy and every source index has a Todo, carried pins are those Todo uids in index order, filtered to `open`.
- If the latest snapshot is legacy and some index is unconverted: with no new next work, copy the legacy string list exactly as `preservedNextWork` does today (full strings plus `nextStepsSourceUid`, `nextTodoUids` absent). With `--next` or `--next-todo`, reject with `ValidationError("project <P> has unconverted legacy next steps; run pmgr todo-convert --project <P> or pass --replace-next")`. The mixed-row ban still applies.
- If no snapshot exists, carried pins are `[]`.

**R4.2 replace.** The new pin list is exactly the uids from this write, `[]` when there are none. This is today's behavior. `--replace-next` with no `--next`/`--next-todo` is the explicit "unpin everything" write. Unpinning never changes Todo status (RFC rule 5 still holds).

**R4.3 close in the same write.** CLI `add` gains repeatable `--done-todo <uid>` and `--cancel-todo <uid>`. The domain input gains `closeTodos?: { uid: string; status: "completed" | "cancelled" }[]`.

- Each uid must exist and have `project = P`, or be in P's current pins. Otherwise the write fails with a `ValidationError` and nothing is written.
- A uid in both lists, or also in `--next-todo`, is rejected.
- The status changes go through the same code as `updateTodo` (`completedAt` handling unchanged), inside the `add` transaction, before pins are computed. A Todo already in the target status is a no-op.
- These flags work in both modes and with an empty `--next`.

**R4.4 exact-title reuse for `--next`.** In either mode, for each `--next` title (trimmed), look for an open Todo that existed before this write, has an identical title, and either has `project = P` or is an unassigned Todo in P's current pins (F2, 0.5.1). If one exists, use its uid instead of creating a Todo: prefer the pinned one, otherwise the oldest by `createdAt, uid`. Its provenance (`entryUid`, `stepIndex`) does not change. Duplicate titles within one write keep today's behavior (separate Todos). Matching is exact and case-sensitive; no normalization beyond `trim()`.

**R4.5 retry and identity.**

- `--external-ref` replays still return the stored entry before any carry, reuse, or close logic runs. They create, close, or reuse no Todos.
- Fixed-uid domain retries (`existingIdentity(..., textRetry = true)`) must stay idempotent in carry mode, except the L2 case below. A retry is the same write when all non-next fields match, the stored pin list ends with the uids this write resolves to in input order, and the titles match. Compare against the stored snapshot, without reapplying carry, title reuse, or closures from current state. Otherwise it throws `conflicting entry uid`. Imports keep strict portable equality; they never use `nextMode` or `closeTodos`.
- **Known limitation (L2, option 1, user decision 2026-11-02):** When a carry-mode write re-names an already-carried pin under a fixed uid, R4.1 keeps the uid's first position while R4.5's strict suffix check rejects an identical retry with `conflicting entry uid`. Accept this as a documented limitation: the CLI never passes fixed uids; `--external-ref` replays are unaffected. Do not change carry order or suffix rules for this case.

**R4.6** `--next` combined with `--next-todo` stays rejected.

### R5 — CLI `todo-convert`

Expose the existing `convertNextStep` on the CLI:

- `pmgr todo-convert --entry <id-or-uid> --index <n> [--json]` converts one index.
- `pmgr todo-convert --project <P> [--json]` converts every unconverted index of P's effective legacy source.
- `pmgr todo-convert --all [--json]` does the same for every project whose latest snapshot is legacy.
- Only one of `--entry`/`--project`/`--all` may be used. `--index` requires `--entry`.
- The command is idempotent, appends no snapshot, and outputs the resulting Todos (existing and new). The dashboard's HTTP conversion route keeps working.
- After conversion, R4.1's materialization path pins those Todos on the next carry-mode `add`.

### R6 — Documentation and agent guidance

Update `README.md`, `README_CN.md`, `skills/project-mgr/SKILL.md`, `docs/architecture.md`, and `CHANGELOG.md`:

- The daily checklist is `pmgr next --json`. Do not combine `nextSteps`, `nextTodos`, and `todos` by hand.
- Before `add`, run `pmgr next --project P --json`. Decide each open item: keep it (do nothing; it is carried), finish it (`--done-todo`), or retire it as superseded (`--cancel-todo`). Use `--next` only for new work.
- `--next` must name an action, not a status description. Blockers belong in `--blocker`.
- `--replace-next` only unpins; it does not close Todos.
- State the CLI behavior change: plain `add` now keeps pins instead of clearing them.

## Compatibility

| Area                              | Effect                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Storage / schema                  | None. Same columns and the same format table from the RFC (Round 2 F9). No mixed rows.                                                     |
| Historical snapshots              | Never rewritten. Carried pins are written on the new snapshot only.                                                                        |
| `nextTodoUids` / `nextTodos` JSON | Unchanged. `openWork` is additive.                                                                                                         |
| Domain `addStatus`                | Defaults to `replace`; existing callers are unchanged.                                                                                     |
| CLI `add`                         | **Behavior change**: plain `add` carries open pins, and `--next` appends instead of replacing. `--replace-next` restores the old behavior. |
| `completeActivity`                | Unchanged (copies pins as-is). `openWork` hides non-open pins at read time.                                                                |
| Import / export                   | Unchanged. Imports bypass carry, close, and reuse. Version 4 bundles round-trip.                                                           |
| Ownership lock                    | Unchanged. Carrying an unassigned pinned Todo onto the same project's snapshot is allowed today and stays allowed.                         |

## Migration and cleanup

- **M1 — No data migration.** `openWork` is derived; nothing is backfilled.
- **M2 — Legacy conversion (one time, user-run).** After a backup (`pmgr export --format json > backup.json`), the user runs `pmgr todo-convert --all`. This creates Todos only for unconverted indices of each project's latest legacy source; history is not touched. Until then, `openWork` shows those strings as `legacy-step` items, so nothing is lost. Conversion is explicit because the Todos RFC says imports and reads never create work.
- **M3 — Stale open Todos: triage, no auto-cancel.** The product does not cancel older next Todos automatically, for three reasons:
  1. A Todo status is a claim about work. Cancelling by age or similarity invents that claim with no evidence.
  2. The accepted RFC (rule 5) says unpinning must not change status.
  3. The real data mixes true duplicates (`sui-liquidate` `ba7634db` vs `9372df0f`, both "SDK upgrade") with distinct work (`e7a10ad8` natural acceptance vs `31876fd0` BlockVision quota).

  Instead, `pmgr next --json` shows every open Todo, with `pinned: false` marking the backlog. A one-time triage per project works like this: an agent proposes keep/done/cancel for each unpinned item with evidence, the user confirms, and `todo-update` (or `add --done-todo/--cancel-todo`) applies it. Baseline on 2026-11-02: `sui-liquidate` 11 open / 2 pinned, `meme-pipeline` 4/0, `weather-lp` 3/3, `project-mgr` 2/0, `negrisk-basket` 2/2, `morpho` 1/1, `articles` 1 plus a legacy string.

- **M4 — How `current` reaches the latest open work.** `current` itself does not change which snapshot it returns. `openWork` is computed live from Todo state, so cancelling, completing, or creating a Todo is reflected at once without writing a snapshot. New Todos created with `todo-add --project P` appear as unpinned open work. They are pinned on the next carry-mode `add` that names them with `--next-todo`.

## Acceptance criteria

Each item needs an automated test. Domain tests use `:memory:`. CLI tests use `run()` with a temporary `PMGR_DB_PATH`.

1. `add --next A`, then `add --next B` (CLI): latest `nextTodoUids` is `[A, B]`, and `openWork` lists A and B as pinned.
2. `add --next A`, then plain `add`: latest `nextTodoUids` is `[A]`, not `[]`.
3. `add --next A`, then `todo-update A --status cancelled`: `openWork` is empty, while `current.nextTodos` still shows A as `cancelled` (unchanged).
4. After step 3, plain `add`: the new pins exclude A.
5. `todo-add --project P --title C`: `next --project P` lists C as unpinned (`pinned: false`) with no new snapshot. `add --next-todo C` then pins it after the carried pins.
6. `add --next B --done-todo A` sets A to `completed` with `completedAt`, and the pins are `[B]`, in one transaction. An invalid `--done-todo` uid rolls back the whole write: no snapshot, no B.
7. `add --next "A"` while an open Todo titled `A` exists in P creates no Todo and pins the existing uid. `add --next "A" --next "A"` with no prior `A` still creates two Todos.
8. `add --replace-next`: pins are `[]` and Todo statuses are unchanged. `add --replace-next --next D`: pins are `[D]`.
9. Legacy latest with an unconverted index:
   - plain `add` copies the strings plus `nextStepsSourceUid` (same as `completeActivity`);
   - `add --next X` is rejected with the R4.1 message;
   - `openWork` shows `legacy-step` items, and converted indices as `todo` items in index order with no duplicate.
10. `todo-convert --project P` is idempotent and appends no snapshot. A later plain `add` materializes refs in index order, filtered to open.
11. `next` without `--project` groups by project in `current()` order. Unassigned unpinned open Todos come last under `project: null`. An unassigned Todo pinned by P is listed under P only.
12. A domain `addStatus` call without `nextMode` behaves exactly as in 0.5.0, so existing `test/next-todos.test.ts` passes unmodified. Import and export round-trip tests pass unchanged.
13. An `--external-ref` replay of a carry-mode `add` with `--done-todo` returns the stored entry and changes no Todo. A fixed-uid domain retry in carry mode returns `inserted: false`; changing the summary throws `conflicting entry uid`.
14. CLI help lists `next`, `todo-convert`, `--replace-next`, `--done-todo`, and `--cancel-todo`. Unknown-flag validation covers them.
15. `pnpm test`, `tsc --noEmit`, and ESLint pass.

## Open questions (non-blocking; defaults chosen)

- Whether `completeActivity` should also drop non-open pins. Default: no (non-goal); revisit when the dashboard adopts `openWork`.
- A dashboard "Open work" panel built on `openWork`. Default: a follow-up requirement.
- Re-pinning a carried uid under a fixed uid (**L2**). **Decided 2026-11-02: option 1** — keep first-occurrence carry order and the R4.5 strict suffix; document the fixed-uid retry conflict as a known limitation (CLI never passes fixed uids; `--external-ref` unaffected). No move-to-tail reorder.

## Scope

Requirements only. No implementation, commit, push, release, dashboard restart, or production ledger mutation is implied by this document. The existing `requiments/` directory (user's spelling) holds earlier RFCs; new requirements go under `docs/requirements/` as requested on 2026-11-02.
