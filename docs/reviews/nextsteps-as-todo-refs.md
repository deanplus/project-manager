# nextSteps as Todo references — requirements review

Date: 2026-10-29 (Asia/Shanghai)
Base: `24b8313f2796227b01f5bc2e715f48760b49ec52`
Requirements: [nextSteps as Todo references](../../requiments/nextsteps-as-todo-refs.md)
Related: [Independent Todos](../../requiments/todos.md)

## Scope and execution

Requirements-only review (no implementation). Codex CLI `exec` ran from the project root with `-C` so project `AGENTS.md` loaded; sandbox `read-only`; model `gpt-6-astra`; `model_reasoning_effort=high`. The reviewer confirmed project-root `AGENTS.md` first heading `# Project instructions`. No files were edited by the reviewer.

Evidence: [prompt](evidence/nextsteps-as-todo-refs/codex-round1-prompt.txt), [last message](evidence/nextsteps-as-todo-refs/codex-round1-last.txt), [stderr](evidence/nextsteps-as-todo-refs/codex-round1.err).

Reviewer disposition: **NO-GO** until transition, import/source contracts, reference constraints, and write compatibility are specified.

## Round 1 findings (Codex)

1. **F1 / P1 — Activity completion vs unconverted legacy text.** Completing an activity currently preserves full next-step text and `nextStepsSourceUid` on the follow-up. The draft wants new snapshots to store only Todo refs and keeps legacy conversion explicit. Auto-converting on completion violates explicit conversion; clearing refs drops current work from the display; copying text violates the new-write rule. Transition behavior for completion follow-ups must be defined first.

2. **F2 / P1 — Import / source identity vs title match.** Linked Todos with `stepIndex` currently require `entry.nextSteps[stepIndex] === todo.title` on import. New snapshots that stop storing title text cannot keep that check. Import order is entries then Todos; any new “ref must exist” rule must respect that order. Distinguish Todo _provenance_ (how it was created) from snapshot _refs_, and define missing/conflicting refs as whole-batch rollback.

3. **F3 / P2 — Two-step write lacks atomicity / retry.** `todos.md` requires atomic Todo creation from new next steps; `addStatus` does that today, and duplicate `externalRef` does not spawn extra Todos. Preferring `todo-add` then `add` without an idempotency key risks duplicates on retry; `todo-add --project` also fails if the project row does not exist yet. Specify retry semantics and which guarantees `--next` sugar must keep.

4. **F4 / P2 — Cross-project refs and reassignment.** May project A reference an unassigned or project-B Todo? After a ref, may the Todo be reassigned? Project export currently selects that project’s Todos only, so cross-project refs can omit dependencies. Define ownership constraints, duplicate/missing UID handling, and export inclusion.

5. **F5 / P2 — On-disk / API shape not implementable yet.** Mixing free text and UIDs in one string array is not a reliable discriminator. Need an explicit field or version marker; define omitted refs vs empty array; define `current` / `history` / `at` / `export` shapes. Especially: `at` is snapshot-as-of-time; resolving live Todo status there is not historical Todo state unless specified otherwise.

6. **F6 / P2 — Dedup goal lacks acceptance rules.** Keeping `--next` text sugar that always creates Todos still duplicates similar work across follow-up snapshots. Refs alone do not prevent that. Also: prior Independent Todos F5 (copied steps looking newly convertible) is already fixed via `nextStepsSourceUid`; do not treat it as still open.

## Open questions from reviewer

- Should completion follow-ups inherit refs as-is, or only open Todos? How to handle unconverted / partially converted legacy steps?
- Are Todo titles mutable? Today `todo-update` is status/project only.
- Does “todo-update is the only completion path” mean shared update logic, while Dashboard/API may still call it?
- Does Dashboard “add Todo” only create a Todo (optional source link), or also append a snapshot to pin it into current refs?
- Which concrete consumer is the “daily digest”? CLI `todos` currently returns all statuses without open/recent filters.

## Author disposition (2026-10-29)

Accepted F1–F6 as requirements gaps. Revised [requiments/nextsteps-as-todo-refs.md](../../requiments/nextsteps-as-todo-refs.md) with “Decisions after Round 1” addressing each item. Implementation remains blocked until a follow-up Codex pass records GO (or further deltas) in this file below.

## Communication protocol

Subsequent Codex ↔ author exchanges for this change append to **this review document** and/or the requirements doc. Codex review runs should write findings directly into `docs/reviews/` (do not leave the only copy in `/tmp`). No implementation until GO.

