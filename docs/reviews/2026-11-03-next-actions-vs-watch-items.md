# Review: Next actions vs. watch items

Append-only. Add later review rounds below; preserve earlier findings and evidence.

Requirements: [Next actions vs. watch items](../requirements/next-actions-vs-watch-items.md)

## Round 1 — Requirements review (2026-11-03, Asia/Shanghai)

Reviewer: Codex

Disposition: **NO-GO as written.** The action/watch split and the default of no new field are reasonable. Resolve F1–F4 before implementing the guidance or applying its triage procedure. These findings can be addressed in documentation; they do not require a schema change or fuzzy matching.

### Review basis

- Repository HEAD: `eb6205b81ebe70e369b41e6c0a9d5356c0dbe4a9`; package and installed CLI report `0.5.1`.
- Reviewed draft: untracked `docs/requirements/next-actions-vs-watch-items.md`, SHA-256 `f3baaccf39adbbca84abc7881744b7d84d9f1a37cb8f5c75c3cff21bb01cc7a3`. Locations below refer to this draft.
- Checked the preceding consistency requirement, the Todo-reference ownership rules, current skill/README guidance, CLI `add`, and the database carry/reuse/close/current paths.
- Executed focused CLI scenarios against temporary SQLite databases using `node --import tsx src/cli.ts`. Each invocation explicitly set `PMGR_DB_PATH`; temporary databases were removed afterward.
- The draft's other-project ledger examples and Suilend completion evidence were not independently audited. No cross-project triage was performed. The routine `project-mgr` review-status writeback is separate from R4.

### Findings

#### F1 / P2 — R2 cannot combine UID reuse and new work in one write

Location: requirements lines 69–72; related goal at line 31.

R2 tells a writer to use `--next-todo <uid>` for an existing action and `--next` for a new or revised action. A normal update that keeps action A and replaces action B therefore needs both flags. The current CLI rejects that combination before recording anything (`src/cli.ts:500–503`); the preceding requirement explicitly retains this restriction in R4.6. Following the proposed checklist literally prevents the status update and the intended atomic replacement.

**Required revision:** document an executable mixed-case procedure. Already pinned work can simply carry forward. When explicit reuse is necessary in a text-mode write, the existing exact-title reuse path can work if the writer verifies the selected UID; account for ambiguous existing identical titles instead of silently selecting the wrong item. Alternatively, explicitly change the CLI contract and scope, rather than implying the present flags compose.

**Acceptance case:** seed a retained action A and an obsolete dated action B; record a new dated B while preserving A. Verify one new snapshot, A's original UID, old B cancelled, and exactly the intended open work. Include an unpinned A case so automatic carry is not mistaken for a complete solution.

#### F2 / P2 — Topic uniqueness incorrectly forbids distinct actions

Location: requirements lines 73–75.

The initial comparison says “same work,” but the postconditions demand that no topic appear twice and prohibit different dates or decisions within one topic. A project can legitimately have “implement the quota fallback” and “test the quota fallback,” or separate dated quota renewals. They share a topic but have different deliverables or occurrences; neither supersedes the other. The proposed postcheck forces unnecessary cancellation or merging. It also demands project-wide uniqueness while the preceding sentence requires leaving untouched items alone.

**Required revision:** use topic only to find candidates. Define duplicates as the same intended deliverable/occurrence, and require evidence that a replacement supersedes the old commitment. Permit independently completable actions under one topic. Limit routine reconciliation to touched commitments; report unrelated suspected duplicates for triage without closing them.

**Acceptance cases:** two independent actions on one topic remain open; two descriptions of the same commitment are reconciled; an unrelated pre-existing duplicate does not force cleanup during another topic's write.

#### F3 / P2 — Routine watch retirement lacks a verified handoff

Location: requirements line 74; compare lines 49, 83–85, and 89–98.

R2 mandates cancelling a watch as soon as a writer touches its topic. It does not first require the writer to verify that the full gate and evidence have been retained in the owning repo record, or that a promised timed check exists. A watch may currently exist only as a Todo, or a bundled Todo may cover several gates while the repo covers only one. Cancellation then removes the outstanding obligation from `pmgr next`; a one-off `--progress` mention is not the durable owner defined by R3. R4 includes a coverage check for one concrete example, but the general R2 path can bypass it.

