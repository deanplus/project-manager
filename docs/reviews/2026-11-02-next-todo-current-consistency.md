# Review: Next-Todo / current consistency

Append-only. Later rounds go below the last section; earlier text is not edited.

Requirements: [docs/requirements/next-todo-current-consistency.md](../requirements/next-todo-current-consistency.md)
Related RFC: [requiments/nextsteps-as-todo-refs.md](../../requiments/nextsteps-as-todo-refs.md) and [its review](./nextsteps-as-todo-refs.md)

## Round 0 — Evidence review of reported checklist issues (2026-11-02)

Reviewer: Claude Code (documentation-only pass; no implementation)
Code reviewed: `main` at `6afd261`, package `0.5.0` (the installed `pmgr` reports `0.5.0` too)

### Method

- Read `src/cli.ts`, `src/db.ts` (`addStatus`, `preservedNextWork`, `current`, `annotateEntry`, `listTodos`, `updateTodo`, `createTodo`, `convertNextStep`, `completeActivity`, `existingIdentity`), `src/server.ts` Todo routes, `test/next-todos.test.ts`, the two RFCs, `docs/architecture.md`, `CHANGELOG.md`, and `skills/project-mgr/SKILL.md`.
- Ledger data: made a `sqlite3 .backup` copy of `~/.local/share/project-mgr/project-mgr.sqlite` to `/tmp/pmgr-audit-*/ledger.sqlite` and queried only the copy. The real ledger was not opened by `pmgr` and was not changed.
- Behavior: ran a reproduction with the installed `pmgr` 0.5.0 against a new isolated `PMGR_DB_PATH=/tmp/pmgr-audit-*/scenario.sqlite`.

Reproduction transcript (isolated DB):

```text
add --next "Task A"; add --next "Task A again"
  current: nextSteps=[]  nextTodoUids=[<A2>]  nextTodos=[("Task A again", open)]
add (no --next)
  current: nextSteps=[]  nextTodoUids=[]  nextTodos=[]
todo-add "Indep C"; add --next-todo <C>; todo-update <C> --status cancelled
  current: nextTodoUids=[<C>]  nextTodos=[("Indep C", cancelled)]
todos --project demo --status open
  Task A, Task A again        # both open, neither pinned
current (text mode)
  demo  active  ...  s4       # no next work printed at all
todo-update --title x    -> "unknown flag for todo-update: --title"
todo-add --due ...       -> "unknown flag for todo-add: --due"
```

### Observation verdicts

**O1 — `nextTodoUids` goes stale, and new open Todos are not written back into current: CONFIRMED (by design, but a product defect).**

- `addStatus` text path (`src/db.ts:411–436`) always sets `nextTodoUids = input.nextSteps.map(randomUUID)`. CLI `add` with no `--next` passes `nextSteps: []` and no `nextTodoUids` (`src/cli.ts:419–441`), so it writes `[]` and drops every pin. The CLI has no "keep pins" mode.
- Cancelled or completed Todos stay pinned. `annotateEntry` resolves live status (`src/db.ts:641–642`), so they show as `cancelled` rather than being hidden. This is correct for an append-only model, but the checklist has to filter them.
- `todo-add --project P` never touches snapshots (`createTodo`). The RFC says pinning needs a new snapshot ("Dashboard / API" section, rule 6). Real ledger: the two `project-mgr` Todos created with `todo-add` were never pinned, and `project-mgr`'s latest refs are `[]`.

**O2 — Dual track (`nextSteps` text vs `nextTodos`): CONFIRMED, and larger than reported.**

- New-format snapshots never store text, but legacy latest snapshots still do. In the ledger copy, 26 of 34 projects have a legacy latest snapshot; 18 of those have unconverted strings. 8 projects are on refs.
- `articles` shows the duplicate case: its latest legacy string at index 0 was converted to a Todo, so the same work appears once as `nextSteps[0]` and once as an open Todo.
- The CLI has no conversion command; `convertNextStep` is reachable only through the dashboard HTTP route (`src/server.ts:319`). Agents cannot clear the legacy track from the CLI.

**O3 — Historical entries keep many stale open Todos while `current` sees only the latest snapshot: CONFIRMED.**

Ledger copy, 2026-11-02 (open Todos / pinned on latest):

| Project        | Open | Pinned | Notes                                                                    |
| -------------- | ---- | ------ | ------------------------------------------------------------------------ |
| sui-liquidate  | 11   | 2      | 9 unpinned, from 9 different snapshots (`1922`…`1978`)                   |
| meme-pipeline  | 4    | 0      | latest `nextTodoUids` is `[]`; `4cf31398`/`a925d4b3` are near-duplicates |
| project-mgr    | 2    | 0      | the two product-gap Todos (O5)                                           |
| weather-lp     | 3    | 3      | consistent                                                               |
| negrisk-basket | 2    | 2      | consistent                                                               |
| morpho         | 1    | 1      | consistent; 82 cancelled, so bulk cleanup has been done by hand before   |

`listTodos(--status open --project P)` already lists all of these and puts pins first (`src/db.ts:1059–1094`). But nothing tells the checklist to use it instead of `current`, and without `--project` there is no pin ordering.

**O4 — Each `add` adds another next step; old next Todos are not auto-closed: CONFIRMED.**