---

<!-- Append later rounds below this line -->

## Round 2 — Revised requirements review (2026-10-29)

Base: `24b8313f2796227b01f5bc2e715f48760b49ec52`.

Read Round 1 first, then reviewed the revised requirements including “Decisions after Round 1”, `requiments/todos.md`, and current database/domain, CLI, HTTP, Dashboard, and relevant test paths. This is requirements review, not implementation acceptance.

### Prior F1–F6 disposition

| Finding                         | Closed?                     | Assessment                                                                                                                                                                                                 |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — Completion transition      | **No; partially addressed** | Ref copying and preservation of unconverted legacy text are specified. Partially and fully converted legacy entries still lack a complete transition contract; see F7.                                     |
| F2 — Import and source identity | **Yes**                     | Provenance is separate from refs; new snapshots no longer require legacy title equality; payload dependencies and atomic validation are specified. Ownership consistency remains blocked separately by F8. |
| F3 — Atomicity and retries      | **Yes**                     | Atomic text sugar, externalRef retry behavior, first-project creation, and two-step retry limitations are explicit.                                                                                        |
| F4 — Ownership and export       | **No**                      | Allowed reassignment makes immutable historical refs fail the import ownership rule; see F8. Duplicate-reference policy also remains unspecified.                                                          |
| F5 — Storage and read shapes    | **No; partially addressed** | Dedicated refs and live-versus-as-of semantics are sufficient. Empty/absent legacy refs conflict with field-presence detection; see F9.                                                                    |
| F6 — Dedup acceptance           | **Yes**                     | UID reuse preserves work identity; repeating text on a distinct write intentionally creates new work. The prior Independent Todos F5 fix is correctly recognized.                                          |

### Findings

#### F7 / P1 — Legacy conversion assumes a state transition that does not exist

Requirements lines 80–82 promise refs-only completion after conversion and describe full-list conversion as the “existing idempotent rule”. However, `requiments/todos.md:4` specifies conversion once per source index. `convertNextStep` (`src/db.ts:854–882`) creates/reuses one Todo, follows `nextStepsSourceUid`, and never appends or updates a snapshot. HTTP accepts an individual `index` (`src/server.ts:295–296`); Dashboard exposes per-index conversion buttons (`src/web/script.ts:188–192`).

Valid existing data therefore includes partially converted string snapshots and fully converted string snapshots without refs. Normal pre-upgrade `addStatus` writes already create the latter (`src/db.ts:294–307`). Declaring partial conversion unsupported does not explain how these existing states behave. Even after full conversion, immutable legacy snapshots have no stored UID list for completion to copy.

**Required decision:** Define completion behavior when zero, some, or all legacy indices have been converted, including copied source entries. Specify whether explicit conversion appends a refs-only snapshot or completion derives refs from the original source after full conversion. Preserve existing Todo UIDs/statuses and unconverted work without implicit conversion.

If introducing an all-steps conversion action, explicitly retain or supersede the per-index API and define compatibility with existing partial data. Also document the legacy completion-copy exception to the unconditional “new snapshots contain no prose” acceptance criterion.

#### F8 / P1 — Allowed project changes break historical-reference round trips

Requirements lines 92–94 reject cross-project refs during import but protect only current pins when changing a Todo’s project.

Counterexample:

1. Independent Todo T belongs to A; snapshot A1 references T.
2. A2 unpins T.
3. T is reassigned to B, as permitted by the proposed minimum v1 rule.
4. Exporting A includes immutable A1 and T’s current row with project B.
5. Importing that valid export violates the cross-project rule.

A full export has the same contradiction.

There is also a current-state case: unassigned T may be pinned by both A and B, yet “Unassigned → project assignment is fine” permits assigning T to B while A still pins it. Checking only T’s old project cannot protect those references.

**Required decision:** Either prevent project changes incompatible with any retained reference, or explicitly support historical ownership changes with an import contract that can validate them. Check all referencing current projects before assigning an unassigned Todo. Including its row in export does not resolve the ownership conflict.

Clarify whether the existing prohibition on reassigning source-linked Todos remains (`src/db.ts:903–905`). Lifting it also affects source-project validation (`src/db.ts:951–954`) and scoped export dependencies.

#### F9 / P2 — Empty refs cannot also identify both legacy and new formats

