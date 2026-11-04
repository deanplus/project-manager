# Review: Todo start/due timestamps and editing

Append-only. Add later review rounds below; preserve earlier findings and evidence.

Requirements: [Todo start/due timestamps and editing](../requirements/todo-start-due-and-edit.md)

## Round 0 — Requirements review (2026-11-04, Asia/Shanghai)

Reviewer: Claude Code (Opus 5.5), session `d61e48de-3a5e-4038-9d3f-9021529582d3`. Resume this session for the requirement delta and for the implementation review. Author: Codex, session `01a1a43b-a3a3-7ce0-a0bf-2b5915994c2b` (context only; not resumed).

Disposition: **NO-GO for implementation handoff as written.** The design is sound and does not need rethinking: one UID-preserving patch contract, nullable columns, portable version 5, and relaxed title equality for renamed legacy-derived Todos. Handoff is blocked by two user decisions (Q1, Q2) and by three text defects (F2–F4). These can be fixed in one short revision. [Conditions for GO](#conditions-for-go) lists the exact exit.

### Review basis

- Repository HEAD: `bd9170efd1f151b6af0bb807a426ec0621872596`; package `0.5.2`.
- Reviewed draft: untracked `docs/requirements/todo-start-due-and-edit.md`, SHA-256 `9393e14a9fff676261a608f64686167202a3284d8163990a7f8359faed6ca81d`. Line numbers refer to this draft.
- Compared against `docs/requirements/next-todo-current-consistency.md`, `docs/requirements/next-actions-vs-watch-items.md`, `requiments/todos.md`, `src/db.ts`, `src/cli.ts`, `src/server.ts`, `src/domain.ts`, `src/web/script.ts`, `skills/project-mgr/SKILL.md`, `docs/architecture.md`, `README.md`, `README_CN.md`, `CHANGELOG.md`, and test grep hits.
- Ran focused probes against 0.5.2 source (`node --import tsx`) with a temporary `PMGR_DB_PATH` and `:memory:`. The temporary directory was removed afterward. Renames and new columns were simulated with direct SQL on those temporary databases only, because no rename API exists yet.
- Not checked: the real ledger was not opened or changed, so the wording of Todos `21b3e139…`, `589f0f47…`, `8cd380d6…`, and `76114006…` was not audited. The test suite was not run; no product code changed.

### Findings

#### F1 / Major — Blocking product decisions are still open

Location: lines 55, 63, 72, 158–161, 168.

The draft itself says Q1–Q4 must be resolved first. R1–R3, the CLI's `--clear-due-at`, and AC 1–3 are all contingent on them. An implementer cannot write the tests or freeze the schema names. See [Open question recommendations](#open-question-recommendations): Q1 and Q2 need the user; Q3 and Q4 need only a batch confirmation of the recommendations below.

#### F2 / Major — The draft contradicts accepted action/watch rules and omits the guidance that carries them

Location: lines 118 and 146; compare `next-actions-vs-watch-items.md` Definitions and its AC 3.

Three conflicts:

1. **Revised dates.** The accepted Definitions say a revised date is a **supersede**: `--cancel-todo <old>` plus a new action in one `add`, with evidence in `--progress` (`skills/project-mgr/SKILL.md:134`, `README.md:391`). Line 146 says a due correction targets the existing UID "rather than creating a replacement pin". R5 line 103 draws the line in principle (same occurrence vs. replacement commitment), but no rule tells an agent which path applies to a changed date. The `31876fd0` / `ffa73775` quota pair from the accepted requirement's evidence differs in both date and decision and would be handled differently under the two texts.
2. **Timed-action wording.** `SKILL.md:106`, `README.md:373`, and `README_CN.md:364` say to put the time in the title, and the accepted table says so "until `21b3e139` adds due dates". This draft is that trigger, yet R6 (line 118) names only the READMEs and CLI help. `skills/project-mgr/SKILL.md`, `docs/architecture.md`, and `CHANGELOG.md` are missing, although the preceding requirement's R6 listed them and the skill is what agents actually read.
3. **Watch regression risk.** A future `startAt`/`dueAt` makes "wait until X" look like a legitimate Todo. Without a rule, agents can restore the watches that were triaged out on 2026-11-03 by giving them a next-check time. The non-goal at line 44 keeps the classification but does not protect it.

**Required revision.** Add a requirement (for example R8) for agent guidance, covering `SKILL.md`, both READMEs, `docs/architecture.md`, and `CHANGELOG.md`:

- New timed actions set `--due-at` through the existing `todo-add` + `--next-todo` form (`add --next` has no time syntax per R2), and do not repeat the time in the title, where it would go stale. Existing titles are not rewritten.
- **Edit in place** when the commitment is unchanged: fixing wording or a mistaken time.
- **Supersede** when evidence or a decision changed the commitment.
- `todo-update` writes no snapshot and no audit record. If an edit in place needs recorded evidence, follow it with an `add --progress`. These are two steps, not one transaction, so guidance must not imply atomicity.
- The classification test is unchanged. A start or due time never turns a watch into an action, and `dueAt` fires nothing, so check times stay with scheduled tasks.

Mark the accepted requirement's "until `21b3e139`" row as resolved by this document when implementation lands.

**Acceptance cases.** Add one correction case (UID preserved, pins unchanged) and confirm `next-actions-vs-watch-items` AC 3 still holds for a superseded date.

#### F3 / Major — R5's fixed-UID retry rule cannot be met without new storage

Location: lines 105 and 177 (AC 8).

Line 105 says "Review…" and "must not authorize a different snapshot payload". The first is not a testable requirement, and the second is impossible with the proposed schema. `textRefEquivalent` compares supplied titles with the live Todo title (`src/db.ts:433–434`), and refs-format snapshots store no title text. Probe with a simulated rename from `Old title` to `New title`, using a fixed-UID `addStatus` retry:

| Retry after rename                    | Result                                    |
| ------------------------------------- | ----------------------------------------- |
| Original payload, `nextSteps: [Old]`  | throws `conflicting entry uid`            |
| Different payload, `nextSteps: [New]` | accepted, `inserted: false`               |
| Stored snapshot                       | `nextSteps: []`, `nextTodos: [New title]` |

So a real retry now fails, and a payload that was never written passes. The second case is exactly what line 105 forbids. Fixing it needs original titles stored per pin or an edit history, and the draft excludes history (line 42). Neither case mutates anything.

**Required revision.** Replace line 105 with a decision. Recommended: accept this as a documented limitation (call it L3), next to L2 in `docs/architecture.md:185`. Guarantees: retries never mutate a Todo or snapshot; the original payload fails closed after a rename; a payload matching the current title returns the stored entry with `inserted: false`. This is low risk: the CLI never passes a fixed UID (`src/cli.ts:509–535`), imports do not use `textRetry` (`src/db.ts:358`), and `--external-ref` replay returns before title comparison. AC 8 should assert these three results rather than "any retained limitation documented".

#### F4 / Major — `startedAt` names the opposite of the recommended meaning

Location: lines 51, 61, 159; CLI lines 133–140.

Q2 recommends a planned start "despite the past-tense name". Every other `*At` field in this product records something that already happened (`createdAt`, `completedAt`, `occurredAt`, `recordedAt`). An agent reading `startedAt` in `pmgr next --json` will conclude the work has begun. The name would be frozen by migration 6, portable version 5, and the CLI, so renaming later costs another migration and format version. A documentation note is not an adequate fix when the correct word costs nothing now.

**Required revision.** Bind name to meaning:

- Planned start (recommended): `startAt`, `start_at`, `--start-at`, `--clear-start-at`. R1's ordering rule stands.
- Actual start: keep `startedAt`, drop the `start <= due` rule (late starts are legitimate), and reject future values.

#### F5 / Minor — The 20,000-unit content limit exceeds the HTTP body limit

Location: lines 83 and 181 (AC 12); `src/server.ts:295`.

R6 and AC 12 say HTTP uses the same validation, but the mutation route returns 413 above 32,768 bytes. 20,000 CJK characters serialize to 60,014 bytes, so roughly 10,900 is the HTTP ceiling for Chinese content. The CLI would accept text the API rejects, and this ledger's content is often Chinese.

**Recommendation.** Lower the limit to **8,000 code units** and keep the 32 KiB bound, which is a safeguard. A UTF-16 code unit takes at most 3 UTF-8 bytes, so 8,000 content units plus a 2,000-unit title is about 30 KB before JSON escapes. Heavily escaped text can still hit 413, which is acceptable. Add an AC: 8,000 CJK characters succeed over both CLI and HTTP.

#### F6 / Minor — `--content ""` cannot reach R3 normalization

Location: line 144.

The CLI parser rejects any empty value and any value starting with `--` before validation (`src/cli.ts:76–78`). Verified with `todo-add --title ""` and `--title "--- leading dashes"`: both print `--title requires a value`. The draft's claim that `--content ""` follows R3 normalization is therefore false for the CLI; the domain and HTTP paths can still receive it. Content starting with `--` or a Markdown `---` rule is also rejected.

**Required revision.** Say `--clear-content` is the CLI clearing syntax, `--content ""` is an error, and blank-to-null applies to domain/HTTP input and whitespace-only CLI values. Document the leading-`--` limit, or state that it is fixed in this increment. Recommended: document it, since file/stdin input is deferred under Q4.

#### F7 / Minor — R7 leaves the version 5 import contract underspecified

Location: lines 123–127.

- Are the three keys **required** in version 5 Todos, or may they be absent? Recommended: required, because silently accepting a truncated record defeats the version bump.
- Are non-canonical values normalized or rejected on import? Line 126 says "compare normalized values" while line 124 says "same validation". Recommended: accept offsets and normalize before the same-UID comparison, matching `parseTime` on `recordedAt`.
- Is `startAt <= dueAt` enforced on import? Line 124 lists timestamp/content validation only. Recommended: yes.
- `importTodo` currently has no version input (`src/db.ts:1471`). The relaxed title check at `src/db.ts:1510` must be version-gated as Q7 says. An AC should prove a version 3/4 record with a mismatched title is still rejected, and a version 4 record containing `dueAt` is rejected as an unknown field.

#### F8 / Minor — Deadlines are invisible on every human-facing surface

Location: lines 115, 117, 163.

R6 keeps `next`, `current`, and `todos` text output unchanged and defers the dashboard. Q6 asks only about the dashboard. As written, a person can see a due time only by reading `--json`. Agents are served; the user may not be.

**Recommendation (user decision, non-blocking).** Widen Q6 to include CLI text. Append ` [due <UTC>]` to `next` and `current` lines only when `dueAt` is non-null. This leaves undated rows byte-identical and costs one line per surface. Dashboard display stays deferred. If the user prefers JSON only, line 115 stands.

#### F9 / Minor — Mixed-version risk is concrete but not spelled out

Location: line 153.

Probe with 0.5.2 code on a database that has the new columns: `updateTodo` leaves `due_at` and `content` intact, because it only writes named columns. But `exportLedger` emits a **version 4** bundle without those keys, with no warning, and `openLedger` has no newer-schema guard. R7's "old readers must reject" protects files, not an old build on a migrated database. The realistic case here: the PM2 dashboard runs `dist/cli.js` against the real ledger (`ecosystem.config.cjs`) and keeps old code until restarted. The global `pmgr` is an `npm link` to this repository, so it also stays old until `pnpm build`, while any source run with the real `PMGR_DB_PATH` would already apply migration 6.

**Required revision.** Keep the "not promised safe" stance, and have M4/README state the concrete rule: run `pnpm build` and restart the dashboard before the first metadata write, and do not treat an export from an older build as a backup. No guard is needed in this increment.

#### F10 / Minor — "Historical snapshot text stays immutable" overstates what survives a rename

Location: line 104; `src/db.ts:805`; `docs/architecture.md:115,135`.

Refs-format snapshots store no title text (F3 probe: `nextSteps: []`), and edit history is a non-goal. A rename therefore destroys the old wording, and `history` shows the new title on every earlier snapshot. `at` returns stored refs only. This is consistent with "Todos are editable current state" and is an acceptable design, but the sentence reads as if the wording were preserved. A legacy source differs: `current.nextSteps` keeps the old string while `openWork` shows the new title (probe: `["Step A","Step B"]` vs. `["Step A renamed","Step B"]`).

**Required revision.** State that a rename is lossy for refs-format snapshots and that `history` displays the new title. Guidance should say to record old wording in `--progress` if it matters. Add the legacy divergence to AC 7.

#### F11 / Minor — R1 cannot reuse `parseTime`, and its AC omits the cases that prove it

Location: lines 65, 171 (AC 2).

R1's rejection list is correct, but `parseTime` (`src/domain.ts:171`) accepts what R1 rejects. Probes:

| Input                       | `parseTime` result         |
| --------------------------- | -------------------------- |
| `2026-02-30T00:00:00Z`      | `2026-03-02T00:00:00.000Z` |
| `2026-11-04T24:00:00Z`      | `2026-11-05T00:00:00.000Z` |
| `2026-11-04T10:00Z`         | accepted                   |
| `2026-11-04T10:00:00.5Z`    | accepted                   |
| `2026-11-04T10:00:00-00:00` | accepted                   |

**Required revision.** Name these literally in AC 2 so an implementer does not reuse `parseTime`. Specify offset bounds and `-00:00`. Recommended: hours `00–23`, minutes `00–59`, `-00:00` accepted as UTC, `:60` and `T24:00:00` rejected, lowercase `z`/`t` rejected.

#### N1 / Nit — The entry-linked HTTP route is ambiguous

Line 111 says HTTP Todo APIs accept the new inputs. `POST /api/entries/:uid/todos` allows `title` only (`src/server.ts:321–323`). Line 75 allows null defaults for "existing creation paths". Say this route stays title-only.

#### N2 / Nit — Canonical timestamps do not compare lexically with lifecycle timestamps

New values have no milliseconds, while `createdAt` and `completedAt` do. Within one second, `.` sorts before `Z`, so string comparison between the two families is wrong. Comparison among new fields is safe. Add one sentence after line 66: compare across families by parsed instant.

#### N3 / Nit — Version 5 updates existing assertions and docs

Every export containing a Todo moves to version 5, so existing assertions (for example `test/next-todos.test.ts:251`) and `README.md:452` change. The previous requirement's "round-trip tests pass unchanged" wording cannot carry over. Say so to prevent a reviewer treating these as regressions. `ledgerVersion` keeps 2/3/4 only for bundles with no Todos.

#### N4 / Nit — Drafting scaffolding should leave the accepted text

AC 13's last sentence, the M5 and non-goal lines about this drafting task, and "status supplied by the task" describe the drafting session. Remove them on acceptance and add the `Review:` header link used by sibling documents. AC 9's "concurrent" should read as two connections with interleaved writes, since `updateTodo` is synchronous under `.immediate()`.

### Open question recommendations

| Q                           | Who decides                | Recommendation                                                                                                                                                                              |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 due requiredness/default | **User** (blocking)        | Optional on every Todo; omitted means `null`; **no default**. See below.                                                                                                                    |
| Q2 start meaning            | **User** (blocking)        | Optional planned start, independent of due, named `startAt` (F4).                                                                                                                           |
| Q3 timestamp contract       | Batch confirm              | Accept R1, with the F11 bounds. Explicit zone, seconds only, canonical UTC, no stored offset.                                                                                               |
| Q4 content contract         | Batch confirm              | Accept R3, with **8,000** instead of 20,000 (F5). Blank to null. No file/stdin or Markdown rendering.                                                                                       |
| Q5 authorship               | Reviewer agrees; no action | Exclude. "etc." is not evidence for a new attribution model. `todo-update` edits carry no author.                                                                                           |
| Q6 dashboard/visibility     | User, non-blocking         | Dashboard compatibility only, plus the CLI text suffix in F8.                                                                                                                               |
| Q7 version/provenance       | Reviewer agrees, with F7   | Version 5 and relaxed title equality for that version only. Probe confirms the need: a renamed legacy-derived Todo exports as version 3 and fails re-import with `invalid next step index`. |

**Q1 rationale.** Optional with no default, for these reasons:

- `add --next` remains the main creation path and has no time syntax (R2). Requiring due would break it or force an invented value.
- The accepted classification gives only **timed actions** a time. A plain action has none, so "required for all" contradicts that table. "Required for timed actions" cannot be enforced, because the classification is a judgment software does not make. It belongs in guidance as "timed actions should set `--due-at`" (F2).
- Nothing consumes due: reminders, sorting, and hiding are non-goals. A default deadline would be precise-looking data with no evidence behind it, the same objection M3 of the consistency requirement raises against invented status claims.
- Any default such as end of day needs a timezone, which R1 deliberately refuses to infer.
- Old rows and old imports are null regardless, so every consumer must handle null either way.

This still needs the user's explicit answer. The draft notes that cancelled Todo `76114006…` mentioned mandatory/default due, and this review did not read the ledger. If the user chooses required, the draft's Q1 follow-ups (`add --next`, conversion, old rows, unrelated edits, clearing) become blocking.

### Confirmed correct

- The Problem table matches 0.5.2: `todo-add`/`todo-update` flags (`src/cli.ts:113,117`), Todo columns and migrations 4/5 (`src/db.ts:143–163`), the `openWork` item shape including the two construction sites (`src/db.ts:703,759`), and the import checks. Migration 6 is the correct next number. No file in `src/` adds start, due, or content.
- `completedAt` transitions, unknown-key rejection through `record()`, serialized patches via `.immediate()`, project-ownership locks, and `(entryUid, stepIndex)` retry resolution match the code that R2, R4, and R5 preserve.
- `closeTodos` and `--done-todo` go through `updateTodo` with `{ status }` only, so they preserve new metadata with no extra rule.
- Pin and carry compatibility holds. Pins are UID lists, so edits cannot disturb them. `openWork` is computed live, and exact-title reuse reads the current title (`src/db.ts:540`). The dashboard sends partial patches only (`{status}`, `{project}`), so it cannot clear stored metadata. No dashboard logic uses a title as identity.
- R7's diagnosis is precise: only legacy-string sources need relaxation (`src/db.ts:1510`). Refs-format sources already validate by UID. With the new columns simulated, 0.5.2 `updateTodo` preserved them, consistent with the targeted-write design.

### Conditions for GO

1. The user answers Q1 and Q2, and confirms Q3/Q4 in a batch. Reflect the answers in R1–R3, the CLI section, and AC 1–3.
2. Fix F2 (guidance requirement and date-revision rule), F3 (L3 decision and AC 8), and F4 (name bound to meaning).
3. Fold in F5–F7 and F9–F11. These are one-sentence edits and need no further user input. F8 follows the user's Q6 answer.
4. Change the status to accepted-pending-implementation and send the delta to this session. A targeted delta review is enough; a full re-review is not needed unless the design changes.

### Closeout

Wrote this review only. The requirement draft and product code were not changed. The real ledger was not touched, and the routine project-status writeback was skipped at the user's explicit instruction. No commit, push, or publish.

## Round 1 — Implementation self-review (2026-11-04, Asia/Shanghai)

Reviewer and implementer: Codex. **cc skipped; Codex self-review**, explicitly requested by the user. No Claude/cc command or new reviewer session was used. Round 0 above is preserved verbatim as historical review; its request to resume cc does not apply to this user-directed implementation.

Disposition: **GO for the local implementation under the locked policies and documented limitations below.** This is self-review, not independent review, release approval, or production migration acceptance.

### Scope and decisions

- Baseline: package 0.5.2, repository HEAD `bd9170efd1f151b6af0bb807a426ec0621872596`; package version remains unchanged.
- User locked Q1–Q7: optional/null due with clearing; independent optional planned `startedAt`; explicit-zone, second-only timestamps normalized to UTC; plain multiline content up to 20,000 code units with blank-to-null; no Todo authorship; dashboard API/read compatibility only; portable v5 with version-gated legacy-title relaxation.
- Implemented migration 6; shared domain create/update/read validation; CLI flags, clear operations and help; both open-work projection paths; JSON/JSONL v5; HTTP compatibility and bounded larger Todo request bodies. Updated the requirement and both READMEs. No dashboard controls, skills, architecture, changelog, or release changes.
- Reviewed the final diff and creation call sites (`addStatus`, `createTodo`, `convertNextStep`, import), both `openWork` constructors, update callers (CLI, HTTP, snapshot closure), portable identity/provenance checks, and existing dashboard partial-patch behavior.

### Findings and disposition

| ID | Finding | Resolution / evidence |
| --- | --- | --- |
| S1 | The old 32 KiB HTTP body ceiling rejects valid 20,000-character CJK content and heavily JSON-escaped content. | Fixed: Todo mutations allow 160 KiB, enough for 20,000 content + 2,000 title code units at six escaped bytes each plus metadata. Other mutation routes retain 32 KiB; same-origin/localhost/content-type protections remain. Tests accept 20,000 CJK units and escaped control-character content, reject 20,001 units, and retain oversized-body 413. |
| S2 | Reusing lifecycle `parseTime` would accept fractional/minute-only values and normalize invalid dates. | Fixed with a dedicated second-only parser, local-component round-trip validation, explicit offset bounds, and four-digit canonical UTC output. Invalid leap days, Feb 30, 24:00, :60, missing zones/seconds, lowercase t/z, fractions, offset overflow, and UTC year overflow are rejected. |
| S3 | A renamed legacy-derived Todo would fail import if old title equality were retained globally; relaxing it globally would weaken old-format validation. | Fixed by passing the portable version into Todo validation. Only v5 relaxes title equality; valid source/project/index bounds, refs index-to-UID matching, and database uniqueness remain. v3/v4 reject new keys and mismatched legacy titles. v5 requires all three new keys and normalizes metadata before conflict comparison. |
| S4 | The generic CLI parser rejected `--content ""`, contrary to the locked blank-to-null contract. | Fixed narrowly for the content argument. Empty timestamp/title values still fail. Value/clear conflicts are rejected before updating. Leading-`--` values remain unsupported and are documented. |
| S5 | An initial migration test loaded `HEAD` source, which would stop being a pre-change fixture after a future commit. | Fixed before final review: checked-in `test/fixtures/schema-v5.sql` captures the actual 0.5.2 schema. The permanent regression test no longer depends on Git history, subprocess TypeScript loaders, or changing HEAD contents. |
| S6 | Fixed-UID domain text retry identity cannot preserve original wording after a rename without additional storage. | Retained as explicit L3 in the requirement and READMEs. Old wording fails closed; matching current wording may return the stored snapshot with `inserted: false`; neither changes stored data. The draft's stronger original-payload guarantee is not implemented. CLI writes do not pass fixed UIDs; strict imports and external-reference replays are unaffected. A regression test verifies the limitation and no mutations. |
| S7 | A date edit could be confused with replacing a commitment, and a scheduled field could be mistaken for a reminder. | Requirement/README guidance distinguishes correction of the same commitment from superseding a changed decision/occurrence. Dates create no action, reminder, status change, ordering change, or pin. Evidence recording is a separate `add --progress`, not an atomic edit pair. |

No unresolved code defect was found within the locked feature scope. S6 is a documented behavior limitation, not a claim of original-title retry fidelity. Round 0's proposed `startAt` rename, 8,000-unit cap, and CLI text deadline suffix were not adopted: the user's later instructions explicitly retained `startedAt`, 20,000 units, and R6 compatibility scope. No earlier review text was silently rewritten.

### Verification (completed before writing this round)

- `pnpm test`: **72 tests, 72 passed, 0 failed, 0 skipped** (63 pre-existing tests plus 9 new tests).
- `pnpm typecheck`: passed (`tsc --noEmit`).
- `pnpm lint`: passed (ESLint).
- `git diff --check`: passed.
- Existing assertions changed only where the contract changed: schema migration count 5 → 6, Todo export version 4 → 5, and the oversized HTTP body probe beyond the new Todo limit.
- Separate temporary compatibility probe executed the actual pre-change 0.5.2 importer from HEAD against an extended v5 bundle and confirmed `invalid ledger bundle`, with no imported data. The permanent migration fixture then replaced the Git-dependent test harness; no old code or test database remains installed.

Acceptance coverage:

| Requirement acceptance | Evidence |
| --- | --- |
| AC 1–2 | Default fields across direct/snapshot/conversion creation; independent/equal times; offset normalization and leap-day acceptance; invalid input matrix with no writes. |
| AC 3–5 | Omitted-field preservation, explicit clears, exact content preservation and limits, immutable/unknown fields, invalid merged schedules, transactional rollback, no-op and repeated-status timestamps, completed/open/cancelled lifecycle. |
| AC 6–8 | UID/source/pin/order preservation, live projections and title reuse, collisions, former title not an alias, unassigned work, closure/carry, separate supersession, legacy conversion retries and old-string divergence, L3 and external-reference replay. |
| AC 9–10 | Project locks and immutable fields; two file-backed connections with interleaved patches; actual schema-v5 fixture upgrade covering linked/pinned/completed/cancelled/unassigned rows; reopen preservation and fresh/upgraded schema equality. |
| AC 11 | v5 round trips and normalized same-UID replay, required metadata keys, old-format compatibility/rejection, atomic source/index/UID/conflict rejection, full domain export and project-scoped CLI JSON/JSONL with referenced unassigned Todo; separate old-reader rejection probe. |
| AC 12–13 | HTTP metadata create/read/patch and legacy dashboard status preservation; title-only entry-linked route remains unchanged; CLI aliases/help, clear conflicts and JSON projections; README policies; all required repository checks pass. |

### Remaining boundaries

- No new dashboard controls, authorship, scheduling/reminders, file/stdin content input, or title-history storage; these remain outside scope.
- Metadata is available in JSON; compact human checklist text and the current dashboard do not display new fields. Leading-`--` CLI values remain unsupported.
- Old builds can still open an upgraded database and produce incomplete exports. The READMEs require backup, new build, and restarting all dashboard/writer processes before persistent metadata writes. This task did not build/restart/deploy the running application.
- The real ledger was not opened or mutated. The two requirement Todos were not completed/cancelled. Routine project-status writeback was deliberately omitted under the user's explicit prohibition. No commit, push, or npm publish occurred.

## Round 2 — Final-policy correction self-review (2026-11-04, Asia/Shanghai)

Reviewer and implementer: Codex. **cc skipped; Codex self-review.** The user explicitly replaced the Round 1 policy with the final decisions below and required the Round 0 findings to land. Round 0 and Round 1 above are preserved byte-for-byte. **Round 1's GO is superseded by Round 2**; it describes the wrong naming/content policy and is not current acceptance evidence.

Disposition: **GO for the corrected local implementation.** No outstanding finding within the final requested scope. This is self-review, not an independent cc review or evidence of publication, deployment, or real-ledger migration.

### Final contract and findings resolved

| Round 0 finding | Resolution and verification |
| --- | --- |
| F1, F4 — policy and planned-start naming | `startAt` / `start_at` / `--start-at` / `--clear-start-at` are the only supported names across migration 6, domain types, CLI, JSON, imports, tests and active documentation. Start and due are independently optional, default null, and satisfy start <= due when both exist. No automatic status transitions or inferred deadlines. Tests reject the obsolete API/CLI names and assert that migration 6 contains only `start_at`. |
| F2 — action/watch and editing guidance | Added R8 and updated the repository skill, both READMEs, architecture, and the Unreleased changelog. New timed actions use `todo-add --due-at` followed by UID pinning; dates stay out of new titles. Same-commitment title/time corrections edit in place. Changed commitments use replacement creation and cancellation/pinning in the final snapshot, with staging recovery. Evidence requires a separate `add --progress`; editing creates no audit/snapshot and the pair is not atomic. Start/due never turn watches into actions or schedule reminders. The previous “until 21b3e139” workaround is marked resolved. Tests cover unchanged UID/pins on correction, and supersession preserving another action both when initially pinned and unpinned. |
| F3 — fixed-UID rename retry | L3 remains explicit in the requirement, READMEs and architecture beside L2; AC8 now states the actual three outcomes. After rename, old text conflicts; current text may return the stored entry with `inserted: false`; neither mutates data. External-reference replay remains unaffected. Original text identity is not promised without storage for original titles. Existing regression tests verify these limits. |
| F5 — content and transport limits | Domain content limit is **8,000 code units**, including import validation. Reverted the Round 1 request-body expansion: all HTTP mutation routes retain **32 KiB**. Tests accept 8,000 CJK content units through CLI/HTTP (HTTP also includes a 2,000-unit CJK title), reject 8,001, accept 4,000 astral characters / reject 4,001, and expect 413 for heavily escaped JSON exceeding the transport bound. That independent transport limit is documented. |
| F6 — content clearing | Restored the baseline CLI parser: `--content ""` is an error, and `--clear-content` explicitly clears. Whitespace-only CLI content and blank domain/HTTP content normalize to null. Clear/value conflicts and leading-`--` limitations remain documented and tested. |
| F7 — portable v5 | All three `startAt`, `dueAt`, `content` keys are required; null is valid. Tests remove each key in turn, reject obsolete/unknown keys, and confirm offset/blank normalization before same-UID comparison. Schedule ordering is validated on import. Only v5 relaxes legacy title equality; source/project/index/UID checks and uniqueness remain. v3/v4 reject new fields and mismatched legacy titles. |
| F8 — human-readable deadlines | `next`, `current` open-work lines, and `todos` append ` [due <UTC>]` only when due exists. Tests verify all three surfaces, removal after clearing, and byte-identical undated `next` output; pre-existing text-output tests also pass. Optional start suffix and dashboard controls are not added. |
| F9 — old-writer exports | Requirement, READMEs, skill, architecture and changelog state the backup/build/restart rule before persistent metadata writes. Old builds may open an upgraded database and silently omit metadata from exports; those exports are not complete backups. No old-writer guard or operational deployment is implied. |
| F10 — lossy title history | Requirement/guidance and architecture explain that refs-format history resolves live titles and does not retain original wording; legacy strings remain old while `openWork` resolves the renamed Todo. Record old wording in progress when needed. Existing rename/legacy round-trip tests cover the divergence. |
| F11 — parser boundaries | Retained the dedicated parser, separate from lifecycle `parseTime`. Requirement R1/Q3/AC2 explicitly cover invalid dates, minute-only input, fractions, zone-free input, 24:00, :60, lowercase t/z, offset bounds, and `-00:00` as UTC. The regression matrix passes. |

N1–N4 remain addressed: the entry-linked HTTP creation route is title-only; cross-family timestamp comparisons use parsed instants; exports containing Todos use v5 and migration-count assertions expect 6; implementation status and the review link reflect this round. No current document claims cc approval.

### Validation

Completed before this review was appended:

- `pnpm test`: **74 tests, 74 passed, 0 failed, 0 skipped**. This includes the 63 original tests and 11 feature regression tests.
- `pnpm typecheck`: passed (`tsc --noEmit`).
- `pnpm lint`: passed (ESLint).
- `git diff --check`: passed.
- Active source and documentation scan: no obsolete start identifiers, 20,000-unit policy, or 160 KiB policy remains. The obsolete names occur only in negative tests and the preserved historical reviews.
- Compared the complete pre-existing review file to the saved pre-edit bytes before appending: identical (SHA-256 `52b850ffb26c2dca36dc688259f9bbf947633d6557a7683b21d4a6ca400716ca`). Round 0/1 text was not rewritten.

One newly added rejection test initially expected an unknown-flag error for the obsolete clear flag; the baseline parser rejects it earlier as a missing-value error. The test now accepts either rejection path and verifies that neither obsolete flag is supported. No production parser exception was introduced for that test.

### Scope and remaining limits

The correction changes the unreleased migration 6 in place; validation databases from Round 1 were temporary and removed, and no real database was migrated. There is no compatibility alias or migration for the superseded experimental field name. The existing version-5 schema fixture still tests upgrading the actual 0.5.2 schema to the final migration 6.

No requested item remains unimplemented. Retained, documented limits are L3, the independent 32 KiB HTTP body ceiling, unsupported leading-`--` CLI values, and deferred dashboard controls/authorship/reminders. Start is available in JSON but has no optional text suffix; due is visible on the requested text surfaces.

No real-ledger access/mutation, requirement Todo cancellation/completion, routine ledger writeback, cc call, commit, push, npm publish, or deployment occurred.

## Round 3 — Independent implementation review (2026-11-04, Asia/Shanghai)

Reviewer: Antigravity (Claude Opus 5.5), conversation `2b2235bc-46b4-4765-8259-a1a5aa46c45b`. This is an independent cross-review of the Codex implementation (Rounds 1–2). The user asked this conversation directly for the review, so the Round 0 cc session `d61e48de-3a5e-4038-9d3f-9021529582d3` was not resumed. Resume this conversation for follow-up rounds on this task. Rounds 0–2 above are preserved unchanged.

Disposition: **GO for the local implementation.** No Blocker or Major findings. One Minor guidance gap (R3-F1) needs a user decision on wording. It does not block the code. This is not release, publish, or real-ledger migration approval.

### Review basis

- Repository HEAD `bd9170efd1f151b6af0bb807a426ec0621872596` (0.5.2), with an uncommitted working tree. `git diff` SHA-256 `81f55cf20621f32a5503267fee3bdf6de7ca4381c5426e11638e3af4308aa1af` (tracked files only).
- Untracked files reviewed: requirement `5e99ad6c…`, this review before the append `afb83e72…`, `test/todo-edit.test.ts` `07eb281c…`, and `test/fixtures/schema-v5.sql` `cc602fbd…` (SHA-256 prefixes).
- Read the full `src/db.ts` and `src/cli.ts` diffs. Also read the unchanged `updateTodo` ownership and status logic, `exportLedger`/`record()`, the CLI argument parser, and the `src/server.ts` Todo routes (unchanged; the entry-linked route still passes only `title`/`entryUid`). Checked the doc diffs in `skills/project-mgr/SKILL.md`, both READMEs, `docs/requirements/next-actions-vs-watch-items.md`, and `CHANGELOG.md`. Also read the test names and structure in `test/todo-edit.test.ts`.
- Requirement compared: the current `docs/requirements/todo-start-due-and-edit.md` (R1–R8, CLI, M1–M5, locked Q1–Q7, AC 1–13).

### Verification (this round)

- `pnpm test`: **74/74 passed**. Inside the sandbox, 5 HTTP tests failed with `connect EPERM 127.0.0.1` (loopback blocked). Re-run with loopback allowed: all 74 pass. This was an environment issue, not a code issue.
- `pnpm typecheck`, `pnpm lint`, and `git diff --check`: passed.
- Domain probe (`:memory:`, scratch script): the timestamp matrix behaves per R1/Q3:
  - Rejected: `2026-02-30`, non-leap `2026-02-29`, `T24:00:00`, `:60`, `+24:00`, `+0800`, fractional seconds, a leading space, the empty string, non-strings, `0000-01-01T00:00:00+01:00` (normalizes below year 0), and `9999-12-31T23:00:00-01:00` (normalizes above 9999).
  - Accepted: `2028-02-29`, `+23:59`, and `-00:00` → UTC.
  - Content: 8,000 units (also 4,000 astral characters) accepted; 8,001 / 4,001 astral rejected; blank → null; `" a \n"` preserved exactly.
  - Updates: merged-state `startAt > dueAt` rejected; equal instants given in different offsets are accepted. A title edit on a completed Todo keeps `completedAt`.
  - Pins: renaming and dating a pinned Todo updates `openWork` live with the same UID and pin.
  - Portability: v5 export and re-import works, and a repeat import is idempotent. Replaying a v4 bundle over an edited Todo is rejected with `conflicting todo uid`.
- CLI probe (throwaway `PMGR_DB_PATH`, deleted afterward):
  - `next` shows `[due 2026-11-04T15:00:00Z]` for input `23:00:00+08:00`.
  - Value + clear conflict exits 1 with the documented message; `--content ""` exits 1.
  - Rename + `--clear-due-at` preserves multiline content starting with `- `. Undated `next`/`current` lines carry no suffix.
- Insertion paths: all four `insertTodo` callers (`addStatus`, `createTodo`, `convertNextStep`, `importTodo`) supply the three fields. Both `openWork` constructors add them.
- Active-document scan: no obsolete start name, 20,000-unit policy, or 160 KiB policy in `src/`, `docs/` (excluding reviews), READMEs, the skill, or the changelog.
- Not checked: the real ledger was read only for project context (`pmgr projects --json`). It was not written or migrated. No build, restart, or old-reader rerun. The Round 1 result that 0.5.2 rejects v5 is taken from that round.

### Findings

#### R3-F1 / Minor — A deliberate reschedule of the same deliverable has no classification

Location: `skills/project-mgr/SKILL.md` (Timed actions and edits; Reconcile step 2), `README.md`/`README_CN.md` reconciliation bullets, `next-actions-vs-watch-items.md`, requirement R8.

The 0.5.2 guidance listed **"revised date"** as supersession. The new text replaces it with two categories:

- **Mistaken date alone** → edit in place.
- **Changed commitment, decision, or scope** → supersede.

The most common due edit is neither: the same deliverable moved to a new deadline on purpose (for example, the provider moved the quota window, or the user postponed the work). A reschedule follows a decision, so one agent can read it as supersession (new UID, cancel the old one, re-pin). Another can read it as an in-place correction. The two agents then produce different ledgers for the same event. This is the residual of Round 0 F2.1, which asked for a rule that decides the path for a changed date.

**Recommendation (user decision; text only, no code):** state explicitly that a new deadline for the **same deliverable/occurrence** is an in-place `todo-update --due-at`, optionally followed by `add --progress` with the reason. Supersede only when the deliverable, occurrence, or scope changes. Separate renewals stay independent Todos. Apply the same sentence to the skill, both READMEs, the next-actions document, and R8. If the user instead wants every deliberate reschedule audited through a snapshot, say "reschedule = supersede" explicitly. Either rule is acceptable as long as it is explicit.

#### R3-N1 / Nit — `openWork` JSON carries full content

`next --json` and `current --json` include `content` (up to 8,000 units) on every open Todo item, per R6. The user-level closeout reads `current` on every substantive turn, so long content inflates every agent read. No change is required. The skill already says project-mgr keeps short titles and links to detail. Optionally add "keep `--content` brief; long detail belongs in the repo `todo.md`".

#### R3-N2 / Nit — The text due suffix is UTC-only

Input `2026-11-04T23:00:00+08:00` shows as `[due 2026-11-04T15:00:00Z]`. This matches the locked Q3/Q6 contract (canonical UTC, no stored offset). Revisit it only if the user finds UTC text confusing in daily use. Local-time rendering would need a host-timezone choice that R1 deliberately avoids.

### Confirmed correct

- Migration 6 runs through the existing transactional `.immediate()` block, guarded by `schema_migrations`. Fresh and upgraded databases follow the same path. The checked-in v5 fixture test covers an upgrade from the actual 0.5.2 schema.
- The dedicated `todoTime` parser is separate from lifecycle `parseTime`. It round-trips the local components to reject overflow, bounds the offset explicitly, and limits canonical output to 20 characters. That makes the lexical `startAt <= dueAt` comparison safe, because both sides are fixed-width canonical UTC.
- `updateTodo` merges the patch onto the latest row inside `.immediate()` and validates the merged schedule before the write. Status, `completedAt`, and project-ownership semantics are unchanged; `record()` still rejects unknown keys. Null title/status are rejected; null content/start/due clear the field.
- Import:
  - Only v5 allows the three keys, and v5 requires all of them.
  - v3/v4 still reject the new keys and normalize missing metadata to null.
  - Legacy title equality is relaxed only for v5, with an explicit index-bounds check. Refs-format index-to-UID matching is unchanged.
  - Normalization happens before `isDeepStrictEqual`, so equivalent offsets do not conflict.
- `ledgerVersion` returns 5 whenever Todos are present, so 0.5.2 readers fail closed instead of dropping metadata.
- CLI: `nullableTodoFlag` maps clear flags to `null` and rejects value + clear pairs. The baseline parser still rejects empty values and values starting with `--`. Values beginning with a single `-` (Markdown lists) work. The due suffix appears on the `next`, `current`, and `todos` text surfaces only when `dueAt` is non-null.
- HTTP: `server.ts` is unchanged. The 32 KiB body limit is retained. `/api/todos` creation and patch pass through the shared validation. The entry-linked creation route stays title-only. Dashboard partial patches cannot clear metadata.
- Guidance: R8 is reflected consistently in the skill, both READMEs, architecture, the changelog, and the prior requirement ("until `21b3e139`" marked resolved). Timed actions use `todo-add --due-at` + `add --next-todo`. Start/due never turn watches into actions.

### Handoff notes (not defects)

- Commit scope must include the untracked `test/todo-edit.test.ts`, `test/fixtures/schema-v5.sql`, the requirement, and this review. Without the fixture, the migration test fails.
- The installed skill at `~/.agents/skills/project-mgr/` still carries the 0.5.2 guidance ("put the time in the title"), and the global `pmgr` is 0.5.2 without the new flags. That is consistent today. Update the installed skill only together with a released build that has these flags. Otherwise agents following the new guidance hit unknown-flag errors. Follow M4 (back up, build, restart all writers) before the first real metadata write.
- Ledger requirement Todos `21b3e139…` and `589f0f47…` remain open pending user acceptance. This review does not close them.

### Closeout

Appended this round only. No product code, requirement text, or earlier rounds changed. No commit, push, publish, build, deployment, or real-ledger migration. The temporary probe database was removed. Probe scripts are kept in this conversation's scratch directory.

## Round 4 — Author response and guidance self-review (2026-11-04, Asia/Shanghai)

Author/reviewer: Codex. Read Round 3 in full and applied the user's instruction to adopt its recommended rescheduling rule. No cc call or additional independent reviewer was requested or used. Rounds 0–3 are preserved unchanged.

Disposition: **GO for the guidance revision.** R3-F1 is resolved, R3-N1 is addressed, and R3-N2 is retained intentionally. This is a documentation-only response and self-review, not a release or real-ledger migration approval.

### Responses

- **R3-F1 / Minor — resolved.** A new deadline for the same deliverable/occurrence, including a deliberate reschedule, uses in-place `todo-update --due-at`, optionally followed by `add --progress` with the reason; supersede (cancel + new + pin) only when the deliverable, occurrence, or scope changes; separate renewals remain independent Todos. The exact same policy sentence appears in the repository skill, both READMEs, the next-actions requirement, R8 of the start/due/edit requirement, and architecture. Related reconciliation bullets, the CLI explanation, and the prior requirement's acceptance wording no longer classify a deadline-only decision as supersession. Creation/pinning recovery and the non-atomic optional evidence write remain documented.
- **R3-N1 / Nit — addressed.** The skill and both READMEs now advise keeping `--content` brief and placing long details in the repository `todo.md` or an equivalent owning record. No content limit, JSON projection, or code behavior changed.
- **R3-N2 / Nit — retained, no change.** UTC-only due suffixes match the locked canonical UTC contract. No host-timezone rendering, original-offset storage, or code change was introduced.

### Verification

- `pnpm test`: **74 tests, 74 passed, 0 failed, 0 skipped**.
- `pnpm typecheck`: passed (`tsc --noEmit`).
- `pnpm lint`: passed (ESLint).
- `git diff --check`: passed.
- Source/test file hashes match the pre-task snapshot: this round changed no implementation or test files.
- The review file's complete pre-existing bytes match its prefix after this append; Rounds 0–3 are unchanged.
- Confirmed the same rescheduling sentence on all six guidance surfaces and the brief-content advice on all three requested surfaces.

Files changed this round: `skills/project-mgr/SKILL.md`, `README.md`, `README_CN.md`, `docs/requirements/next-actions-vs-watch-items.md`, `docs/requirements/todo-start-due-and-edit.md`, `docs/architecture.md`, and this append-only review.

No outstanding item remains in this round's requested scope. No real-ledger access or writeback, requirement Todo closure, cc call, commit, push, publish, or deployment occurred. Existing uncommitted implementation work remains intact.

## Round 5 — Independent re-review of the Round 4 fixes (2026-11-04, Asia/Shanghai)

Reviewer: Antigravity (Claude Opus 5.5), same conversation as Round 3 (`2b2235bc-46b4-4765-8259-a1a5aa46c45b`). Scope: the Round 4 guidance revision, plus confirmation that the implementation is unchanged since Round 3.

Disposition: **GO.** R3-F1 is resolved and R3-N1 is addressed. Keeping R3-N2 as is is accepted. The code and tests are byte-identical to the Round 3 review object. One new Minor documentation finding (R5-F1) is recommended before commit. Round 3 missed it, and it does not affect behavior. This is not release, publish, or real-ledger migration approval.

### Review basis

- `src/db.ts` and `src/cli.ts` diffs: byte-identical to the Round 3 snapshots. `test/todo-edit.test.ts` (`07eb281c…`) and `test/fixtures/schema-v5.sql` (`cc602fbd…`) hashes: unchanged.
- Tracked `git diff` SHA-256 is now `2d962e6c54858b6db7d6b37d300585a2978f8ba06a13c21cf77f85d3cdffffab`. The delta from Round 3 is limited to documentation. Requirement SHA-256 is now `e017a218…`. The review file before this append is `c132e67a…`.
- Rounds 0–2 match the pre-Round-3 prefix hash `afb83e72…`. The Round 3 text matches what this reviewer appended. Round 4 adds only a blank separator line before its heading.

### Verification

- `pnpm test`: **74/74 passed**. Loopback had to be allowed for the HTTP cases, as in Round 3.
- `pnpm typecheck` (exit 0), `pnpm lint` (exit 0), `git diff --check`: passed.
- Ran `grep` across the skill, both READMEs, architecture, both requirements, the changelog, and `src/cli.ts`:
  - The rescheduling sentence appears verbatim on six surfaces: skill, `README.md`, `README_CN.md`, architecture, next-actions, and R8.
  - The reconcile bullets in the skill, `README.md`, and `README_CN.md` now say "deadline-only changes keep the UID".
  - The next-actions **Supersede** definition excludes "a new deadline alone", and its AC 3 now reads "changed deliverable/occurrence/scope".
  - R8 and the CLI section of the start/due/edit requirement are consistent.
  - The only remaining "revised date" text is in the next-actions Problem section. It describes the historical gap and is not guidance, so it is acceptable.
- The brief-content advice is present in the skill, `README.md`, and `README_CN.md`.

### Disposition of Round 3 findings

| ID | Status | Evidence |
| --- | --- | --- |
| R3-F1 | Resolved | One explicit rule on every guidance surface: a same-deliverable/occurrence deadline change (including a deliberate reschedule) is an in-place edit; supersession applies only when the deliverable, occurrence, or scope changes. No contradictory supersede wording remains in the reconcile bullets or definitions. |
| R3-N1 | Addressed | "Keep `--content` brief; long details belong in the repository `todo.md`…" is in all three agent-facing surfaces. No behavior change. |
| R3-N2 | Accepted as retained | UTC-only suffix matches the locked Q3/Q6 contract. |

### New findings

#### R5-F1 / Minor — The Chinese README's new Todo section is in English

Location: `README_CN.md`, the new `### Todo scheduling and editing` section (about 60 added lines, including the rescheduling sentence and the brief-content line).

The rest of `README_CN.md` is Chinese, and the reconcile bullet in the same diff is Chinese. This section was added in Round 2, and Round 4 extended it in English. Round 3 should have caught it. Chinese readers get the whole start/due/edit contract only in English. A stray line break (`Edits` / `have no audit history`) also shows the paragraph was edited mechanically.

**Recommendation:** translate this section into Chinese, keeping flags, field names, and examples verbatim. Documentation only; no code change. It does not block local acceptance, but fix it before commit or release.

#### R5-N1 / Nit — The changelog still uses the old supersede phrasing

`CHANGELOG.md` Unreleased still says "Correct the same commitment in place; supersede a changed commitment with cancel + new." R8 names the changelog as a guidance surface. The phrase does not contradict the rule, but it keeps the ambiguity R3-F1 removed. Suggested wording: "deadline-only changes, including deliberate reschedules, keep the UID; supersede only when the deliverable, occurrence, or scope changes."

### Closeout

Appended this round only. No product code, requirement, or earlier round changed. No commit, push, publish, build, deployment, or real-ledger migration. Requirement Todos `21b3e139…` and `589f0f47…` remain open pending user acceptance.

## Round 6 — Author response to Round 5 docs nits (2026-11-04, Asia/Shanghai)

Author/reviewer: Codex. Scope: Round 5 R5-F1 and R5-N1 only. Rounds 0–5 preserved unchanged. No product code or tests changed.

Disposition: **GO for the documentation fixes.** Local acceptance remains GO; this is not release, publish, or real-ledger migration approval.

### Responses

- **R5-F1 / Minor — resolved.** Translated `README_CN.md` section `### Todo 时间与编辑` into Chinese. Flags, field names, examples, and command snippets stay verbatim. Removed the stray English line break around “Edits have no audit history”.
- **R5-N1 / Nit — resolved.** `CHANGELOG.md` Unreleased now says: deadline-only changes, including deliberate reschedules, keep the UID; supersede only when the deliverable, occurrence, or scope changes.

### Verification

- Confirmed the Chinese heading and body replace the English section; no leftover English paragraph under that heading.
- Confirmed the superseded CHANGELOG phrasing is gone from Unreleased.
- `pnpm test`: **74/74 passed**.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- Docs-only change; source/test hashes unchanged from Round 5 review object.

No real-ledger access, Todo closure, cc call, commit, push, publish, or deployment.