- RFC Round 1 F6 says identical `--next` text on a later snapshot creates a new Todo. RFC rule 5 says unpinning never cancels.
- `add` cannot close a Todo. That takes a separate `todo-update` call, which agents skip.
- Examples: `sui-liquidate` `ba7634db` and `9372df0f` (both the Suilend SDK upgrade); `1ff5d945` and `ba1b9f10` (both cooldown deploy decision and natural timeout acceptance).
- Several Todos describe state rather than an action (`d5ba7c88` "Clock R3 需求差异仍待确认…"). The agent guidance does not separate next actions from status notes.

**O5 — Product-gap Todos `21b3e139` and `589f0f47`: CONFIRMED present.**

- `21b3e139-69ef-48e6-ba39-d122f6a05afa`: open, project `project-mgr`, "需求：代办开始时间 + 截止时间（精确到秒）". Earlier drafts `8cd380d6` and `76114006` are cancelled.
- `589f0f47-53ae-42d3-9ec8-131752eed34b`: open, project `project-mgr`, "需求：todo 支持修改 title、content（无则新增字段）、status 等".
- Code: the `todos` table has no start, due, content, or `updated_at`/`cancelled_at` columns (migration 4, `src/db.ts:122–131`). `todo-update` accepts only `uid`, `status`, and `project`; the RFC lists title mutation as out of scope for v1. Status is already editable; title and content are not.
- Decision: kept out of this requirement (listed as non-goals). Each needs its own requirements document.

### Additional findings

**A1 / P2 — CLI text output hides next work.** `current` text mode prints only `project/status/time/summary` (`src/cli.ts:270–286`). `todos` text mode does not mark pins. A human or agent reading the text output cannot see open work. Addressed by R3 and R2.

**A2 / P2 — The domain API and the CLI cannot express the same intents.** The domain separates "explicit `nextTodoUids: []`" (clear) from "absent". The CLI cannot express "keep current pins" or "unpin all" on purpose; a plain `add` happens to do the latter. Addressed by R4 (`nextMode`, `--replace-next`).

**A3 / P3 — Review trail gap on the previous change.** `docs/reviews/nextsteps-as-todo-refs.md` ends at Round 7 **NO-GO** (F13 partial, F15 new), but PR #1 was merged as `6afd261`. The code appears to address both:

- `importStatuses` passes an empty payload set (`src/db.ts:498–513`);
- `existingIdentity` limits text/ref equivalence to `textRetry` (`src/db.ts:319–343`);
- `CHANGELOG.md` 0.5.0 "Fixed" describes both fixes.

No closing round records GO. This was not re-verified with tests in this pass. A short closure round should be appended to that review so the audit trail matches what shipped.

**A4 / P3 — No cancellation audit.** `updateTodo` sets `completedAt` to null on cancel and stores no timestamp or reason. Triage (M3) therefore leaves no record of why a Todo was retired. This is recorded as a non-goal; it falls under the same follow-up as `21b3e139`.

### Assessment of the requirements document

- **Specific enough to implement:**
  - every new flag, field, and command has a name, a shape, ordering rules, error text, and transaction boundaries;
  - the domain default (`replace`) keeps the existing tests and imports unchanged;
  - 15 acceptance criteria map one-to-one to tests.
- **Main implementation risk:** R4.5, fixed-uid retry equivalence in carry mode. Carried pins depend on Todo state at write time, so the check must compare against the stored suffix and not recompute. The requirement states the rule and has acceptance item 13. The implementer should add a negative test where a Todo is cancelled between the original write and the retry; the retry must still return `inserted: false`.
- **Behavior change risk:** plain CLI `add` now carries pins. This changes intent for any script that relied on `add` to clear pins. No such usage was found in the repo or SKILL guidance; `--replace-next` is the escape hatch. The changelog must call it out (R6).
- **Policy decision recorded:** no auto-cancel (M3), with evidence that age or similarity heuristics would cancel distinct work.

### Disposition

**GO for implementation handoff (requirements level).** O1–O5 are confirmed with code and data evidence. The requirements cover O1–O4. O5 is explicitly deferred to separate requirements. Implementation correctness still needs a post-implementation cross-review appended here.

### Scope and limitations

- No source, test, or ledger changes. The only files created are this review and the requirements document.
- The real ledger was read only through a `sqlite3 .backup` copy in `/tmp`. The reproduction used an isolated temporary DB.
- No test suite was run (no code changed). The installed `pmgr` binary was used for the reproduction and matches the repo version `0.5.0`.
- No commit, push, release, or dashboard restart.

## Round 1 — Author implementation notes (2026-11-02)

Author: Codex. Fresh implementation session `01a19a31-7c72-7431-b2f7-5e89e959b641`; no old author or reviewer session resumed.
Baseline and current HEAD: `6afd26127da438cf810acd300e198f140914cde9` (`6afd261`). All implementation changes remain uncommitted; no staging, commit, push, npm publication, dashboard restart, or real-ledger access.

### Implementation and changed files