Requirements line 65 allows legacy rows to have **empty or absent** refs; line 66 says explicit `[]` means no current next Todos; line 68 detects format by field presence. Line 80 copies refs whenever the current snapshot “already has” them, while line 81 preserves legacy strings when refs are empty.

A legacy entry containing `nextSteps: ["work"]` and `nextTodoUids: []` therefore has incompatible interpretations. A migration or serializer that materializes an empty refs default could cause completion to discard visible legacy work. “Unknown/legacy handling per version marker” does not determine which behavior wins, particularly when a new bundle contains old entries.

**Required decision:** Specify one unambiguous per-entry discriminator and a validity matrix covering absent refs, empty refs, nonempty refs, and nonempty legacy text for storage and import. Define whether new-format entries missing refs and mixed text/ref payloads are rejected or normalized. Preserve the distinction through export/import and completion. Exact column/key names can remain implementation choices.

### Remaining open questions

- Which action transitions a legacy current entry to refs, and how are existing partial conversions preserved? See F7.
- Is ownership permanent for historical refs, or checked only when originally attached? How do imports validate that rule and handle unassigned Todos shared by projects? See F8.
- What discriminator and validity matrix govern legacy versus new entries? See F9.
- Are repeated UIDs in one ordered reference list rejected or deduplicated while preserving first occurrence? Round 1 F4 requested a rule; none is stated.
- May one write combine `--next` and `--next-todo`? If allowed, define ordering; otherwise explicitly reject the combination.

The earlier questions about title mutation, shared completion logic, Dashboard creation versus pinning, and the daily-list consumer are adequately answered.

### Verification and scope

An assertion-based check against current source using SQLite `:memory:` passed:

1. Import two legacy steps.
2. Convert index 0 only.
3. Complete the activity.
4. Verify both legacy strings and the original source UID remain.
5. Reconvert index 0 through the copy and verify the same Todo UID and unchanged Todo count.

This confirms existing partial conversion and the prior source-copy dedup fix. The check ran through `node -e` with the tsx cache disabled and created no filesystem artifacts.

No full test suite, browser verification, product/source edits, project-ledger updates, commit, or deployment were performed. The ownership and discriminator counterexamples concern proposed requirements; the unimplemented reference feature was not executed.

Appending this section to the designated review file failed with sandbox `PermissionError: Operation not permitted`. The review file remains unchanged; this section is supplied in the final response as requested.

**NO-GO for implementation until F7–F9 and the duplicate-reference policy are resolved in the requirements.**

Evidence: [prompt](evidence/nextsteps-as-todo-refs/codex-round2-prompt.txt), [last message](evidence/nextsteps-as-todo-refs/codex-round2-last.txt), [stderr](evidence/nextsteps-as-todo-refs/codex-round2.err).

### Author note

Round 2 ran under read-only sandbox; author appended this section from the reviewer final message. Requirements updated with Decisions after Round 2 before Round 3.

## Round 3 — Revised requirements review (2026-10-29)

Base: `24b8313f2796227b01f5bc2e715f48760b49ec52`.

Reviewed prior rounds, the revised requirements including “Decisions after Round 2”, Independent Todos requirements, and relevant source paths. This is requirements review, not implementation acceptance. Requirements line references below refer to `requiments/nextsteps-as-todo-refs.md`.

### Disposition

| Item                              | Closed?       | Assessment                                                                                                                                                                                                                              |
| --------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F7 — Legacy conversion transition | **No**        | Per-index conversion, materialization, UID/status preservation, and fully converted behavior are now explicit. Partial conversion still requires an invalid mixed row, and filtering strings breaks the existing source-index contract. |
| F8 — Historical ownership         | **Partially** | The all-history project-change prohibition closes the round-trip counterexamples if applied universally; the adjacent current-unpin instruction still implies an incompatible exception.                                                |
| F9 — Format discriminator         | **Partially** | The presence/NULL matrix and serializer rule resolve the original ambiguity, but the prescribed legacy transition violates that matrix.                                                                                                 |
| Duplicate references              | **Yes**       | Line 149 explicitly rejects repeated UIDs on write/import, preserving order without silent deduplication.                                                                                                                               |
| CLI combination                   | **Yes**       | Line 150 explicitly rejects combining `--next` and `--next-todo` in one `add`.                                                                                                                                                          |

### Remaining blockers and new finding

#### F7 / F9 / P1 — Partial conversion produces a forbidden snapshot