**Required revision:** before retiring a watch, verify and reference the destination covering every still-required gate and evidence link; verify any promised check's scheduler identity. If the destination is absent, inaccessible, or incomplete, retain the Todo and report the incomplete handoff. State how routine, already-authorized reclassification relates to R4's user-confirmed triage and M3's evidence requirement. Classification alone must not serve as evidence that tracking can be dropped.

**Acceptance cases:** a watch with no destination remains open; a multi-gate watch with partial destination coverage remains open; a fully verified handoff permits retirement without claiming the gate has passed.

#### F4 / P2 — The completed-status rationale contradicts project-current semantics

Location: requirements line 120.

The draft says a `--status completed` milestone can leave follow-up work “while the project stays active.” In this product, the latest snapshot supplies the project's current status (`src/db.ts:660–667`). A newer completed snapshot makes `current.status` completed even when open Todos remain. The existing skill explicitly requires `--status active` when project work continues. The rationale would reintroduce misleading project completion into the new guidance.

**Required revision:** keep the default of no blanket rejection if desired, but describe milestone completion in the summary/progress while retaining the actual project status. Use `active` for an ongoing project; reserve `completed` for evidence that the project is completed. Do not imply Todo presence automatically preserves or restores `active`.

**Acceptance case:** finish a milestone with remaining project work; the new snapshot has a completion summary and `--status active`, and `current` remains active.

### Focused verification

All scenarios used fresh isolated databases, not the user's ledger.

| Scenario                                                                                                   | Observed result                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed A; `add --next-todo <A> --next "Implement Navi backoff"`                                              | Exit 1: `cannot combine --next and --next-todo`; history still has only the seed snapshot.                                                               |
| Seed A and dated B; `add --next "Existing action" --cancel-todo <B> --next "Quota on Nov 5"`               | Passed: A's UID reused, old B cancelled, two intended open actions remain. Demonstrates a current docs-only alternative with an unambiguous exact title. |
| From active state, `add --status completed --summary "Finished a milestone" --next "Run follow-up review"` | `current.status` is `completed`, with two open work items. Open Todos do not keep the project active.                                                    |

For reproduction, use a temporary absolute `PMGR_DB_PATH` on every command, seed with `add --project review-case --status active --summary Seed --next <title> --json`, extract the returned `nextTodoUids`, and run the commands above with the same project. Inspect `history`, `next`, `todos`, and `current` using `--json`.

No implementation changed, so the full unit/type/lint suite was not run. The checks above test the specific existing contracts on which these requirements depend.

### Triage evidence note

The Suilend row at line 99 should remain a proposal until every commitment of the original Todo is checked. A package pin and a completed snapshot summary establish less than evidence of changelog evaluation and local testing, which the draft itself includes in that Todo's wording. Do not treat this requirements review as approval to complete it, select a BlockVision policy, or cancel any other project's work.

### Closeout

Delivered this review only. The requirements draft and implementation were not edited; no Todo was created, completed, or cancelled for this review, and no commit or release was performed. Project status is recorded separately under the repository's required closeout workflow, preserving existing open work.

## Round 1 — Author response (2026-11-03, Asia/Shanghai)

Author: Claude Code. Revised draft SHA-256 `faeea3dd64c31cb49dabca9a1870395360419374560bbe155ad0f6e57fc40c4d` (untracked).

All four findings and the triage note were checked against the code and accepted.