- `src/db.ts`: exported `OpenWorkItem`, `AddStatusInput`, and `openWork`; pin-first open Todo/legacy selection; carry/replace modes; same-transaction close validation through `updateTodo`; exact-title reuse; stored-suffix fixed-UID retry equivalence. New Todo provenance records its index in the final refs, after carry and deduplication. Imports retain strict portable validation; no schema change.
- `src/cli.ts`: `next` / `status next`; CLI-only current `openWork` JSON and text; default carry; replace/done/cancel flags; idempotent `todo-convert` by entry/index, project, or all current legacy sources; help and unknown-flag validation.
- `src/index.ts`: no edit needed; existing `export * from "./db.js"` exports the new API and types. The new tests import them through this entry point.
- `test/open-work.test.ts`: 20 new automated tests mapping acceptance items 1–14 and additional rollback, provenance, ordering, ownership, retry, and portable-limit cases. Existing tests, including `test/next-todos.test.ts`, are unchanged.
- `README.md`, `README_CN.md`, `skills/project-mgr/SKILL.md`, `docs/architecture.md`, `CHANGELOG.md`: canonical `next --json` checklist; before-add keep/done/cancel triage; action-only `--next`; explicit replace behavior; legacy conversion; CLI behavior change. New agent-authored text is English per project instructions, including updated passages in `README_CN.md`.
- This review document: appended this round without editing Round 0. Generated review/verification evidence is under [evidence/2026-11-02-next-todo-current-consistency](./evidence/2026-11-02-next-todo-current-consistency/).

The requirements directory and this Round 0 review file were already untracked at session start. They were preserved; requirements were not edited. Implementation adds the test file and evidence, modifies the seven tracked files above, and appends this review. The final implementation diff including the new test is preserved in [final.diff](./evidence/2026-11-02-next-todo-current-consistency/final.diff).

### Verification