Lines 118–119 require a completion follow-up to contain both converted Todo refs and remaining unconverted strings. For source `["A", "B"]` with only index 0 converted to Todo T, the prescribed result is `nextTodoUids: [T]` plus `nextSteps: ["B"]`.

That violates both line 115's prohibition on mixed commitments and line 141's explicit write/import rejection. Even zero converted indices require a decision to omit refs rather than emit `[]` alongside strings. Allowing the mixed row without further changes is insufficient: line 145 would treat it as refs-only on the next completion, leaving the remaining legacy work without a preservation rule.

**Required decision:** Choose one consistent transition. The smallest option compatible with the stated matrix is to preserve the complete legacy string list and source UID, with refs absent, while any source index remains unconverted; materialize refs only once all indices have Todos. Alternatively, explicitly define a supported mixed format, its discriminator, repeated-completion behavior, and import/export rules. Make the acceptance criterion and superseded Round 1 text agree with the selected rule.

#### F8 / P2 — Current unpinning cannot release an all-history ownership lock

Line 127 explicitly rejects **any project change** once any stored snapshot references a Todo. Line 128 nevertheless tells users to unpin an unassigned Todo from other projects' current snapshots before assignment.

For unassigned T referenced by A1 and B1, appending A2 and B2 without T leaves A1 and B1 intact. Assigning T to B is therefore still forbidden by line 127; permitting it after unpinning recreates the invalid A1-to-B round trip identified in Round 2.

**Required decision:** Make the all-history rule authoritative and remove the suggestion that current unpinning enables assignment. State explicitly that a referenced unassigned Todo remains unassigned under v1, even after every current snapshot unpins it. Retain the now-explicit source-linked reassignment prohibition. If assignment after unpinning is intended instead, historical ownership/import semantics still need a different design.

#### F10 / P1 — Filtering legacy strings loses original source indices

Line 119 introduces copying only the **remaining unconverted strings** through the existing `nextStepsSourceUid` path. That path requires the copied list to equal the original list (`src/db.ts:359–369`), and conversion forwards the copy's index unchanged to the original source (`src/db.ts:854–866`). Dashboard conversion also uses the displayed array index (`src/web/script.ts:192`).

With source `["A", "B"]` and A already converted, a copy containing only `["B"]` fails current provenance validation. Simply relaxing that validation would make conversion of displayed index 0 resolve source index 0 (A), not B; the Dashboard can also hide B because index 0 already has a Todo. This is a separate identity problem even if mixed rows become valid.

**Required decision:** Preserve the full original list and its indices until refs-only materialization, or specify an explicit original-index mapping carried through storage, API/UI conversion, validation, and export/import. Matching by title is insufficient because legacy titles may repeat. Acceptance must cover converting a remaining item through a completion copy, repeated completion, and export/import while preserving each original Todo UID and status.

### Verification and scope

Checked the proposed zero/partial/full-conversion transitions and ownership counterexamples against the revised rules; inspected the existing provenance, conversion, completion, import, and Dashboard paths. No implementation tests or full suite were run; the proposed refs feature is not implemented.

Only this Round 3 section was appended to the designated review file. No product/source/test files, requirements, project-ledger records, commits, or deployments were changed.

**NO-GO for implementation until the F7/F9 transition conflict, F8 ownership exception, and F10 source-index preservation are resolved.**

### Author note

Author revised requirements with Decisions after Round 3 (smallest consistent transition).

## Round 4 — Revised requirements review (2026-10-29)

Base: `24b8313f2796227b01f5bc2e715f48760b49ec52`.

**Disposition: GO for implementation.** F1–F10 are closed at the requirements level under the authoritative Round 3 rules. One non-blocking documentation finding remains.

Reviewed the complete review history through Round 3, the requirements including “Decisions after Round 3,” Independent Todos requirements, and relevant provenance, conversion, completion, import/export, and Dashboard source paths. Requirements references below refer to `requiments/nextsteps-as-todo-refs.md`.

### Prior findings disposition

