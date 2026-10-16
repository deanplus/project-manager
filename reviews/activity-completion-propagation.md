# Activity completion propagation — consolidated review

This is the single review record for requirements and implementation. Earlier references to files under `requiments/` describe the original review layout; the separate review and response documents were consolidated here at the user's request. Requirements remain in [the requirements document](../requiments/activity-completion-propagation.md). Execution evidence is stored separately, not as additional review documents.

Date: 2026-10-16
Reviewer: Claude Code (requirements review only; no code changed)
Reviewed: `requiments/activity-completion-propagation.md` (Draft for CC review)
Baseline: `399c4a4` (`src/db.ts`, `src/domain.ts`, `src/cli.ts`, `src/server.ts`,
`src/web/script.ts`, `src/web/locales/*`, `skills/project-mgr/SKILL.md`)

## Verdict

The problem statement and the core rules (explicit, append-only, no implicit
closing, latest snapshot stays authoritative) are sound and fit the existing
ledger model. The draft is **not yet ready for implementation**. Four issues
would block or force rework if left open:

1. Exported entries have no portable identity, so completion links cannot
   survive export/import (B1).
2. The label "已完成 / Completed" collides with the existing `completed` status
   label (B2).
3. Two acceptance criteria conflict: date-filtered history versus as-of
   semantics (B3).
4. The draft does not define what "the work of an entry" means. As a result,
   "fully completed" cannot be verified (B4).

The "Proposed decisions" section below answers each open question in
"Review decisions before implementation" with the smallest design that
satisfies the acceptance criteria.

## Blocking findings

### B1. Completion links have no portable target identity

- `toPortableStatusEntry` (`src/domain.ts`) drops `id` and `recordedAt`.
  `externalRef` is optional, and most entries do not have one. After `export`
  and `import`, an entry receives a new `id`, so a link stored as
  `(entry_id → entry_id)` cannot be reconstructed.
- `import` validates each record against a fixed key set and rejects unknown
  fields (`validateStatusEntry`). Any new export shape must therefore be
  versioned or kept separate, or older importers will reject it.
- **Requirement change:** state that completion links must round-trip through
  `export`/`import`, and choose the identity mechanism (see D1).

### B2. "已完成 / Completed" is already a status value

- `completed` is a member of the `statuses` enum. It is also the **default**
  when `--status` is omitted (`validateStatusEntry`; `SKILL.md`: "status
  defaults to completed if omitted"). In zh, `status_completed` renders as
  "已完成".
- If the new effective-state badge reuses this label, readers cannot tell an
  entry whose snapshot status was `completed` from an `active` entry that a
  follow-up later completed. That is the same ambiguity the draft is trying to
  remove.
- **Requirement change:** give effective completion its own visual and textual
  form. For example, use a distinct badge style with the text
  "已由后续完成 / Completed by follow-up", or always show it with the
  "Completed by [link]" evidence. Label acceptance must cover this case:
  zh `已完成` (original status) versus effective completion.

### B3. The date-filter and as-of criteria conflict

- Acceptance criterion: "Date filters … do not lose a completion relationship
  merely because the follow-up is outside the visible results." So
  `history --until T` should still show a completion made after T.
- Review decision: "completion added later must not silently erase the
  distinction between the state at that time and today's effective state."
  So a view as of T should not show that completion.
- Both requirements can hold, but only if the draft states that **history
  returns today's effective state together with evidence that carries the
  follow-up's `occurredAt`**, and that an explicit as-of query (`at`, or
  `history --as-of`) computes state only from completions whose follow-up
  `occurredAt <= T`. The UI can then show "Completed later by …"
  instead of hiding the completion or presenting it as true at T.

### B4. The unit of "work" is undefined