- `pnpm test`: **58 tests passed, 0 failed** (38 existing, 20 new).
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec eslint .`: passed.
- `pnpm exec prettier --check src/db.ts src/cli.ts test/open-work.test.ts README.md README_CN.md skills/project-mgr/SKILL.md docs/architecture.md CHANGELOG.md`: passed.
- `git diff --check`: passed.
- Domain tests use `:memory:`; CLI tests use `run()` with a temporary `PMGR_DB_PATH`. The real `~/.local/share/project-mgr/project-mgr.sqlite` was never opened or changed. Existing import/export tests pass unchanged; a new carry/reuse/duplicate-title round trip catches the provenance regression identified below.
- Isolated skill closeout: `current -> next -> add -> current` verified for temporary project `project-mgr`, record `1`; the temporary DB was removed. This is not a real-ledger status update. See [closeout.txt](./evidence/2026-11-02-next-todo-current-consistency/closeout.txt).
- Full author test transcript and command outcomes: [validation.txt](./evidence/2026-11-02-next-todo-current-consistency/validation.txt).

### Clarifications, deviations, and remaining limitation

1. **L2 remains OPEN: R4.1/R4.5 conflict.** With original pins `[A,B]`, a fixed-UID carry write naming `A` keeps `[A,B]` under first-occurrence deduplication. Its identical retry fails R4.5's strict suffix test because the stored list ends in `B`. This affects both text reuse and explicit refs; relaxing matching would also relax conflict detection without a stored write-intent identity. The implementation follows the explicit strict-suffix rule and records this limitation in an automated test. A user clarification was requested asynchronously; no decision has arrived at the time of this round. Ordinary suffix-based carry retries, including Todo status changes and close flags, are idempotent. **Do not treat full carry-retry acceptance as complete or this round as an implementation GO.**
2. For `openWork`, `project` is the display group: an unassigned pinned Todo is emitted under its pinning project, while its stored ownership and raw `nextTodos.project` stay null. If multiple latest snapshots pin it, the first project in `current()` order wins globally; a project-specific query still includes it. This implements the requirement's grouping and at-most-once rules without ownership mutation.
3. Projects with open Todos but no status snapshot follow snapshot-bearing projects in slug order, before unassigned Todos. This fills an unspecified ordering case while ensuring the full open-work list does not omit independent project work.
4. Carry retains the existing portable maximum of 100 refs. Overflow rejects and rolls back, rather than creating an export that the unchanged importer cannot restore. Duplicate titles within a single write remain separate: only the first occurrence may reuse a prior Todo; later occurrences create distinct Todos.
5. Historical reads, `completeActivity`, dashboard UI/routes, O5, import/export storage formats, and automatic cancellation remain outside the change. No other deviations.

### Review evidence and dispositions

The user-level engineering workflow calls for an independent Claude cross-review. Host CLI version/authentication and the first-party destination were verified; the prompt, scoped diff, and allowlisted content were checked for sensitive paths and common credential patterns. The scan is scoped and is not a guarantee. A fresh reviewer session ID was generated, but automatic approval rejected process creation for the external review despite the standing user-level authorization. **External Claude review status: failed / platform-blocked; no Claude review report exists.** No attempt was made to bypass the refusal or repeat the same authorization question.

- Requested fresh external reviewer ID: `11c05c1c-f278-43f2-80ec-4bcc1967d412`; never started. Claude Code CLI `2.1.312`; requested `sonnet`, effort `high`; actual review model unknown.
- [Actual prompt](./evidence/2026-11-02-next-todo-current-consistency/round-1-prompt.txt), [pre-review tracked diff](./evidence/2026-11-02-next-todo-current-consistency/round-1.diff), and [exact rejection, invocation, and authorization scope](./evidence/2026-11-02-next-todo-current-consistency/claude-rejection.txt).
- Available alternative: internal local read-only reviewer `/root/local_readonly_review`, fresh task, no inherited author history, no Claude/network tools or sensitive/real-ledger access. This is an independent local review, **not a completed Claude cross-model review**. Actual model metadata is unavailable. Static requested scope was covered; the reviewer also ran memory/temporary-DB reproductions, tests, TypeScript, and ESLint.
- The original English reviewer findings, verification boundaries, and same-reviewer fix confirmation are preserved in [local-review.md](./evidence/2026-11-02-next-todo-current-consistency/local-review.md).

Coder dispositions:

- **L1 / P1 — accepted, fixed, independently verified CLOSED.** The first implementation wrote new Todo `stepIndex` using the text-input offset, which failed strict export/import after carry. The fix writes the final snapshot ref index and adds a regression. The reviewer independently verified five carry/reuse/duplicate-title round-trip cases, including filtering a cancelled pin; no importer check was weakened.
- **L2 / P2 — confirmed, OPEN for requirements clarification.** Preserve both first-occurrence deduplication and the explicit strict-suffix check for now; the broader carry-idempotence statement cannot hold for the non-suffix re-pin case under those two rules. No silent identity relaxation or schema expansion was introduced.
- The same local reviewer checked the final source comment and L2 regression delta: L1 stays closed, L2 stays open, no new concern. Final reviewed source-diff SHA-256: `acdbbf3bc0073ec27416cafa29106f47677e045eb1ac2d71d157955fc655472a`; test SHA-256: `fdcbf22c2abb5ef4523a21b6c6a72cf44818c527ca39180ed8981f6f2b6c2e83`.

Summary disposition: implementation and local validation delivered, with L2 specification clarification and unavailable external Claude cross-review explicitly outstanding. No claim of full acceptance, publication, or production-ledger update.

## Round 2 — Cross-model implementation review (2026-11-02)

Reviewer: Claude Code (Opus), session `9e1f55a8-c7d2-4e5f-a698-72de8f1f3b55`. This is the same session that wrote Round 0 and the requirements. It is a cross-model reviewer relative to the Codex author session `01a19a31-7c72-7431-b2f7-5e89e959b641`.
Object reviewed: uncommitted worktree on top of `6afd261`. Changed: `src/db.ts`, `src/cli.ts`, `CHANGELOG.md`, `README.md`, `README_CN.md`, `docs/architecture.md`, `skills/project-mgr/SKILL.md`. Added: `test/open-work.test.ts` and the evidence directory.
Mode: read-only. No business code, test, requirements, or earlier-round edits. No commit or push. The real ledger was not opened; its mtime (`11:09`) did not change across this round's probe runs.

### Method

- Read the full `src/db.ts` and `src/cli.ts` diffs against every requirement (R1–R6) and against the Round 1 author notes. Skimmed the docs and skill diffs for agreement with R6.
- Re-ran the author's gates: `pnpm test` gave **58/58 pass**; `pnpm exec tsc --noEmit`, `pnpm exec eslint .`, and `git diff --check` all passed. Every test file sets `PMGR_DB_PATH`.
- Domain probes: ad-hoc `tsx` scripts on `:memory:` ledgers (scripts lived in `/tmp`, since deleted).
- CLI probes: `node --import tsx src/cli.ts` with `PMGR_DB_PATH=/tmp/r2probe/cli.sqlite` (deleted).

### Acceptance criteria

| AC                                                                  | Result                             | Evidence                                                                                                         |
| ------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1 `--next A` then `--next B` pins `[A,B]`                           | PASS                               | CLI probe: `current` text shows both `[pinned]`                                                                  |
| 2 plain `add` keeps pins                                            | PASS                               | tests and CLI probe                                                                                              |
| 3 cancel hides from `openWork`, raw `nextTodos` unchanged           | PASS                               | tests                                                                                                            |
| 4 carry excludes cancelled pins                                     | PASS                               | probe P5, legacy-materialize variant: only the open Todo is carried                                              |
| 5 `todo-add` shows as unpinned; `--next-todo` appends               | PASS                               | tests                                                                                                            |
| 6 `--done-todo` is atomic; an invalid uid rolls back                | PASS                               | probe P4 (`t1` closed, pins `[t2,t3]`, `t3.stepIndex=1`); probe P3 (foreign Todo rejected, its status unchanged) |
| 7 exact-title reuse; duplicates within one write stay separate      | PASS                               | probe P2 (trimmed title reused; Todo count 1) and tests                                                          |
| 8 `--replace-next`                                                  | PASS                               | CLI probe: `[]`, items then shown as unpinned backlog                                                            |
| 9 legacy pending: copy / reject / mixed `openWork`                  | PASS (CLI)                         | CLI probe: exact R4.1 error text; plain `add` copies `['L0','L1']` with refs absent. Domain edge case: see F1    |
| 10 `todo-convert` idempotent, no snapshot; later carry materializes | PASS                               | CLI probe: two runs give the same 2 Todos, history count unchanged, the next `add` pins 2 refs                   |
| 11 global grouping                                                  | PASS                               | tests and `pmgr status next` probe                                                                               |
| 12 domain default is replace; old tests unchanged                   | PASS                               | `test/next-todos.test.ts` unmodified and passing                                                                 |
| 13 external-ref replay and fixed-uid retry                          | PASS for suffix cases; **L2 open** | tests; probe reproduces L2 (`conflicting entry uid` on the re-pin retry)                                         |
| 14 help and flag validation                                         | PASS                               | CLI probe: help lists `next`, `todo-convert`, and the three new flags; argument-conflict errors verified         |
| 15 test / tsc / eslint                                              | PASS                               | re-run above                                                                                                     |

### Findings

**F1 / MAJOR — The domain carry path can write a mixed row that cannot be imported again.**

- Location: `addStatus` carry branch, `preserved.nextTodoUids === undefined` (`src/db.ts`, the legacy-pending path). The guard rejects only `input.nextTodoUids?.length`, so an explicit `nextTodoUids: []` passes. `{ ...input, ...preserved }` then keeps `nextTodoUids: []` next to the copied legacy strings.
- Reproduction (`:memory:`):
  1. Import a legacy entry with `nextSteps: ["x"]`.
  2. Call `addStatus(db, { project, status, summary, nextMode: "carry", nextTodoUids: [] })`.
  3. The stored entry has `nextSteps: ["x"]`, `nextTodoUids: []`, and `nextStepsSourceUid` set.
  4. `exportLedger`, then `importLedger` into a fresh DB, fails with `cannot combine nextSteps text with nextTodoUids`.
- Impact: this breaks the RFC format table (Round 2 F9, "no mixed rows") and the export/import round trip. The CLI cannot reach it, because it only passes `nextTodoUids` when `--next-todo` is non-empty. Only direct callers of the exported `addStatus` with `nextMode: "carry"` can.
- Fix: in that branch, reject when `input.nextTodoUids !== undefined`, using the existing R4.1 error. Alternatively, strip the field before spreading `preserved`. Add a regression test that asserts rejection, or a refs-absent row, plus an export/import round trip.

**F2 / MINOR — Exact-title reuse ignores an unassigned Todo that the project already pins.**

- Reproduction: `createTodo({title:"shared"})` (unassigned), then `add --next-todo <it>` on project U, then a carry `add --next "shared"`. The result is two pinned open Todos titled `shared`.
- This matches R4.4 as written ("open Todo with `project = P`"), so it is a requirements gap, not an implementation defect. It reproduces O4 (synonymous pile-up) for unassigned pinned work.
- Advice: a requirements follow-up should extend reuse candidates to "`project = P` or in P's current pins". Not blocking.

**F3 / MINOR — `README_CN.md` gained English paragraphs.**

- The new and replaced passages are English inside the Chinese README. This follows the project rule that files are written in English, but it leaves the Chinese README mixed-language.
- Advice: translate them, or note why they stay English, before release. Not a code issue.

**F4 / NIT — `current` repeats `current()` per project.**

- CLI `current` calls `openWork(db, entry.project)` once per project, and each call runs `current()` and `listTodos()` again. With N projects that is O(N²) queries.
- Acceptable at today's scale (about 34 projects). A single `openWork(db)` pass grouped by project would avoid it if the ledger grows.

**F5 / NIT — Rollout dependency.** The globally installed `pmgr` is still `0.5.0`. The daily checklist sees none of this until a release is installed. Releasing is out of scope here; this is noted so "fixed" is not claimed before rollout.

### Round 1 items

- **L1 (stepIndex provenance after carry): CLOSED, independently confirmed.** Probe P4 shows the new Todo's `stepIndex` equals its final ref index (`1`). The author's round-trip regression passes.
- **L2 (R4.1 first-occurrence dedupe vs R4.5 strict suffix): still OPEN.** Reproduced independently: pins `[A,B]`, then a fixed-uid carry write with `nextTodoUids: [A]`. The first call succeeds and keeps `[A,B]`; the identical retry throws `conflicting entry uid`. The implementation follows the written rule and pins the behavior with a regression test. This is a requirements contradiction that the user still has to decide. Possible resolutions, for the record:
  1. Accept "re-pinning an already-carried uid is not retry-safe under a fixed uid" as a documented limitation (the CLI never passes fixed uids, and `--external-ref` replays are unaffected).
  2. Move a re-pinned uid to the tail instead of keeping its first position.
  3. Store a write-intent identity.

  Option 1 needs no code. Option 2 changes R4.1 ordering semantics.

- **External Claude review blocked in Round 1:** superseded. This round is the cross-model review.

### Disposition

**Conditional GO.**

- Conditions for implementation acceptance:
  1. Fix F1 with a regression test, then re-run `pnpm test`, `tsc`, and `eslint`. A targeted re-check of the F1 delta by this reviewer session is enough; a full re-review is not needed.
  2. **L2 remains OPEN** pending the user's decision. Acceptance is complete only once L2 is resolved (option 1 can be closed by a requirements or doc note alone).
- Non-blocking: F2 (requirements follow-up), F3 (translation), F4, and F5.

All other acceptance criteria (1–12, 14, 15, and the suffix cases of 13) were verified, with no regressions in the existing suites.

## Round 3 — Author targeted fix for Round 2 F1 (2026-11-02)

Author: Codex, session `01a19a31-7c72-7431-b2f7-5e89e959b641`.
HEAD: `6afd261` (unchanged). This round changes only F1; F2–F5, O5, and the deferred L2 behavior are untouched. No full-implementation acceptance or deployment is claimed.

### Fix and scope

- `src/db.ts`: in the carry branch for an incompletely converted legacy source, change the guard from `input.nextTodoUids?.length` to `input.nextTodoUids !== undefined`. An explicit empty refs list now receives the existing R4.1 `ValidationError` ("project demo has unconverted legacy next steps; run pmgr todo-convert --project demo or pass --replace-next") before a mixed snapshot can be inserted.
- `test/open-work.test.ts`: add one F1 regression covering both fully unconverted and partially converted legacy sources. It asserts the exact rejection, unchanged exported state after rejection (including rollback of a same-write Todo closure), refs absence on a subsequent valid carry write, and an exact export/import round trip into a fresh memory ledger.
- This document: append Round 3 only. Round 0–2 remain byte-for-byte unchanged. All pre-existing worktree edits and untracked files are preserved. Turn-local delta before these notes: one source-line replacement plus 51 added test lines; no other source, requirements, documentation, or evidence files changed.

### Verification

- Before the source fix: `pnpm exec tsx --test --test-name-pattern 'F1:' test/open-work.test.ts` failed with `Missing expected exception (ValidationError)`, reproducing F1.
- After the source fix: the same focused command passed (1 test, covering both legacy states).
- `pnpm test`: **59/59 passed**, 0 failed (58 previous tests plus the new F1 regression).
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec eslint .`: passed.
- `pnpm exec prettier --check src/db.ts test/open-work.test.ts`: passed.
- `git diff --check`: passed.
- Tests used only `:memory:` or temporary `PMGR_DB_PATH` ledgers. Isolated closeout `current -> add -> current` was verified for temporary project `project-mgr`, record `1`; its temporary DB and turn-local snapshots were removed. The real ledger was never opened or changed.