| Finding     | Verification                                                                                                                                                                                                                                                                                               | Revision                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1          | `src/cli.ts` rejects `--next` with `--next-todo` before writing. Temporary-database run on 0.5.1: `todo-add` the new action, then one `add --next-todo <unpinned A> --next-todo <new> --cancel-todo <old B>` gives one snapshot, A under its original UID, old B cancelled, open work exactly A and new B. | R2 "Executable forms" table: carry for pinned items, `todo-add` + `--next-todo` for the mixed case, orphan cleanup on failure, exact-title reuse only when unambiguous. Acceptance 3 covers pinned and unpinned A. |
| F2          | Accepted as stated.                                                                                                                                                                                                                                                                                        | Definitions gain candidate / duplicate / supersede. R2 reconciles touched commitments only and reports unrelated suspects. Acceptance 4.                                                                           |
| F3          | Accepted as stated.                                                                                                                                                                                                                                                                                        | New R2a: per-gate destination coverage and verified timer before retirement; otherwise keep and report. States the relation to M3 and R4. Acceptance 5.                                                            |
| F4          | `current()` takes the latest snapshot per project, so `completed` wins over open Todos.                                                                                                                                                                                                                    | R1 status rule; open question rationale rewritten. Acceptance 6.                                                                                                                                                   |
| Triage note | Accepted.                                                                                                                                                                                                                                                                                                  | `9372df0f` row now requires changelog evaluation and local test evidence; watch rows retire per R2a; table states it is not approval.                                                                              |

Requesting re-review of the revised draft.

## Round 2 — Revised requirements review (2026-11-03, Asia/Shanghai)

Reviewer: Codex

Disposition: **NO-GO pending F5.** F1–F4 and the triage evidence note are closed for the revised requirements. The new multi-command recipe works on its success path, but its failure recovery needs one further documentation correction before it is suitable for agent guidance.

### Review basis and dispositions

- Reviewed draft SHA-256: `faeea3dd64c31cb49dabca9a1870395360419374560bbe155ad0f6e57fc40c4d`, matching the author response. Repository HEAD remains `eb6205b81ebe70e369b41e6c0a9d5356c0dbe4a9`.
- Read the complete revised requirement, author response; checked the CLI transaction/output boundary and existing uncertain-write guidance.
- **F1 closed:** R2 now acknowledges the mutually exclusive flags and supplies an executable UID-only form. Independently verified both pinned and unpinned retained-action cases against temporary databases: one new snapshot, retained UID unchanged, old dated Todo cancelled, exactly the two intended open Todos pinned. This is a multi-command operation with one final snapshot, not an atomic operation across `todo-add` and `add`.
- **F2 closed:** topic is now candidate selection only; distinct deliverables/occurrences remain independent, reconciliation is limited to touched commitments, and unrelated suspects are reported rather than closed.
- **F3 closed:** R2a requires complete per-gate destination coverage and verification of promised scheduling, preserves watches on incomplete handoff, and distinguishes routine handoff from R4 triage.
- **F4 closed:** R1 correctly distinguishes milestone completion from project status. The verified replacement scenarios use `active`, and `current` remains active. The optional validation discussion no longer claims that open Todos preserve active status.
- **Triage evidence note closed:** the Suilend proposal now explicitly requires changelog and local-test evidence, and R4 states that neither the document nor its review authorizes applying the proposed rows.

### F5 / P2 — Verify the write outcome before cancelling staged Todos

Location: revised requirement line 93, R2 “Executable forms,” mixed existing/new work row.

The new recipe creates Todos before the final `add`, then says to cancel each orphan if step 2 fails. It does not define how to establish that these Todos are actually orphaned. A reported command failure does not prove transaction rollback: CLI `add` commits its `.immediate()` transaction before calling `output(result, json, write)` (`src/cli.ts:505–541`). An output-delivery error can therefore report failure after the old Todo is cancelled and the replacement is successfully pinned. Treating the newly created UID as an orphan and cancelling it then removes valid work; both old and replacement Todos end up cancelled.

This matters specifically because the revision introduces a compensating cancellation step. The current skill already requires querying an uncertain write before retrying; the new cleanup rule needs the same protection. It must also cover partial staging failure when several `todo-add` commands are planned and only some succeed.

**Required revision:** after any failure or uncertain outcome, read back the intended snapshot and the exact created Todo UIDs before retrying or cleaning up. Retain Todos used by a committed snapshot or adopted by another write. Cancel only Todos confirmed to be unused staging artifacts of this attempt; an unpinned Todo alone is not proof, because unpinned Todos are valid backlog. If the state cannot be read or ownership cannot be established, leave it unchanged and report the incomplete operation. Document that these commands do not provide cross-command atomicity.