- An entry is a project snapshot, not a task. It has `summary`, `progress`,
  `blockers[]`, and `nextSteps[]`. Rule 6 ("partial progress does not mark the
  whole earlier activity Completed") assumes there is a defined "whole".
- **Requirement change:** define an entry's outstanding work as its
  `nextSteps` and `blockers`, as the author understood them. A completion link
  asserts that all of them are resolved. The system does not verify this, so
  responsibility stays with the author, consistent with rule 5. State that
  entries with no `nextSteps` or `blockers` can still be linked; the link then
  means "the work described in the summary is done."
- Also decide whether entries whose original status is `completed` or
  `archived` can be targets. Recommendation: allow them. Rejecting them adds
  validation without preventing a real error, and the B2 label fix keeps the
  states distinct.

## Non-blocking findings

- **N1. Effective state must be computed on the server.** The web UI loads
  `/api/history?limit=1000` and filters dates on the client
  (`src/web/script.ts`). The CLI pages with `--limit/--offset`. If effective
  state were derived from loaded rows, completions whose follow-up falls
  outside the page would be lost. The draft's criterion is correct. Add that
  `history`, `current`, and `/api/history` must attach completion evidence per
  entry through a server-side join.
- **N2. Rule 8 introduces new UI labels.** The web UI has no per-entry
  "Superseded" or "Current status" marker today; only the project card shows
  "最新动态 / Latest Update". Specify precedence for each entry:
  effective-completed > current status (latest snapshot) > superseded > none.
  Also confirm that "Superseded" is purely derived (not stored), so existing
  records need no rewrite.
- **N3. Multiple completers.** "Duplicate completion requests" covers the same
  `(target, follow-up)` pair. It does not say what happens when a _different_
  follow-up tries to complete an already completed target. See D4.
- **N4. Mixed identifiers.** The CLI currently has no way to refer to an entry.
  `history --json` exposes `id`, and agents will use it. The skill update
  (last review decision) must document how to find outstanding entries, for
  example a `history --outstanding` filter or the effective-state field in
  `history --json`.
- **N5. Spelling.** The directory name `requiments` is intentional per the
  draft. Note that `docs/reviews/` is the existing convention for review
  records if these documents move later.

## Proposed decisions (answers to the open questions)

### D1. Minimal schema (append-only)

```sql
-- migration 3
ALTER TABLE status_entries ADD COLUMN uid TEXT;          -- portable identity
CREATE UNIQUE INDEX idx_status_entries_uid ON status_entries(uid);
CREATE TABLE entry_completions (
  id INTEGER PRIMARY KEY,
  target_entry_id INTEGER NOT NULL REFERENCES status_entries(id),
  completed_by_entry_id INTEGER NOT NULL REFERENCES status_entries(id),
  action TEXT NOT NULL CHECK (action IN ('complete', 'revoke')),
  reason TEXT,
  recorded_at TEXT NOT NULL,
  source TEXT NOT NULL
);
```

- `uid`: a UUID assigned at insert. Existing rows are backfilled by the
  migration. Backfill only adds an identifier; snapshot content is unchanged,
  so it does not violate the "no bulk rewriting" criterion. The draft should
  say this explicitly. Export includes `uid`. Import keeps a supplied `uid`
  and treats it as an idempotency key, like `externalRef`.
- The effective link for a `(target, follow-up)` pair is its latest event by
  `id`. A target is effectively Completed when exactly one pair currently
  resolves to `complete` (see D4).

### D2. CLI/API input

- `pmgr add … --completes <uid-or-id>` (repeatable). It inserts the snapshot
  and its links in one transaction. Any invalid reference rolls back the whole
  command, which meets the "no partial writes" criterion.
- `pmgr complete --entry <target> --by <follow-up> [--reason …]` links an
  existing follow-up after the fact. This command is also the path for
  historical reconciliation when that work is scoped later.
- `pmgr revoke-completion --entry <target> --by <follow-up> --reason …`
  appends a `revoke` event (see D3).
- The HTTP API stays read-only (`server.ts` accepts only GET/HEAD). Writes go
  through the CLI only, as they do today.

### D3. Correcting wrong links

Correction appends a `revoke` event, which requires a reason. Nothing is ever
deleted. History and export include revoked links, so the audit trail is
complete. The UI shows only the effective link.

### D4. Validation rules

- **Same project only.** Cross-project links would let one project's update
  close another project's work. Grouped views and rule 7 are per project.
  Reject cross-project links with an explicit error.
- **"Earlier" is defined by** the same ordering `current()` uses:
  `(occurred_at, id)` of the target must be strictly less than that of the
  follow-up. A backdated follow-up that sorts before its target is rejected.
  As a consequence, the latest snapshot can never be a target, so rule 7
  holds by construction.
- **Self-reference:** rejected.
- **Same pair already complete:** no-op that returns the existing link
  (idempotent, consistent with `externalRef` behavior).
- **Target already completed by a different follow-up:** reject, and tell the
  author to revoke first. This keeps one visible "Completed by" link and
  avoids defining merge semantics.
- Unknown `uid`/`id`: reject. All validation runs before any write.

### D5. Exposure in read APIs and export

- Add the following to each entry returned by `history`, `current`, `at`, and
  `/api/history`, leaving existing fields unchanged:
  `effectiveState: "open" | "completed"` and
  `completedBy?: { uid, id, occurredAt, summary }`.
  The original `status` field stays as is.
- Export: add `uid` to each entry. Emit completion events as a separate,
  versioned section, for example
  `{ "version": 2, "entries": [...], "completions": [...] }` for `json`, or
  typed lines for `jsonl`. Keep the current version-1 array format importable.

### D6. As-of semantics

As stated in B3: as-of views consider only completion events whose follow-up
`occurredAt <= T`. Revocations apply by `recorded_at`. Full bitemporal
queries (state _as recorded_ at T) are out of scope for this change; state
that explicitly in the draft.

### D7. Agent instructions (`SKILL.md`)

Add the following workflow: before `add`, run `history --project X --json` and
inspect entries with `effectiveState: "open"`. Pass `--completes` only for
entries whose `nextSteps` and `blockers` are all resolved by this update. For
partial progress, record it in `progress`/`nextSteps` and do not link.
Commits or deployments alone are never grounds for linking (rule 5).

## Suggested edits to the draft

1. Rule 2 / acceptance: use a label distinct from status `completed` (B2).
2. Add a definition of "outstanding work of an entry" (B4).
3. Replace the date-filter criterion with "history shows today's effective
   state plus the completion's `occurredAt`; as-of queries exclude later
   completions" (B3).
4. Add the criterion: "completion links round-trip through export/import"
   (B1).
5. Add the criterion: "a second completion of an already completed target is
   rejected until the existing link is revoked" (D4).
6. Move the decisions in D1–D7 into the draft, or record any alternative
   chosen, before implementation starts.

## Re-review after Codex revision

Date: 2026-10-16
Reviewed: revised `activity-completion-propagation.md` ("Revised after CC
review") and `activity-completion-propagation-review-response.md`. No code was
changed.

### Verdict

All four blockers are resolved. Codex's corrections to D1, D4, D5, D6, and D7
are accepted. The requirements are ready for implementation once R1 below is
decided. R2–R4 are documentation cleanups and can be fixed together with R1.

### Disposition of the original findings

| Finding              | Status                   | Evidence in the revised draft                                                                                                                                                                              |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 portable identity | Resolved                 | Portable entry and event identities, round-trip, idempotent re-import, explicit conflict failure, legacy import kept.                                                                                      |
| B2 label collision   | Resolved (alternative)   | "已完成 / Completed" is kept as the primary badge, as the user requested. Propagated completion always shows "由后续动态完成 / Completed by follow-up" with a link, so the two cases stay distinguishable. |
| B3 filter vs as-of   | Resolved                 | Filters select visible snapshots, and annotations show today's effective result. The as-of cutoff is defined separately.                                                                                   |
| B4 unit of work      | Resolved                 | Covers next steps, blockers, and the summary/progress commitment. The author makes the assertion.                                                                                                          |
| N1–N5                | Resolved or acknowledged | See the response document.                                                                                                                                                                                 |

### Codex corrections — accepted

- **D5:** A missing link must not turn an original `completed` or `archived`
  snapshot into "open". My `effectiveState: "open"` projection was wrong for
  these cases.
- **D6:** The recording-time cutoff applies to both completion and revocation,
  with deterministic replay. This is stricter and more precise than my
  occurredAt-only rule.
- **D1/D5:** Completion events need their own portable identity and order.
  Without them, repeated imports would duplicate audit events.
- **D4:** The local numeric `id` cannot serve as the portable tie-breaker.
- **D7:** A commit or deployment can complete an entry whose only outstanding
  work was that commit or deployment. My "never" was too broad.

### Remaining findings

**R1. The as-of cutoff has no query surface (decide before implementation).**
The only as-of command today is `at` (`src/db.ts:354`). It returns the single
latest snapshot with `occurred_at <= T`, ordered by `(occurred_at, id)`.
Any completion source must sort after its target and satisfy
`source.occurredAt <= T`. A snapshot that qualifies would itself be the result
of `at`, so `at` can **never** return a target with a completion annotation.
Implemented as specified, the as-of cutoff and three of its acceptance
criteria would be unreachable. The draft should do one of the following:

- name a new query, for example `history --as-of T` (snapshots with
  `occurredAt <= T`, annotated using the cutoff); or
- defer the as-of cutoff and its three acceptance criteria. This change
  requires no as-of activity view.

Recommendation: defer. It is the smaller scope, and nothing in the problem
statement asks for an as-of activity list.

**R2. The "Implementation details to finalize" section is stale.**
It still lists project scope, "earlier" validation, correction, and exposure
as open, although "Decisions after review" now decides them. Its last bullet
says "query outstanding entries". That contradicts the new rule that a missing
link does not mean outstanding work. Fix: keep only schema/command naming,
serialization format, and the as-of decision from R1. Reword the agent bullet
to "inspect original state and completion evidence".

**R3. Rule 8 conflicts with the independence decision.** Rule 8 limits
"Superseded" to entries _without_ a completion relationship. The new decision
says completion and recency are independent labels, and neither hides the
other. Fix: change rule 8 so that a completed, non-latest entry may also show
"Superseded".

**R4. The equal-timestamp tie-breaker is unspecified.** The draft requires
order to be preserved "explicitly or by a documented stable import contract"
but does not choose either option. Smallest option: require
`target.occurredAt < source.occurredAt` strictly for links. Equal-time
snapshots then never need a portable tie-breaker for completion validation.
The existing `current()` and `at()` tie-break on local `id` stays a
pre-existing, separate concern.

### Noted, no change needed

Because the cutoff uses recording time, a snapshot backdated today appears in
`at(T)`, which selects by occurrence time. Completion links created in the
same command, however, are excluded from views as of T. The acceptance
criteria ("A backdated source linked today does not appear…") intend this
asymmetry. If R1 keeps the as-of cutoff, document it in the CLI help.

### Resolution (2026-10-16)

- **R1:** The user chose to **defer** the as-of completion cutoff. The draft now
  states that `at` keeps its current behavior and returns no completion
  evidence. The two as-of acceptance criteria were removed and moved to a
  "Deferred" section. (Correction: the earlier text said "three" criteria;
  there were two.) Event recording times are still stored, so
  `history --as-of` can be added later without schema changes.
- **R2:** "Implementation details to finalize" now lists only schema/command
  naming, the export format, and the agent-instruction update. The agent
  bullet says "inspect original state and completion evidence".
- **R3:** Rule 8 now allows a completed, non-latest entry to show
  "Superseded" as well.
- **R4:** Links require `target.occurredAt < follow-up.occurredAt` strictly.
  Links between equal-time snapshots are rejected.

The draft status is now "ready for implementation".

---

## Earlier Codex response (historical; superseded where noted above)

# Response to CC requirements review

Date: 2026-10-16
Status: Requirements revised; no implementation changes

The original CC review is preserved in activity-completion-propagation-review.md.

## Disposition

- B1 accepted: portable entry and event identities, round-trip preservation, legacy input support, and conflict detection are now required.
- B2 accepted with a label adjustment: preserve the user's primary “Completed” label and always attach follow-up evidence for propagated completion. A new label must not replace the requested completion state.
- B3 clarified: filtering visible snapshots and evaluating an explicit historical cutoff are distinct operations, rather than inherently conflicting requirements.
- B4 accepted: completion covers outstanding commitments in the entry; authors explicitly assert closure. Empty next-step/blocker lists do not prevent linking.
- N1 accepted: resolve evidence in the shared read layer, never from the visible page alone.
- N2 adjusted: completion and snapshot recency are independent dimensions. Neither marker hides the other.
- N3 accepted: one active source per target, with explicit revocation before replacement.
- N4 accepted with correction: missing completion evidence does not make an original completed snapshot open. Agent instructions must not use that inference.
- N5 acknowledged: retain the requested directory spelling.

## Corrections to the proposed implementation decisions

1. D5's unconditional open/completed projection is underspecified for original completed and archived snapshots. Preserve original status separately and do not invent outstanding work from the absence of a completion link.
2. D6 mixes source occurrence time with revocation recording time but leaves late linking ambiguous. The revised requirement applies a recording-time cutoff to both completion and revocation, plus a source occurrence-time cutoff, with deterministic event replay.
3. D1/D5 need portable event identity and ordering as well as entry identity. Otherwise repeated imports can duplicate audit events or change the effective result.
4. D4 uses local numeric IDs to order equal-time snapshots. Those IDs can change on import, so ordering must be preserved explicitly or by a documented stable import contract.
5. D7's statement that commits or deployments are never grounds for linking is too broad. They can close an entry whose outstanding work is exactly commit/deployment; they cannot close remaining acceptance work by implication.

Exact schema, command names, and serialization format remain implementation details. The requirements now define the behavior those choices must preserve.

---

## Implementation review — 2026-10-16

- Baseline: `399c4a49c72ed71c5f8db2f8611923920e52efe4`; unstaged implementation and new tests/requirements. No commit, push, deployment, or historical bulk reconciliation.
- Reviewer: Claude Code 2.1.292; actual model `claude-sonnet-5-5`; effort configured `high` (reviewer did not independently verify effort).
- Review session: `04386f64-34a3-42ee-a5c8-9f4e158786ef`.
- Final result: static review complete, no remaining actionable defects. Reviewer did not execute validation; local tests and browser checks were performed by Codex. Round 1/2 shell access was denied inside the reviewer session; round 3 intentionally exposed only Read/Grep/Glob. These are execution limitations, not missing user authorization.
- Caller verification: 16 tests pass, all four configured coverage thresholds are 100%; typecheck, lint, build, touched-file formatting and diff checks pass. Final source hashes were recomputed and matched the reviewed manifest.
- Browser verification uses synthetic isolated data. Grouped/flat cards, completion-source navigation, language switching, original detail expansion, date filtering, and back-button computed visibility were exercised. Final round uses DOM event dispatch after a native pointer timeout; native pointer acceptance remains limited. Coverage of a generated script string alone is not browser branch coverage.

### Finding dispositions

- Round 1 F1/F2: accepted documented format/identity limitations. Version-2 export is a breaking shape change; independently migrated legacy databases may conflict on external references and should restore into a fresh database. No silent identity adoption.
- Round 1 F3: fixed 400 responses for malformed detail-route encoding, including the related project route.
- Round 1 F4: raw transactional export avoids discarded annotations; per-entry history lookups retained pending performance evidence.
- Round 1 F5/F6: updated architecture/changelog and added focused regression cases.
- Round 1 F7: new migration rejects obsolete writers that omit UUIDs. Only isolated disposable test databases used early versions of migration 3; no shared ledger was opened during implementation testing.
- Round 1 F8 and round 2 F1: explicit return control and focus clearing; fixed CSS overriding the hidden attribute and verified real computed styles.
- Round 2 F2: corrected the two remaining documentation statements.
- Round 2 F3: informational only for unreleased intermediate development databases.

### Evidence

Final source: [diff](evidence/activity-completion/round3.diff), [new files](evidence/activity-completion/round3-new-files.txt), [hashes](evidence/activity-completion/round3-hashes.txt).

Validation: [tests and coverage](evidence/activity-completion/validation-round3.txt), [typecheck](evidence/activity-completion/typecheck.txt), [lint](evidence/activity-completion/lint.txt), [build](evidence/activity-completion/build.txt), [format](evidence/activity-completion/format.txt), [browser checks](evidence/activity-completion/browser-round3.txt), [browser screenshot](evidence/activity-completion/browser-final.png).

### Round 1 — original reviewer report

[Prompt](evidence/activity-completion/round1-prompt.txt) · [Raw event stream](evidence/activity-completion/round1-events.jsonl.gz) · [Exit code](evidence/activity-completion/round1-exit.txt)

# Independent review: activity completion propagation

## Header

- **Reviewer model / effort:** Claude Sonnet 5.5 (`claude-sonnet-5-5`); effort unknown.
- **Status:** limited. I found no blocking defects, but nothing was executed (see Validation limits).
- **Missing coverage:** the Validation limits and finding 6 list the untested acceptance items.

## Scope reviewed

I read these as the working-tree diff against HEAD `399c4a4`:

- `requiments/activity-completion-propagation.md`
- `src/db.ts`, `src/domain.ts`, `src/cli.ts`, `src/server.ts`
- `src/web/script.ts`, `src/web/locales/{en,zh}.ts`, `src/web/styles.ts`, `src/web/ui.ts`
- `README.md`, `skills/project-mgr/SKILL.md`
- `test/completion.test.ts`, `test/core.test.ts`, `test/server.test.ts`

I also read `docs/architecture.md` and checked that `CHANGELOG.md` is unmodified. I did not read the historical review conclusions, `.env` files, `data/`, or the other generated evidence.

## Validation limits

- I ran no tests, build, lint or coverage. The review tools were restricted to reading and search. The 100% coverage gate is therefore unverified.
- I did not run the SHA-256 check against `round1-hashes.txt`. My last Bash call was denied. I reviewed the live working tree rather than `round1.diff`, so the hashes are unconfirmed.
- Findings 1–3 are static reasoning only. None was reproduced.
- `better-sqlite3` nested-transaction behaviour is from my knowledge of the library, not from running it. A nested `.immediate()` transaction becomes a savepoint. The code depends on that, and the tests would confirm it.

## Findings

Nothing blocking and no High findings. Items 1–6 are Low or Medium-Low and none is a regression of a stated acceptance criterion, except the coverage gap in 6.

1. **Medium-Low: export shape changed incompatibly, and `json` and `jsonl` now produce the same output.**
   - **Evidence:** `src/cli.ts:371-377` emits a single compact `{version:2,entries,completions}` bundle for both formats. The earlier code emitted an array for `json` and one entry per line for `jsonl`. `test/core.test.ts` was changed to expect `{"version":2,"entries":[],"completions":[]}\n`.
   - **Trigger:** any consumer that reads `pmgr export` as an array, or reads JSONL line by line, for example `jq '.[]'`.
   - **Impact:** downstream tooling breaks. The README and SKILL.md disclose the change, and the requirements only mandate that legacy imports keep working. A "JSONL" file that is one big line also loses its streaming and diff-friendly property.
   - **Suggested fix:**
     - Make `jsonl` emit one record per line, with a type tag (`entry` or `completion`), or an entries-only line format plus a separate completions record.
     - Alternatively, keep a legacy array export behind a flag.
     - At minimum, add a CHANGELOG entry that calls this out as breaking.

2. **Medium-Low: migration backfill UUIDs are random per database, so cross-database bundle import can fail on legacy `externalRef` entries.**
   - **Evidence:** `src/db.ts:105-111` backfills with `randomUUID()`. `src/db.ts:326` throws `externalRef conflicts with portable uid` when a bundle entry has a uid and the same `externalRef` already exists under a different uid.
   - **Trigger (inferred, not run):** two databases (A, B) both imported the same legacy file with `externalRef` values and each migrated separately. Exporting A and importing into B then fails on the first such entry.
   - **Impact:** the failure is explicit and atomic, so nothing is corrupted. It does block the portability goal for pre-migration data.
   - **Suggested fix:**
     - Backfill deterministically for entries that have an `externalRef`, for example UUIDv5 over `project` and `externalRef`.
     - Or allow adopting the incoming uid when the existing row has identical content and was migration-assigned. That needs a marker column.
     - Or document the limitation.

3. **Low: malformed percent-encoding on the new route returns 500 instead of 4xx.**
   - **Evidence:** `src/server.ts:115-117` calls `decodeURIComponent` unguarded. A request such as `/api/entries/%E0%A4%A` throws `URIError`, which the `startServer` catch turns into a 500. The existing `/api/projects/` route at `src/server.ts:102` has the same pattern, so the new route repeats a pre-existing weakness.
   - **Suggested fix:** wrap the decode in a try/catch and return 404 or 400.

4. **Low: per-entry query amplification in `annotateEntry`.**
   - **Evidence:** `src/db.ts:487-514` runs about four queries per entry: latest completion, follow-up lookup, newest-in-project, plus the base row. The web UI requests `/api/history?limit=1000` (`src/web/script.ts`). `exportLedger` (`src/db.ts:619`) goes through `history()`, so it annotates every entry and then discards the annotations.
   - **Impact:** latency grows with ledger size. This is tolerable for a local SQLite database.
   - **Suggested fix:** batch the lookups, and have export read raw rows.

5. **Low: documentation not updated.**
   - **Evidence:**
     - `docs/architecture.md:33` lists the commands and omits `complete` and `revoke-completion`.
     - `docs/architecture.md:39` and `:58` describe only migrations 1 and 2.
     - `docs/architecture.md:85-87` says export strips `recordedAt` and the id, and describes the array shape.
     - `CHANGELOG.md` has no entry, although the project instructions mention changelog entries.
   - **Suggested fix:** update the architecture sections on migrations, the schema, and import/export, and add a CHANGELOG entry.

6. **Low: test and acceptance coverage gaps.**
   - **Deep link:** the `?entry=` path in `fetchData` is untested. This covers the call to `/api/entries/<uid>`, `focusedEntry` loading, and the `entryLoadError` path (`src/web/script.ts` around lines 52-65). The server test only calls `render()` after setting `focusedEntry` directly.
   - **Equal-time export/import:** the criterion "survive export/import, including equal-time snapshots" is not exercised. The only equal-time entry is in the first test and is never exported or imported. The bundle round-trip test uses distinct times. I expect the implementation to be fine, because link validation uses only `occurredAt` strings (`src/db.ts:516-533`), but it is unproven.
   - **Migration:** it is tested with one row only. There is no test with several legacy rows, and none that new inserts are non-NULL after migration.
   - **Server:** there is no test for malformed percent-encoding or a numeric-id request to `/api/entries/`.
   - **`add` retry:** there is no test for an `add` retried with an existing `externalRef` plus `--completes`. In that case `addValidatedStatus` returns the existing row and `changeCompletion` runs against it. It is idempotent for the same links. A retry with different links attaches them to the earlier entry silently. This is a design question I could not settle.

7. **Low (speculative): `uid` is nullable and never re-checked.**
   - **Evidence:** `src/db.ts:91-92` adds `uid TEXT` with no `NOT NULL`.
   - **Trigger:** an older binary writes rows after migration. Those rows get a NULL uid, which breaks `annotateEntry` and export (`validateUid`).
   - **Impact:** this assumes mixed-version use, which I could not verify.
   - **Suggested fix:** re-backfill NULL uids on open, or add a CHECK constraint.

8. **Low (UX): the focused-entry view has no explicit exit.**
   - **Evidence:** `src/web/script.ts`. `focusedEntry` hides the list until a filter, search or date change clears it. The catch block also shows `entryLoadError` for any `fetchData` failure, including a failed history load. The Refresh button does not clear `focusedEntry`.
   - **Suggested fix:** add a "back to list" control and clear `focusedEntry` on refresh.

## Verified as correct (static reading)

- **Append-only storage:** completion and revocation are events in `completion_events`. Snapshots are never rewritten.
- **Effective state:** `annotateEntry` derives it from the latest event per target. An original `completed` status without a link stays `completed`. Revocation restores the underlying state. Original `status` is kept separate from `effectiveStatus`.
- **Latest-snapshot selection:** the `current()` SQL is unchanged. `isCurrent` uses the full project history and the same ordering, so it does not depend on the filtered page. A strictly-later follow-up means a completed entry can never be the current one.
- **`at`:** unchanged and not annotated, as the requirements specify.
- **Link validation:** both ends must exist, share a project, and satisfy `target.occurredAt < by.occurredAt` (`src/db.ts:516-533`). Self-links and equal times are rejected. Occurrence times are normalised to ISO strings by `parseTime`, so the string comparison is sound.
- **Event rules:** one active source per target. Repeating the same link is a no-op. A different source needs a revoke first. Revoke requires a reason and a matching active source.
- **Atomicity:**
  - **`addStatus`:** it runs the insert and all links in one `.immediate()` transaction (`src/db.ts` around line 277). `changeCompletion` nests as a savepoint. The "missing" case in `test/completion.test.ts` checks that no entry is left behind.
  - **CLI `add`:** it now wraps metadata, the entry and the links in one transaction (`src/cli.ts:237-260`). The `--description` rollback test covers this.
  - **Import:** it validates and writes in one outer transaction, so a failure rolls back every line.
- **Import identity and order:**
  - **Conflict detection:** a deep-equality check on the portable fields and `recordedAt` catches uid conflicts. Completion uids are compared the same way.
  - **Event order:** each event's `previousUid` is checked against the target's current chain.
  - **Repeat imports:** they are no-ops. Unknown bundle fields are rejected.
  - **Legacy support:** entry arrays and JSONL entries are still accepted.
- **API and UI:**
  - **Annotations are server-side:** `history`, `current` and `/api/entries/` annotate independently of the loaded page or date filter.
  - **Shared renderer:** grouped and flat views both use `renderTimelineItem`.
  - **Escaping:** `completedBy.uid` goes through `encodeURIComponent`, and other user text through `escapeHtml`.
  - **Labels:** zh and en key sets are in parity for the new labels. Completed and Superseded/Current render independently.
  - **Write surface:** the HTTP API is still read-only.

## Unrelated pre-existing issues (not caused by this change)

- Legacy imports without `externalRef` or `uid` are not idempotent. They duplicate on re-import.
- The UI fetches `limit=1000` and filters dates client-side. The server-side annotation and the `/api/entries/` fallback mitigate the effect on completion links.
- `decodeURIComponent` is unguarded on `/api/projects/` (`src/server.ts:102`).
- Equal-`occurredAt` current-snapshot ties depend on destination-local ids. The requirements already note that completion links avoid this by rejecting equal-time links.

## Unverifiable concerns

- Whether nested `.immediate()` transactions behave as savepoints under the pinned `better-sqlite3` version. Likely, per its documented behaviour.
- Whether the 100% coverage threshold still passes, given the new branches in `src/db.ts` and `src/cli.ts`. The web script is a string, so it is not coverage-measured.
- The mixed-version scenario in finding 7.

### Round 2 — original reviewer report

[Prompt](evidence/activity-completion/round2-prompt.txt) · [Raw event stream](evidence/activity-completion/round2-events.jsonl.gz) · [Exit code](evidence/activity-completion/round2-exit.txt)

# Independent review, round 2

## Header

- **Reviewer model / effort:** Claude Sonnet 5.5 (`claude-sonnet-5-5`); effort unknown.
- **Status:** limited.
  - I found one new defect, a real but small UI regression.
  - I could not run anything. Bash was denied again in this round, so I ran no tests, coverage, typecheck, lint or hash check.

## Scope and evidence used

- **Files read:** the current working-tree files `src/db.ts`, `src/web/styles.ts` and `test/completion.test.ts`, plus `reviews/evidence/activity-completion/round2.diff`. The diff covers `CHANGELOG.md`, `README.md`, `docs/architecture.md`, `SKILL.md`, `src/cli.ts`, `src/server.ts`, `src/web/*` and the tests. I also read `validation-round2.txt`.
- **Caller's validation output:** `validation-round2.txt` shows 16 of 16 tests passing and 100% on all four coverage thresholds for every `src` file. I read this output but did not reproduce it. It is the caller's evidence, not mine.
- **Hashes:** `round2-hashes.txt` was read but not verified. I reviewed the live files and `round2.diff` instead.
- **Not examined:** the browser screenshot (`browser.png`) and the typecheck, lint and build results. Neither is in the files I read.

## Verification of round-1 findings

| #   | Disposition                       | My judgment                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Bundle format retained, disclosed | Accepted. `CHANGELOG.md` "Changed" and the README/architecture/SKILL text state the breaking change and the one-bundle-per-line JSONL.                                                                                                                                                                                        |
| 2   | Limitation documented             | Accepted. README and `docs/architecture.md` ("Activity completion") state the `externalRef` conflict and "restore into a fresh database". Failure stays explicit and atomic.                                                                                                                                                  |
| 3   | Fixed                             | Verified in the diff. `src/server.ts` decodes both routes inside one try/catch and returns 400 `Invalid URL encoding` before routing. `test/server.test.ts` asserts 400 for `/api/entries/%E0%A4%A` and `/api/projects/%E0%A4%A`.                                                                                             |
| 4   | Export raw rows; annotation kept  | Accepted. `exportLedger` (`src/db.ts:622-643`) reads raw rows ordered `occurred_at, id` inside one transaction. The order matches the old reversed history, so equal-time ordering is preserved. History annotation is still four queries per entry. There is no latency evidence, so deferring is reasonable.                |
| 5   | Docs fixed                        | Mostly. See finding 2 for two small leftovers.                                                                                                                                                                                                                                                                                |
| 6   | Tests expanded                    | Reasonable on reading. The new tests include real `fetchData` success and failure, an equal-time round-trip (`current` is `equalLast`, and `equalFirst` to `equalLast` is rejected as not strictly earlier), a multi-row migration, a numeric route, and an `externalRef` retry. I read these tests but did not execute them. |
| 7   | Trigger added                     | Verified. `src/db.ts:113-115` installs a `BEFORE INSERT` trigger that aborts on `NEW.uid IS NULL`. The migration test drops the trigger before the simulated downgrade and then asserts an old-style insert fails with `upgrade the writer`. See the note in finding 3.                                                       |
| 8   | Back control added                | Partly fixed. The logic and the focus-clearing paths are correct, but the button is not actually hidden in a browser (finding 1).                                                                                                                                                                                             |

The retry semantics for an existing `externalRef` are documented in the README and covered by a test. The test asserts the same uid, `inserted === false`, and an unchanged event count on repeat. Different links being treated as new closure assertions is a deliberate and documented choice.

## Findings

1. **Medium-Low (new regression): the "Back to activities" button is always visible in a real browser.**
   - **Trigger:** any normal page load.
   - **Evidence:**
     - `src/web/ui.ts:84` renders `<button id="btnBackToActivities" class="btn" … hidden>`.
     - `src/web/script.ts:282` sets `.hidden = !focusedEntry`.
     - `src/web/styles.ts:211-223` defines `.btn { display: inline-flex; … }`.
     - A grep of `src/web` finds no `[hidden]` rule, so author CSS overrides the browser's default `[hidden] { display: none }` and the attribute has no visible effect.
     - The server tests use a mock element, so they only check the `.hidden` property and would not catch this.
   - **Impact:**
     - The button shows on the Activity tab even with no focused entry.
     - Clicking it clears the project filter, search and date. It is confusing, not data-affecting.
     - The caller's browser run predates the button and the caller plans to verify it separately. I expect that check to fail.
   - **Suggested fix:** add `[hidden] { display: none !important; }` (or `.btn[hidden]`) to `styles.ts`, or toggle `style.display` in `render()`. Re-check in the real browser.

2. **Low: two stale doc statements.**
   - **Evidence:**
     - `docs/architecture.md` still says "Exports … reverse descending history results into oldest-to-newest order", but export now reads ascending rows directly.
     - `SKILL.md` still says "Import validates the entire batch before one transaction writes it". Validation now happens inside the single transaction, which is atomic but described differently.
   - **Fix:** reword both. Neither is functional.

3. **Low (note, no action required): the trigger applies only to databases that run migration 3 after this change.**
   - **Evidence:** a database already stamped version 3 by a round-1 build would have no `require_entry_uid` trigger, because migration 3 is recorded as applied.
   - **Impact:** migration 3 is unreleased (uncommitted at HEAD `399c4a4`), so this is limited to development databases. If any shared database was opened by a round-1 build, drop and recreate the migration, or add a migration 4 that creates the trigger if it is missing.

## Remaining coverage and validation limits

- **Back button visibility:** nothing asserts real CSS visibility, which is why finding 1 slipped through. The caller's planned browser check is the right test.
- **`src/web/script.ts` coverage:** the script is a string evaluated with `runInNewContext`, and the report shows 100% for it. I did not investigate how the instrumentation applies to a template string.
- **Not run by anyone:** I have no evidence that `pnpm typecheck`, `pnpm lint` and `pnpm build` passed. Only the caller's statement says so.
- **Nested savepoint behaviour:** it relies on `better-sqlite3`, as in round 1. The rollback tests exercise it, and the caller reports them as passing.

## Pre-existing and unrelated issues (unchanged from round 1)

- Legacy imports without `externalRef` or `uid` are not idempotent.
- The UI fetches `limit=1000` and filters dates client-side.
- Equal-`occurredAt` current-snapshot ties depend on destination-local ids.

## Conclusion

No new issues in the core logic: migration, completion events, import/export and atomicity. The `/api/entries/` and 400 handling and the focus-clearing paths read correct. The one concrete defect to fix before sign-off is finding 1. Because I could not execute anything this round, the test, coverage, typecheck, lint and build results are the caller's.

### Round 3 — original reviewer report

[Prompt](evidence/activity-completion/round3-prompt.txt) · [Raw event stream](evidence/activity-completion/round3-events.jsonl.gz) · [Exit code](evidence/activity-completion/round3-exit.txt)

# Final independent review, round 3

## Header

- **Reviewer model / effort:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), as shown in the CLI init. The caller says effort is configured high.
- **Status:** the static review is complete. I found no remaining actionable defects.
- **Limitation:** I did no execution of my own in any round. Bash was denied in rounds 1, 2 and 3. Test, coverage, typecheck, lint, build, format and browser results below come from the caller's saved artifacts. I read them but did not reproduce them.

## Scope and evidence used

- **Round-3 changes inspected:**
  - `src/web/styles.ts:211`
  - the new assertion at `test/server.test.ts:389`
  - the changed text in `docs/architecture.md` (lines 86–88) and `skills/project-mgr/SKILL.md` (line 58)
- **Artifacts read:**
  - `round3-hashes.txt`
  - `validation-round3.txt` (header and tail)
  - `typecheck.txt`
  - `lint.txt`
  - `build.txt`
  - `format.txt`
  - `browser-round3.txt`
- **Not checked:** `git diff --check` (the caller says it passed; no artifact was provided) and `browser.png` (not opened).
- **Hash comparison:** I cannot recompute hashes, but I compared `round3-hashes.txt` with `round2-hashes.txt` line by line.
  - **Unchanged:** `src/cli.ts`, `src/db.ts`, `src/domain.ts`, `src/server.ts`, `src/web/script.ts`, `src/web/ui.ts`, the locale files, `test/core.test.ts`, `test/completion.test.ts`, `CHANGELOG.md`, `README.md` and the requirements file.
  - **Changed:** `docs/architecture.md`, `SKILL.md`, `src/web/styles.ts` and `test/server.test.ts`. This matches the stated "no other behavior change". It is consistent with the claim but does not prove the files are what was hashed.

## Closing the round-2 findings

1. **Back button always visible (round 2, finding 1): closed.**
   - **Fix:** `src/web/styles.ts:211` now has `.btn[hidden] { display: none !important; }`, placed before `.btn { display: inline-flex }`. `!important` makes the rule win regardless of order. No other `hidden` rule or styling collides: the grep of `src/web` shows only the markup in `ui.ts:84` and `script.ts:282`.
   - **Regression test:** `test/server.test.ts:389` asserts the rule text in the served HTML. The assertion is a text match, so it guards against removal, not against rendering.
   - **Real-CSS evidence:** `browser-round3.txt` shows computed display `none` on the normal list. It shows `inline-flex` when a deep-linked entry is focused. After return, the URL has no `entry` query, the list shows both entries, and the button is `none` again. This is the evidence that the defect is fixed.
2. **Stale doc statements (round 2, finding 2): closed.**
   - `docs/architecture.md:88` now says "read raw snapshots directly in oldest-to-newest order". This matches `exportLedger`, which orders by `occurred_at, id`.
   - `SKILL.md:58` now says "Import validates and writes the entire batch within one transaction". This matches `importLedger`.
3. **Trigger and already-stamped version-3 databases (round 2, finding 3): retained as an informational note, not a defect.**
   - A database stamped version 3 by a round-1 build would lack the `require_entry_uid` trigger. Migration 3 is uncommitted and unreleased, so this only affects such development databases. No action is required unless a shared database was opened by a round-1 build.

## Round-1 findings, final disposition

- **1 (export shape):** accepted as a documented breaking change. The CHANGELOG has an entry.
- **2 (random backfill UUIDs):** accepted as a documented limitation. The failure is explicit and atomic, with no silent adoption.
- **3 (malformed percent-encoding):** fixed in round 2 and covered by tests (400).
- **4 (annotation cost):** partly addressed. Export reads raw rows. Per-entry annotation in history remains, and I judge deferring reasonable until there is latency evidence.
- **5 (docs/CHANGELOG):** fixed. The two small leftovers are now fixed.
- **6 (test gaps):** closed on reading. Tests now cover equal-time round-trips, multi-row migration, the numeric route, the `externalRef` retry, and the `fetchData` success and failure paths. The deep-link browser path was checked by the caller.
- **7 (nullable uid / old writers):** fixed by the migration trigger, with a test that simulates an old writer.
- **8 (focused view exit):** fixed. The back control, refresh, filter and date changes all clear focus and the URL. The browser output confirms the navigation and date behavior.

## Evidence assessment

- **Test and coverage:** `validation-round3.txt` records the c8 coverage run. It shows 16 tests, 16 passing and 0 failing, cancelled or skipped. All files report 100% for statements, branches, functions and lines.
- **Static checks:** `typecheck.txt` is `tsc --noEmit`, `lint.txt` is `eslint .`, `build.txt` is `tsc -p tsconfig.json`, and `format.txt` reports "All matched files use Prettier code style!". Each shows no error output.
- **Caveat:** these artifacts are consistent with success, but they are not independent verification. They cover the final tree only as far as the file hashes can be trusted.

## Remaining limitations (non-blocking)

- **Native pointer events:** `browser-round3.txt` says the native Playwright click on a background tab timed out earlier. The results come from dispatched DOM events plus computed-style and navigation checks, not native pointer input. This is a small residual UI-input risk.
- **Extension noise:** `runtime.lastError` appeared in the caller's browser from an extension. No application error was reported on the final navigation.
- **History annotation cost:** history annotation is still four queries per entry. It is fine for a small local ledger. Revisit it if the 1000-row UI fetch ever feels slow.

## Pre-existing and unrelated issues (unchanged)

- Legacy imports without `externalRef` or `uid` are not idempotent.
- The UI fetches `limit=1000` and filters dates client-side. Server-side annotation and `/api/entries/` mitigate the impact on completion links.
- Equal-`occurredAt` current-snapshot ties depend on destination-local ids.

## Conclusion

Static review of the final state is complete. The round-3 changes are narrow and correct, the round-2 findings are closed, and I found no remaining actionable defects. Confidence in the passing test, coverage and static-check results rests on the caller's saved artifacts, since I could not run any command myself.

## CC implementation review — 2026-10-16

Reviewer: Claude Code (independent cross-review of the Codex implementation, uncommitted working tree on `main`).

### Verdict

**Approve.** The implementation satisfies the finalized requirements in `requiments/activity-completion-propagation.md`. I found no blocking defects. Unlike the round 1–3 reports above, every validation command below was run by this reviewer.

### Validation run by this reviewer

- `pnpm typecheck`, `pnpm lint`: pass.
- `pnpm coverage`: all tests pass; 100% statements/branches/functions/lines for every file under `src/`.
- `prettier --check .`: **failed** only on this review file (formatting of earlier CC sections: emphasis markers and table alignment). Fixed by running Prettier on this file as part of this review; no source file was affected.
- A scratch-database probe against `src/db.ts` (not committed), covering:
  - Equal-time link rejected. Self-link rejected. Cross-project link rejected.
  - `add --completes` with one invalid target rolls back the new snapshot (entry count unchanged).
  - Repeating an active link is a no-op. A different source while active is rejected. Revocation without a reason is rejected. Revoke then relink to another source works.
  - Completion evidence on a page (`limit/offset`) where the follow-up is outside the page. `isCurrent` is computed from the full project history.
  - `current()` still selects the latest snapshot. `at()` returns a plain snapshot without annotations.
  - Full export → import into a fresh DB gives an identical effective state (uid, effectiveStatus, completedBy) and the same event count. Re-import inserts 0 rows.
  - Tampered entry content under an existing uid fails ("conflicting entry uid"). A tampered completion event fails ("conflicting completion uid").
  - A project-filtered bundle imports. A legacy entry-only object imports.

### Requirement coverage

| Area                                                                                                                    | Result                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Append-only events, revocation reason, single active source, no-op repeat                                               | Met (`changeCompletion`, `insertCompletion`; per-target `previous_uid` chain)                                   |
| Same project, strictly earlier target, self-link rejection                                                              | Met (`validateCompletionPair`)                                                                                  |
| Atomic CLI writes incl. metadata                                                                                        | Met (`add` wraps metadata + snapshot + links in one immediate transaction)                                      |
| Portable identities, backfill without content change, round-trip, idempotency, explicit conflicts, legacy import        | Met; the cross-copy limitation is documented                                                                    |
| Server-side evidence independent of filters/pagination; original status kept separately                                 | Met (`annotateEntry` on `history`/`current`/`getEntry`)                                                         |
| `at` unchanged, as-of deferred                                                                                          | Met                                                                                                             |
| HTTP read-only                                                                                                          | Met (GET/HEAD guard; new `/api/entries/:ref` is read-only)                                                      |
| UI: Completed badge + "由后续动态完成" link, original details inspectable, Current/Superseded independent, zh/en parity | Met by code reading and server tests. I did not re-run a browser check; the round-3 browser evidence covers it. |
| Agent instructions (`SKILL.md`)                                                                                         | Met                                                                                                             |

### Findings (non-blocking)

1. **Format check failed on this review file.** See above; resolved.
2. **Self-link error message.** `complete --entry X --by X` is rejected by the time-order rule ("completion target must have a strictly earlier occurrence time") rather than a dedicated self-reference message. Behavior is correct and atomic; a clearer message is optional.
3. **`.gitignore` lacks a trailing newline** after the new `reviews/evidence/` line. Cosmetic.
4. **Already documented, accepted:**
   - Random backfill UUIDs differ between independently migrated copies.
   - Legacy imports without `uid`/`externalRef` are not idempotent. This predates the change and is unchanged.
   - Per-entry annotation queries: 3 per row; fine at the current scale.

### Not covered

- No native-browser run by this reviewer.
- Behavior under concurrent writers beyond `BEGIN IMMEDIATE` was not exercised.