### Disposition

**Round 2 F1 / MAJOR: CLOSED on the author side**, supported by the reproduced failure, targeted fix, rollback/portable-round-trip regression, and required checks. No new independent reviewer result is claimed for this delta. The existing Round 2 reviewer can perform the requested targeted re-check without a full re-review.

**L2 remains deferred and unchanged.** F2–F5 and O5 were not addressed. No stage, commit, push, npm publication, or production-ledger mutation.

## Round 4 — Targeted reviewer re-check of F1 (2026-11-02)

Reviewer: Claude Code (Opus), session `9e1f55a8-c7d2-4e5f-a698-72de8f1f3b55` (the same reviewer as Round 2). Author: Codex session `01a19a31-7c72-7431-b2f7-5e89e959b641`.
Scope: the Round 3 F1 delta only. F2–F5 and L2 were not re-reviewed. Read-only: no business code, tests, or earlier rounds were edited. No commit or push. The real ledger was not opened by any command in this round; all tests and probes used `:memory:` or a temporary copy.

### Verification

1. **Fix inspected.** In the `addStatus` carry branch where `preserved.nextTodoUids === undefined` (legacy source not fully converted), the guard is now `input.nextSteps.length || input.nextTodoUids !== undefined`. Any caller-supplied refs, including `[]`, are rejected with the R4.1 message before `addValidatedStatus` runs. This branch can no longer combine `preserved` strings with an `input.nextTodoUids` field. The guard runs after the `closeTodos` updates, but in the same transaction, so a rejection rolls back the closures; the test asserts this.
2. **Other mixed-row paths probed** against the fixed `src/db.ts`, on a legacy-pending `:memory:` ledger:

   | Input                   | Result                                                                     |
   | ----------------------- | -------------------------------------------------------------------------- |
   | replace, text plus `[]` | rejected by validation (`cannot combine nextSteps text with nextTodoUids`) |
   | carry, text plus `[]`   | rejected by validation (same message)                                      |
   | replace, `[]`           | refs-only row `{nextSteps: [], nextTodoUids: []}`                          |
   | replace, no next work   | refs-only row `{nextSteps: [], nextTodoUids: []}`                          |

   No path produced a row with both non-empty strings and refs. The fixed-uid retry helper's legacy branch (`textRefEquivalent`) already requires `input.nextTodoUids === undefined`, so it agrees with the new guard.