| Finding                           | Closed? | Assessment                                                                                                                                                                                           |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — Completion transition        | **Yes** | Lines 80–82 and 115–119 define ref copying, legacy preservation, and materialization without implicit conversion.                                                                                    |
| F2 — Import and source identity   | **Yes** | Lines 72–75 separate provenance from refs, remove inappropriate legacy title matching for new snapshots, and require payload dependencies and atomic validation.                                     |
| F3 — Atomicity and retries        | **Yes** | Lines 86–88 retain atomic text sugar, externalRef retry behavior, and project creation within the transaction; two-step retry limitations are explicit.                                              |
| F4 — Ownership and export         | **Yes** | Export includes referenced Todos; the authoritative all-history lock preserves ownership compatibility. Duplicate refs are explicitly rejected.                                                      |
| F5 — Storage and read shapes      | **Yes** | Dedicated refs, raw/resolved read shapes, live-versus-as-of limitations, and the per-entry discriminator are specified.                                                                              |
| F6 — Dedup acceptance             | **Yes** | Reusing UIDs preserves work identity; repeating text on distinct writes intentionally creates new Todos. Existing legacy provenance deduplication remains required.                                  |
| F7 — Legacy conversion transition | **Yes** | Zero/partial conversion retains the full original string list with refs absent. Full conversion materializes existing Todo UIDs in source-index order without changing their statuses.               |
| F8 — Historical ownership         | **Yes** | Line 124 explicitly makes the all-history lock authoritative, including assignment from unassigned and clearing the project. Current unpinning cannot release it; source-linked restrictions remain. |
| F9 — Format discriminator         | **Yes** | Lines 130–141 distinguish absent refs from explicit `[]`, reject mixed rows, and prohibit serializers from adding empty refs to legacy rows. The revised transition obeys this matrix.               |
| F10 — Source-index preservation   | **Yes** | Lines 117–119 require the complete source list and unchanged indices across copies, conversion, repeated completion, and round trips. No title-based matching or filtered-index mapping is needed.   |

The duplicate-UID and CLI-combination questions remain closed by lines 146–147. Earlier questions about title mutation, shared completion logic, Dashboard creation versus pinning, and the daily-list consumer remain answered.

### New finding

#### F11 / P3 — Superseded summary wording remains in the requirements

Earlier passages still state:

- All new snapshots contain refs rather than prose (line 49), without mentioning the legacy-copy exception.
- Legacy refs may be empty or absent, with version-based handling for omitted refs (lines 65–66).
- Current unpinning permits reassignment and unassigned Todos may be assigned freely (line 93).

The later transition, discriminator matrix, and explicitly authoritative ownership lock resolve these behaviors, so this is **non-blocking documentation inconsistency**, not an unresolved design decision.

**Recommendation:** Align these earlier passages with the final rules or mark them explicitly superseded, so implementation and acceptance checks do not accidentally follow obsolete text.

### Verification and scope

Rechecked the original counterexamples against the revised contract:

- Partial conversion preserves every original index through repeated completion copies.
- Full conversion reuses existing Todo UIDs and statuses.
- Explicit empty refs cannot resurrect legacy strings.
- Historical references prevent incompatible ownership changes even after current unpinning.
- Export dependencies and import validation remain compatible with those constraints.

This was read-only requirements review. No implementation tests were run, and no files, project-ledger records, commits, or deployments were changed. Approval permits implementation; it does not establish implementation correctness or release readiness.

GO

Evidence: [last message](evidence/nextsteps-as-todo-refs/codex-round4-last.txt).

### Author note

Accepted GO. Fixed F11 superseded wording in requirements; status ready for implementation after wording cleanup.

## Round 5 — Requirements review

Round 4 GO still holds. F11’s corrections align the legacy-copy exception, absent-versus-empty refs, and all-history ownership lock with the Round 3/4 Decisions. F1–F10 remain closed at the requirements level.

One non-blocking wording ambiguity remains: [line 31](/Users/dwong/mydoc/code/projects/project-mgr/requiments/nextsteps-as-todo-refs.md:31) says “after conversion”; “after **all source indices are converted**” would be more precise. Lines 117–118 already make the governing behavior unambiguous. Earlier “waits for GO” statements are historical and superseded by Round 4.

Read-only review; no files changed or implementation tests run.

**GO — proceed with implementation; implementation correctness remains subject to review.**

Evidence: [last message](evidence/nextsteps-as-todo-refs/codex-round5-last.txt).

### Author note

Applied the Round 5 wording precision fix. Requirements status remains GO for implementation.

### F11 closure

Author closed F11: earlier contradictory summaries aligned; Round 5 precision on “after all source indices are converted” applied. Requirements Status remains GO.

## Round 6 — Post-implementation cross-review (2026-10-29)