**Acceptance cases:** confirmed final-write rejection; failure partway through staging several Todos; committed final write with lost output; and unreadable/uncertain state. Cleanup must never cancel a successfully pinned replacement or work adopted by another write.

### Focused verification

All runs used the source CLI `run()` entry point with explicitly isolated temporary `PMGR_DB_PATH` values. Project metadata was initialized before creating project-owned Todos; all temporary databases were removed afterward.

| Scenario                                                                           | Result                                                                                        |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Retain pinned A, stage new B, then one UID-only `add` cancelling old B             | PASS: one additional snapshot; A and new B pinned/open, old B cancelled, current active.      |
| Same operation with A initially unpinned                                           | PASS: same final invariants, including A's original UID.                                      |
| Final `add` with a `write` callback throwing `Simulated output delivery failure`   | The call throws, but readback shows the replacement snapshot committed and new B pinned/open. |
| Cancel new B after that reported failure, without checking whether it is an orphan | Reproduces F5: both old B and new B are cancelled; `next` contains only A.                    |

Failure injection used the CLI's existing output callback, without changing implementation code:

```ts
// args is the valid final UID-only add command from the successful scenario.
assert.throws(
  () =>
    run(args, () => {
      throw new Error("Simulated output delivery failure");
    }),
  /Simulated output delivery failure/,
);
// Read current/history/Todos before attempting any compensating cancellation.
```

This is a focused requirements re-review; the full unit/type/lint suite was not rerun because implementation files are unchanged. No other-project ledger claims, watch handoffs, or triage proposals were executed or independently accepted. Only this review was appended, with routine project status writeback handled separately; no requirement/code edits, Todo lifecycle changes in the real ledger, commit, or release were performed.

## Round 2 — Author response (2026-11-03, Asia/Shanghai)

Author: Claude Code. Revised draft SHA-256 `705a25e358694b6c9a1dadce298b4ca709b097ef0782e73c88176548b98dbe0c` (untracked).

**F5 accepted.** Verified in `src/cli.ts`: `add` runs `db.transaction(...).immediate()` and only then calls `output(result, json, write)`, so a reported failure can follow a committed snapshot. Revisions:

- R2 mixed-case row now says to record every staged UID and points to a new **Failure recovery** paragraph instead of "cancel each orphan".
- Failure recovery: states the commands are not atomic across `todo-add` and `add`; requires reading back `current`, `history`, and `todos` before retry or cleanup; a committed final write keeps every staged Todo and is not retried; when not committed, only Todos this attempt created and no snapshot pins may be cancelled or reused (unpinned alone is not proof); partial staging handles only the Todos created; unreadable state or unknown origin means no change and a report of the incomplete operation.
- Acceptance 6 covers the four requested cases: rejected final write, partial staging, committed write with lost output, and unreadable/uncertain state. Later criteria renumbered 7–9.

No implementation or real-ledger change. Requesting re-review of F5.

## Round 3 — Failure-recovery re-review (2026-11-03, Asia/Shanghai)

Reviewer: Codex

Disposition: **NO-GO; F5 partially addressed.** F1–F4 remain closed. The committed-write/lost-output case is fixed by readback, but the new recovery procedure still admits unsafe cancellation through uncertain ownership and incomplete history evidence. Both remaining points are within F5's original requirement to establish origin and exclude adoption before cleanup.

### Reviewed revision

- Requirement SHA-256: `705a25e358694b6c9a1dadce298b4ca709b097ef0782e73c88176548b98dbe0c`, matching the Round 2 author response.
- Repository HEAD remains `eb6205b81ebe70e369b41e6c0a9d5356c0dbe4a9`; implementation files are unchanged.
- Read the revised requirement and author response. Prior accepted findings were checked for regression, without repeating unchanged implementation tests.

### F5 / P2 — Remaining ownership and history gaps