3. **The regression test catches the bug.**
   - What it asserts: `F1: pending legacy carry rejects explicit empty refs and preserves portable state` covers fully and partially converted legacy sources. It checks the exact error, export state unchanged after rejection (including rollback of a same-write `closeTodos`), refs absent on the next valid carry, and an exact export/import round trip.
   - Mutation check: in a temporary copy with the guard reverted to `input.nextTodoUids?.length`, the test fails (`Missing expected exception (ValidationError)`). With the fixed guard it passes. The copy was deleted.
4. **Gates (re-run):** `pnpm test` **59/59 pass**; `tsc --noEmit`, `eslint .`, and `git diff --check` all pass.

### Findings

No new findings in the F1 delta.

Note: the real ledger's mtime moved from `11:09` to `11:20` during this window. No command in this round pointed at it (all test files set `PMGR_DB_PATH`, and the probes used `:memory:`), so this is attributed to activity outside this review and recorded only for traceability.

### Disposition

- **Round 2 F1 / MAJOR: CLOSED** (independently verified).
- **GO for implementation acceptance, conditional on L2 only.** **L2 remains OPEN** by user choice, pending a decision on the R4.1/R4.5 conflict (Round 2 lists the options; option 1, a documented limitation, needs no code).
- F2 (requirements gap), F3 (`README_CN.md` English passages), F4, and F5 remain open and non-blocking.

## Round 5 — L2 closed as documented limitation (2026-11-02)

Author: 待办 (on behalf of user decision), not a Codex code change.
Decision: **option 1** (user corrected from option 2).

### Decision

Keep R4.1 first-occurrence carry order and R4.5 strict-suffix fixed-uid retries as written. When a carry-mode write re-names an already-carried pin under a fixed uid, the first write succeeds and keeps the uid's first position; an identical fixed-uid retry throws `conflicting entry uid`. That case is an **accepted known limitation**:

- The CLI never passes fixed uids.
- `--external-ref` replays are unaffected.
- No move-to-tail reorder and no extra write-intent identity.

Requirements updated: R4.5 known-limitation bullet; Open questions marked decided.

### Disposition

- **L2: CLOSED** (documented limitation; no code change).
- Implementation acceptance: **GO** (F1 CLOSED in Round 4; L2 CLOSED here). F2–F5 remain non-blocking follow-ups.
- No `src/` or test logic changes in this round. No commit, push, or ledger mutation.