Reviewer role: Codex post-implementation cross-review.
Session ID: `01a185c5-e78f-73c2-bd0c-ee650aa63644` (verified through CODEX_THREAD_ID).
Branch: `cursor/nextsteps-as-todo-refs-4a65`.
PR: https://github.com/deanplus/project-manager/pull/1
Reviewed HEAD: `5835a92d07dc0c29a3152571a442c85f864d412a`.
Base: `24b8313f2796227b01f5bc2e715f48760b49ec52`.
Remote PR HEAD was verified to match the local reviewed commit.

**Disposition: NO-GO.** The requirements remain GO, but implementation
acceptance is blocked by F12–F14 below.

### Requirements and previous-review closure

Read the complete nextSteps requirements and Decisions, review history
through Round 5/F11 closure, and Independent Todos requirements.

F11 is closed at the documentation level. The Round 5 clarification now
explicitly requires all source indices to be converted before refs
materialization. The authoritative legacy transition, format discriminator,
and all-history ownership rules remain consistent.

Inspected implementation and tests for atomic Todo creation, completion,
legacy conversion, provenance, import/export, ownership, CLI, HTTP, and
Dashboard rendering. Selected tests confirm partial-conversion index
preservation, full-conversion UID/status reuse, immutable snapshots,
live resolution, ownership locks, and basic import rejection. These
passing paths do not resolve the following implementation defects.

### Findings

#### F12 / P1 — Public importStatuses bypasses reference integrity checks

Location: `src/db.ts:467–471`; publicly exported through `src/index.ts`.

`importStatuses` validates entry shape but calls `addValidatedStatus`
without validating Todo existence or project ownership.

In-memory reproduction:

1. Import an entry whose nextTodoUids contains a fresh, nonexistent UUID.
2. The entry is committed successfully.
3. `current` reports a fallback Todo with status `open`.
4. Export the ledger and import it into a fresh database: import fails
   with `dangling next todo uid`.

A separate reproduction successfully imported an alpha snapshot referencing
a beta-owned Todo through the same API.

Impact: callers of this public API can persist invalid snapshots and
produce exports that cannot round-trip. The CLI uses `importLedger`, so
this particular bypass is a public API defect rather than its CLI path.

Required correction: apply shared reference validation atomically on
every import entry point, or explicitly reject ref-bearing entries in
the legacy-only API. Add rollback tests for dangling and cross-project
refs through `importStatuses`.

#### F13 / P2 — Import dependencies need not be present in the payload

Location: `src/db.ts:834–837`, `src/db.ts:920–930`.
Contract: nextSteps requirements line 74.

`importLedger` checks references against existing database rows without
requiring the referenced Todo to appear in the incoming payload.

In-memory reproduction: create an unassigned Todo locally, then import
a version-4 bundle containing a snapshot referencing it but `todos: []`.
Import succeeds. The identical bundle fails against a fresh database.

Impact: incomplete imports are accepted depending on destination state,
contrary to the explicit same-payload dependency requirement.

Required correction: validate payload membership as well as database
existence and ownership, within the batch transaction. Test an omitted
dependency against both empty and populated databases; both must reject
and roll back.

#### F14 / P2 — Caller-supplied UID retries conflict after text conversion

Location: `src/db.ts:324–336`, `src/db.ts:370–387`.

`addStatus` compares the original text-shaped request against the stored
refs-shaped snapshot before normalizing a replay. An identical retry
therefore fails with `conflicting entry uid`.

Reproduced with a fixed uid, occurredAt, externalRef, and nextSteps.
Baseline `24b8313` returns `inserted=false` on retry; reviewed HEAD throws.
Providing externalRef does not help because UID comparison runs first.

Impact: existing public API callers lose idempotent retries after a
successful write. ExternalRef-only CLI retries remain functional.

Required correction: recognize equivalent retries across text-to-ref
conversion while retaining genuine identity-conflict rejection. Test
fixed-UID retries with and without externalRef, preserving Todo count,
UIDs, and statuses.

### Evidence and scope

- 18 selected existing tests passed using SQLite `:memory:` and VM-based
  UI checks, with the tsx cache disabled.
- TypeScript `--noEmit` and ESLint passed.
- Independent in-memory assertions reproduced F12 and F13.
- An in-memory comparison using baseline source and reviewed HEAD
  reproduced the F14 regression.
- Full filesystem-writing tests, disk migration tests, build, coverage,
  and real-browser verification were not run.
- No files, project-ledger records, commits, or deployments were changed.
  Existing untracked review evidence was left untouched.

**NO-GO — fix F12–F14 and rerun targeted cross-review before implementation acceptance.**