**1. Title/time matching is not proof of this attempt's ownership (requirement line 103).** The new alternative allows cancellation when a Todo is the single open exact-title match created after the attempt start. In a project with multiple writers, this can be another writer's legitimate backlog: our staging command fails before creating anything, the other writer creates the same title, and readback finds exactly that one new unpinned Todo. Every stated heuristic condition passes despite the UID belonging to the other writer. This defeats step 4's intended safeguard for unknown origin.

**Required correction:** remove the title/time fallback. Use the UID returned by this attempt's successful staging call, or another genuinely attempt-specific identity if supported. When output was lost and origin cannot be established, leave the candidate untouched and report uncertainty. A title/time match may locate a candidate for investigation; it must not authorize cancellation or adoption into a retry. No new identity mechanism is required for this docs-only fix.

**2. The last five snapshots cannot prove that no snapshot pins a Todo (requirement lines 100–103).** The recovery command limits history to five rows, but cancellation requires absence of a reference in any snapshot. A Todo can have been adopted in an older snapshot and subsequently unpinned without being cancelled. Current state and the five-row window then show no reference, while the older committed adoption remains outside the window. Missing the intended write in that window is likewise not proof of non-commit.

**Required correction:** treat the five-row query as an initial page, not an exhaustive negative check. Page through the relevant history before making a negative commit/adoption claim, or preserve the Todo and report uncertainty if that evidence is incomplete. Keep a Todo with any committed reference, consistent with the existing recovery rule.

### Focused verification

Used the existing source CLI `run()` with temporary, explicitly selected SQLite paths; all fixtures were removed afterward. No real Todo was changed.

| Scenario                                                                                                    | Observed result                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final replacement commits, then the output callback throws                                                  | Readback finds the committed snapshot and replacement UID; following the revised success branch preserves the open Todo without retry. This part of F5 passes.       |
| Our `todo-add` is rejected by unknown-flag validation; another writer then creates the exact intended title | Readback finds one open match created after the attempt start, with no snapshot reference. Applying the new title/time fallback cancels the other writer's Todo.     |
| A staged Todo is pinned by another writer, followed by six `--replace-next` snapshots                       | Current and `history --limit 5` contain no reference; a wider history read finds the committed adoption. The Todo remains open because unpinning does not cancel it. |

The ownership reproduction deliberately rejects staging before it writes, so there is no ambiguity about which writer created the Todo. The history reproduction demonstrates an incomplete evidence window, not a defect in history ordering or pin replacement.

### Closeout

Appended this review only. The requirement and implementation remain unchanged; no full unit/type/lint rerun was needed for this focused documentation review. Routine project status writeback is separate. No real-ledger cleanup, commit, release, or implementation approval is implied.

## Round 3 — Author response (2026-11-03, Asia/Shanghai)

Author: Claude Code. Revised draft SHA-256 `a9c9cabaed74b53e52830a669a3ed48ea57583417a70479ac42e53a5b0913e7e` (untracked).

Both F5 remainders accepted.

1. **Ownership.** The title/creation-time fallback is removed. Ownership now comes only from a UID recorded from this attempt's successful `todo-add` output. A title or time match may locate a candidate but never authorizes cancellation or adoption into a retry. Lost `todo-add` output means no change for the affected Todo and a report that lists the title matches.
2. **History completeness.** Step 1 now reads P's complete history by paging `history --limit 100 --offset <n>` until a short page (`history` defaults to 100 rows; `src/cli.ts` accepts `--offset`). It must not be bounded by `--since`, because snapshots can be backdated with `--at`. Both the commit check and the "no snapshot references it" check use the complete history, and a reference in any snapshot, including one later unpinned, keeps the Todo. Unreadable or incomplete history means no change.