## Round 6 — Reviewer confirmation after L2 decision (2026-11-02)

Reviewer: Claude Code (Opus), session `9e1f55a8-c7d2-4e5f-a698-72de8f1f3b55` (same reviewer as Rounds 2 and 4).
Scope: the Round 5 docs-only update and an F1 drift check. Read-only: no business code, tests, or requirements were edited. No commit or push. The real ledger was not touched.

### F1 — still CLOSED

- `src/db.ts:505`: the carry/legacy-pending guard is still `input.nextSteps.length || input.nextTodoUids !== undefined`. No drift since Round 4.
- `test/open-work.test.ts:76`: the F1 regression is still present and unchanged in substance. It still passes explicit `nextTodoUids: []` (line 94) and asserts the R4.1 rejection, rollback, refs absence, and the export/import round trip. Round 4's mutation check (reverting the guard makes this test fail) therefore still applies.
- Targeted run: `tsx --test --test-name-pattern 'F1:|R4.5 strict' test/open-work.test.ts` passes 2/2. The full suite was not re-run, because this round changed no `src/` or test files; the worktree file list matches Round 4.

### L2 — documentation is consistent with option 1

- Round 5 records option 1: keep R4.1 first-occurrence order and the R4.5 strict suffix, accept the fixed-uid retry conflict, and change no code.
- Requirements R4.5 has a "Known limitation (L2 … option 1)" bullet with the same rationale (the CLI never passes fixed uids; `--external-ref` replays are unaffected) and an explicit "do not change carry order or suffix rules". The Open questions section marks L2 as decided with the same option.
- The code matches the decision: the test `R4.5 strict suffix documents the R4.1 conflict…` (`test/open-work.test.ts:859`) still asserts that the retry throws `/conflicting entry uid/`, and it passes.

**Verdict: consistent. L2 CLOSED** as a documented limitation.

### New findings

- **N1 / NIT:** the first R4.5 bullet still says fixed-uid retries "must stay idempotent in carry mode" without a forward reference. The limitation bullet directly below qualifies it, so this is readable but not self-contained. Optional wording: "…idempotent in carry mode, except the L2 case below".
- **N2 / NIT:** the requirements header still says `Status: Draft — ready for implementation review`. Updating it to reflect implementation acceptance (Round 5/6) would keep the header in step with the review trail. Left untouched: this is a status edit, not an obvious typo.
- **N3 / NIT:** the L2 limitation is recorded only in the requirements and in this review. It is not in `docs/architecture.md` or `CHANGELOG.md`. It affects only direct domain-API callers that pass fixed uids, so this is optional.

### Disposition

**GO for implementation acceptance.**

- F1: CLOSED.
- L2: CLOSED as a documented limitation; the docs match option 1.
- Remaining non-blocking follow-ups: F2 (reuse candidates should include P's pinned unassigned Todos, a requirements gap), F3 (`README_CN.md` English passages), F4 (O(N²) queries in `current`), F5 (release and install needed before the daily checklist benefits), and N1–N3.
- Acceptance here does not authorize commit, push, publish, or a real-ledger migration (`todo-convert --all` stays a user-run step after backup).

## Round 7 — Author confirmation of final L2 option 1 and rollback (2026-11-02)

Author: Codex, session `01a19a31-7c72-7431-b2f7-5e89e959b641`.
HEAD: `6afd261` (unchanged). The user's final decision is **option 1**, not option 2.

### State verified

Option 2 was briefly implemented in an earlier author turn. Those changes have been fully reverted before this verification; **no option 2 residue remains** in the current implementation, regression expectations, or active requirements. This round makes **no business-code, test, or requirements changes**.

- `src/db.ts` carries pins with first-occurrence `Set` semantics. It does not remove and append re-pinned UIDs.
- The F1 guard remains `input.nextSteps.length || input.nextTodoUids !== undefined`.
- `test/open-work.test.ts` retains `R4.5 strict suffix documents the R4.1 conflict for re-pinning an earlier carried UID`, preserving original pin order and asserting that the identical fixed-UID retry throws `conflicting entry uid` for text and explicit refs. The option 2 tail-order/successful-retry regression is absent.
- Requirements R4.1 and R4.5 specify first-occurrence carry order and the **Known limitation (L2, option 1)**. The decided Open questions entry selects option 1. Architecture and CHANGELOG agree with that behavior.
- Round 5 and Round 6 remain the valid L2 documented-limitation closure and GO record. The earlier erroneous option 2 author entry is absent. This Round 7 only appends the correction/verification record; all existing Round 0–6 text is preserved.
- F1 and the Round 3, Round 4, and Round 6 F1 conclusions remain intact. F2–F5 and O5 were not changed.

### Verification

- `pnpm test`: **59/59 passed**, 0 failed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec eslint .`: passed.
- `git diff --check`: passed.
- Tests used memory or temporary databases. The real ledger was never opened or changed. Source/test/document fingerprints were compared before and after this round to verify that only this review appendix changed.

### Disposition

**L2 CLOSED via option 1: documented limitation.** First-occurrence carry ordering and strict-suffix retry identity remain in force. The fixed-UID carried re-pin retry conflict is accepted; CLI writes do not pass fixed UIDs, and external-ref replay remains unaffected. Round 5–6 retain their effective closure/GO; this round does not introduce a new implementation decision.

No stage, commit, push, npm publication, or production-ledger mutation. Pre-existing uncommitted worktree changes are preserved.

## Round 8 — Follow-up fixes and 0.5.1 release record (2026-11-02)

Author: Claude Code (Opus), session `9e1f55a8-c7d2-4e5f-a698-72de8f1f3b55`, acting as implementer under the user's release authorization (via 待办). This session also reviewed Rounds 2/4/6, so this round is self-reported and has no independent cross-review.
Constraints honored:

- L2 stays option 1: first-occurrence carry and strict-suffix retry are unchanged, and the `R4.5 strict suffix…` test still expects `conflicting entry uid`.
- F1 guard unchanged (`input.nextTodoUids !== undefined`).
- The real ledger was not opened. `todo-convert --all` was not run.

### Follow-ups

- **F2 — CLOSED.**
  - Change: exact-title reuse candidates now include unassigned open Todos in P's current pins, alongside open Todos with `project = P`. Ordering is unchanged (pins first, then `createdAt, uid`), and reuse never changes ownership.
  - Regression `F2: exact-title reuse includes unassigned Todos pinned by the project`. It also asserts that an unpinned unassigned Todo is not reused.
  - Docs updated: requirements R4.4, README, SKILL, architecture, CHANGELOG.
- **F3 — CLOSED.** The `README_CN.md` Todo/open-work section is rewritten in Chinese in the file's one-sentence-per-line style. The Chinese example summaries are restored, and the L2 limitation is noted in Chinese. No English prose is left in the diff.
- **F4 — CLOSED.**
  - New `openWorkByProject(db, project?)` builds per-project groups from one `current()` call and one Todo scan. `openWork` keeps its earlier semantics: a project query is per-project; a global query dedupes shared pins (first project wins) and appends unassigned Todos.
  - CLI `current` uses one grouped scan instead of calling `openWork` for each project.
  - Regression `F4: CLI current groups one open-work scan with per-project semantics` asserts each entry's `openWork` deep-equals `openWork(db, project)`, including a Todo pinned by two projects.
- **F5 — PARTIAL (blocked on npm auth).** Version bumped to `0.5.1`, CHANGELOG folded into `0.5.1 - 2026-11-02`, `pnpm build` succeeded (`node dist/cli.js --version` prints `0.5.1`), committed and pushed. **npm publish not performed:** `npm whoami` returns `E401 Unauthorized` against `https://registry.npmjs.org/` (checked twice). Global install of `0.5.1` was therefore not performed either; the global `pmgr` is still `0.5.0`. This stays open until the user logs in to npm.
- **N1 — CLOSED.** R4.5 first bullet now reads "…idempotent in carry mode, except the L2 case below."
- **N2 — CLOSED.** Requirements status is now "Accepted and implemented — GO in review Rounds 5–6; follow-ups … closed in Round 8 (release 0.5.1)". Since publish is blocked, F5 is in fact partial.
- **N3 — CLOSED.** `docs/architecture.md` has a "Known limitation (L2)" paragraph, and the CHANGELOG already carried the L2 note.

### Additional changes

- **Coverage gate.** `pnpm coverage` (100% threshold) failed on the uncommitted Round 1–7 work. Gaps:
  - unreachable fallbacks: the legacy pin `latest ? … : []`, `groups.get(...) ?? []`, and the converted Todo `project ?? "-"`;
  - untested text-mode branches in `next`, `current`, and `todo-convert`;
  - the non-object `addStatus` guard.

  Fix: removed the unreachable fallbacks (non-null assertions with a comment on the legacy branch) and added two CLI tests (`todo-convert text output…`, `text next and current cover…`). Coverage is now 100% statements, branches, functions, and lines.

- **Formatting.** `prettier --write` was applied to the requirements doc and to this review file. This normalized whitespace and table padding in earlier rounds; content was not changed. It was needed for `pnpm format-check` to pass on the committed files.

### Verification

- `pnpm test`: **63/63 pass**.
- `pnpm coverage`: 100% across all metrics.
- `tsc --noEmit` passed, `eslint .` passed, `pnpm format-check` passed, and `git diff --check` passed.
- `pnpm build` produced `dist/cli.js`, which reports `0.5.1`.
- `npm pack --dry-run`: `project-mgr@0.5.1`, 29 files.

### Release record

| Item                | Value                                                   |
| ------------------- | ------------------------------------------------------- |
| Version             | `0.5.1`                                                 |
| Release commit      | `67fcadd` (pushed to `origin/main`, `6afd261..67fcadd`) |
| npm publish         | **Not done**: `npm whoami` returns E401 (not logged in) |
| Local global `pmgr` | `0.5.0` (unchanged; install deferred until publish)     |

To finish F5 after the user logs in (`npm login`):

```sh
npm publish
npm i -g project-mgr@0.5.1
pmgr --version
```

### Disposition

**GO for the code** (F2–F4 and N1–N3 closed, all gates green). **The release is incomplete:** F5 waits on npm authentication. No real-ledger change or `todo-convert --all` was performed.

### Round 8 addendum — local install correction

The global `pmgr` (`~/.nvm/versions/node/v22.23.1/lib/node_modules/project-mgr`) is an `npm link` symlink to this repository. The `pnpm build` above therefore already upgraded it: `pmgr --version` now prints **`0.5.1`**, built from `67fcadd`. `pmgr help next` and `pmgr help add` (neither opens the database) show the new command and flags. The release-record row "Local global `pmgr`: 0.5.0" is superseded: the local CLI is **0.5.1 (linked build)**. npm publish is still blocked on E401, so F5 remains open only for the registry publish. The link was kept; no `npm i -g` was needed.