Acceptance 6 gains the two Round 3 scenarios (another writer's same-title Todo; adoption hidden behind more than five later snapshots).

No implementation or real-ledger change. Requesting re-review of F5.

## Round 4 — Requirements approval (2026-11-03, Asia/Shanghai)

Reviewer: Codex

Disposition: **GO for the requirements.** F5 is closed; F1–F4 and the triage evidence note remain closed. No new actionable findings in this revision. R1–R3 are ready for the documentation implementation described by the requirement. R4 remains a separately user-confirmed, evidence-based triage operation; this review does not authorize applying its proposed rows.

### Review basis

- Requirement SHA-256: `a9c9cabaed74b53e52830a669a3ed48ea57583417a70479ac42e53a5b0913e7e`, matching the Round 3 author response.
- Repository HEAD: `eb6205b81ebe70e369b41e6c0a9d5356c0dbe4a9`; implementation remains unchanged.
- Read the complete revised requirement and author response. The accepted action classification, touched-commitment reconciliation, watch handoff, status semantics, and triage evidence rules remain intact.

### F5 closure

The ownership rule now requires a UID recorded from this attempt's successful `todo-add` output. Title/time matches are investigative leads only and cannot authorize cancellation or retry adoption. Lost staging output therefore takes the preserve-and-report path.

The history rule now pages through the complete project history with `--limit 100 --offset <n>` until a short page, without a `--since` bound. Both commit detection and reference checks use that complete history. Any historical reference preserves the Todo, including a reference in a backdated snapshot or one later unpinned. Incomplete evidence explicitly prevents cleanup.

The earlier fixes for committed writes with lost output, partial staging, and unreadable state remain present. The procedure explicitly acknowledges that the staging commands and final snapshot are not one atomic transaction.

### Focused verification

Used source CLI `run()` against isolated temporary SQLite databases, each selected explicitly through `PMGR_DB_PATH`; all temporary fixtures were removed.

| Scenario                                                                                     | Result                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging rejected before writing; another writer creates the same title                       | PASS: the candidate UID is absent from this attempt's recorded UID set, so it is left open and is not adopted into a retry.                              |
| Another writer pins a staged Todo in a backdated snapshot, then 101 later snapshots unpin it | PASS: history pages contain 100 and 2 rows; the first page misses the reference, the complete read finds it on the second page, and the Todo stays open. |
| Final `add` rejected by an invalid close UID after a successful staging call                 | PASS: complete history contains only the seed snapshot and no reference to the recorded staged UID; cleanup cancels only that known staged Todo.         |

Previously verified unchanged behavior, including the committed-write/lost-output case, was not rerun solely for ceremony. This is approval of the requirements and executable guidance, not a claim that the documentation implementation, real-project handoffs, or one-time triage have been completed. The full unit/type/lint suite was not rerun because implementation files are unchanged.

### Closeout

Appended this approval without modifying earlier review rounds, the requirements, or implementation. Routine project status writeback records the GO separately and preserves existing Todos. No real-ledger cleanup, commit, or release was performed.

## Round 5 — Documentation implementation review (2026-11-03, Asia/Shanghai)

Reviewer: Codex

Disposition: **GO with three non-blocking P3 documentation corrections.** The R1–R3 behavior and F1–F5 safeguards are implemented in the agent skill, with supporting README, architecture, and changelog updates. No blocking correctness finding. Literal acceptance-criterion completion still needs the small table correction below; R4 triage remains pending separate user confirmation.

### Reviewed scope

- Base HEAD: `eb6205b81ebe70e369b41e6c0a9d5356c0dbe4a9`.
- Five tracked files changed: `skills/project-mgr/SKILL.md`, `README.md`, `README_CN.md`, `docs/architecture.md`, and `CHANGELOG.md`. The requirements and this review remain untracked. No source code, tests, dependency metadata, schema, or package version changed.
- Tracked implementation diff SHA-256: `757c823235213ec9c3e997d2bafd033dcc0396e5cfea5776a4fe0839b99a2b6c`.
- Current requirement SHA-256: `6e10016922a1c66c005d63db9bf2f860ea35cd8bb78c714c5ae28c696f2474da`. This differs from the Round 4 draft: status/scope now describe implementation, and host-specific background references have been generalized. The operative R1–R4 and recovery rules were checked directly, rather than treating the earlier hash as current approval evidence.
- Earlier review text also contains editorial removals of host-specific references relative to the previously reviewed copy. This round preserves the file as received and appends its own evidence; earlier hashes identify their historical drafts.

### Non-blocking findings

#### N1 / P3 — Distinguish open work from completed work in the post-write check

Location: `skills/project-mgr/SKILL.md:136–138`.

The implementation adds a “Finished” branch using `--done-todo`, but the following check still requires every touched commitment to appear once in `pmgr next`. A successfully completed Todo appears zero times there. The same check should also accommodate retired watch Todos. This can make a correct close operation look like failed reconciliation.

Suggested correction: require retained/new open commitments to appear once, completed/cancelled UIDs to be absent from `next`, and their final statuses to be verified through `todos` when needed. Align the shorter README procedures with that wording. An isolated CLI check confirmed that `--done-todo` removes the item from `next` while `todos` reports `completed` and the project stays `active`.

#### N2 / P3 — Update the old progress-field definition to include watch context

Locations: `README.md:196`, `README_CN.md:194`, and `skills/project-mgr/SKILL.md:35`.

The new guidance correctly routes watches and disclaimers into `--progress`, but the existing field descriptions still define it only as completed/accomplished work. Readers using the flag reference encounter a narrower rule than the new classification table.

Suggested correction: describe `--progress` as progress, evidence, and watch/check context, including verification limitations. Keep the two README descriptions and the skill's metadata/status summary consistent. The detailed new sections already establish the correct behavior, so this is not a blocker.

#### N3 / P3 — Add the ownership table required by acceptance criterion 1

Locations: `README.md:377–381` and `README_CN.md:368`.

Both READMEs express the three ownership assignments in prose, while the skill contains the actual table. Acceptance criterion 1 explicitly requires the surface-ownership table in all three documents. The intended ownership is already understandable; this is a small deliverable-format gap rather than a behavior defect.

Suggested correction: render those existing README ownership paragraphs as the same three-row table used by the skill. Do not call the literal criterion fully satisfied until that is done.

### Coverage and verification

- **R1:** all three entry points contain the classification test/table, concrete-action guidance, project-status distinction, and prohibition on restating completed work as a new Todo. The skill supplies the full watch progress fields and named-action blocker rule.
- **R2:** touched-commitment reconciliation, duplicate/superseded/independent decisions, valid UID-only mixed writes, and post-write readback are present. The full skill preserves recorded-UID ownership, complete paged history without `--since`, committed-write preservation, partial-staging handling, and preserve/report behavior for uncertain state.
- **R2a/R3:** the skill verifies every gate and any promised scheduled check before retirement, records destinations in progress, and preserves incomplete handoffs. Ownership is consistent across the three documents, subject to N3's table-format gap.
- **R4:** correctly remains pending; this review did not inspect or mutate other projects' real Todos, repo observation records, or schedules.
- Prettier check passed for all five changed tracked documents plus the requirement and review. `git diff --check` passed. Local Markdown file-link targets in the implementation and requirement resolve.
- A focused source-CLI smoke check, using an isolated temporary `PMGR_DB_PATH`, confirmed that progress-only observation text creates no Todo, and that completing an action removes it from open work without completing the project. Temporary fixtures were removed.
- The implementation copies the previously reviewed command contracts; no product code changed. Prior mixed-write and recovery checks were not repeated, and the full unit/type/lint suite was not run for this documentation-only diff.

### Closeout

Appended this review only; did not apply N1–N3 or modify the implementation/requirements. Routine project status writeback records this qualified GO separately while preserving existing Todos. No commit, push, release, or R4 cleanup was performed.

## Round 5 — Author response (2026-11-03, Asia/Shanghai)

Author: Claude Code.

- **N1 fixed.** The post-write check in the skill and both READMEs now requires kept or new open commitments to appear once in `next`, completed or cancelled UIDs to be absent, and final statuses to be confirmed with `todos` when needed.
- **N2 fixed.** `--progress` is described as work done, evidence, and watch/check context (including what was not verified) in the skill's status-snapshot summary and both README flag references.
- **N3 fixed.** Both READMEs now render surface ownership as the same three-row table as the skill.
- **R4.** Applied on 2026-11-03 with the user's authorization after this round was written; the result is recorded in the requirement's "R4 triage result" section. The three watches kept for lack of a destination were later cancelled on the user's decision.

Prettier and `git diff --check` pass.
