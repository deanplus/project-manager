# Todo start/due timestamps and editing

Status: Implemented — cc skipped; Codex author response/self-review Round 4 (2026-11-04); independent review Round 3 GO
Review: [Implementation self-review](../reviews/2026-11-04-todo-start-due-and-edit.md)
Date: 2026-11-04 (Asia/Shanghai)
Builds on: [Next-Todo / current consistency](next-todo-current-consistency.md), [Next actions vs. watch items](next-actions-vs-watch-items.md), [Independent Todos](../../requiments/todos.md)

Ledger requirements (remain open):

- `21b3e139-69ef-48e6-ba39-d122f6a05afa` — Todo start time and due time, precise to the second.
- `589f0f47-53ae-42d3-9ec8-131752eed34b` — Edit Todo title, content (add the field if absent), status, and related fields.

The two preceding requirements explicitly excluded these topics. This document defines them together because they share the Todo schema, partial-update contract, and read/write surfaces. Cancelled items `8cd380d6…` (second-level timestamps) and `76114006…` (start/due; mandatory/default due) are background only. Their wording is not an accepted requirement for these open items.

## Problem

The implementation baseline is package **0.5.2**. Its pre-change behavior, checked in `package.json`, `src/cli.ts`, and `src/db.ts`, was as follows. This local implementation does not bump or publish the package version:

| Surface        | Current behavior / gap                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `todo-add`     | `--title <text> [--project <name>] [--entry <uid>] [--json]`; no start/due, content, or `--source`.                                                                                                                                                 |
| `todo-update`  | `--uid <uuid> [--status open\|completed\|cancelled] [--project <name>] [--json]`; cannot change title or content.                                                                                                                                   |
| Snapshot `add` | Has `--source` / `--external-ref`. These are snapshot metadata, not Todo authorship.                                                                                                                                                                |
| Todo storage   | Migration 4 creates `uid`, `title`, `project`, `entry_uid`, `step_index`, `status`, `created_at`, `completed_at`. No start/due/content/source or author-signature field. Migration 5 adds snapshot `next_todo_uids_json`; it does not extend Todos. |
| `openWork`     | Todo items expose `uid`, `title`, `project`, `pinned`, `pinIndex`, `createdAt`, and `entryUid`; no start/due/content.                                                                                                                               |
| Lifecycle      | Creation produces `open`; entering `completed` sets `completedAt`; leaving it clears `completedAt`. Repeating the same status preserves it.                                                                                                         |
| Portability    | JSON/JSONL exports use ledger versions up to 4. Import rejects unknown Todo fields and conflicting same-UID rows. Legacy-derived Todos with `stepIndex` must currently match the source step's title.                                               |

A timed action must currently put its time in its title. Correcting that title or adding detail requires a replacement Todo or external notes. Replacement changes identity and complicates pins, while title-encoded times cannot be validated or consumed as structured data. Adding editable fields without updating portability would also make a renamed legacy-derived Todo fail its own export/import round trip.

## Goals

- Store start and due instants at second precision, separate from lifecycle timestamps.
- Edit the wording, detail, scheduling fields, and status of an existing Todo by UID.
- Preserve Todo identity, source linkage, and existing pin/carry rules.
- Expose the fields through consistent domain, CLI, HTTP, and portable representations.
- Keep old rows readable and apply the user-locked policies below.

## Non-goals

- Scheduling jobs, reminders, recurrence, notifications, automatic start/completion/cancellation, or a new `in-progress` status.
- Due-date sorting, hiding future work, or automatic pinning and reprioritization.
- Todo `source`, author signatures, editor attribution, edit history, or snapshot-style `externalRef` deduplication. No author is inferred from a linked snapshot.
- Rewriting historical snapshots, changing source links, fuzzy deduplication, or merging Todos after a title edit.
- Replacing the action/watch classification or the evidence needed to retire a commitment.
- A dashboard editing form or dashboard scheduling view in this increment (read/API compatibility is in scope).
- Real-ledger mutation, closure of the two requirement Todos, commit, push, or publication in this implementation task.

## Definitions

- **Identity**: the Todo's immutable `uid`. Title and scheduling metadata are not identity.
- **Start instant (`startAt`)**: the optional user-supplied **planned start** (final user decision Q2). It is not `createdAt`, does not assert that work began, and does not introduce a status transition.
- **Due instant (`dueAt`)**: the user-supplied deadline for the action. It is optional, defaults to null, and has no inferred default (Q1).
- **Content (`content`)**: optional longer text explaining the action, acceptance details, or links. The title stays the concise checklist label.
- **Absent update field**: leave the stored value unchanged. **Explicit null**: clear a nullable editable field. These are different operations.
- The final seven policies below supersede the earlier Round 1 policy on 2026-11-04. No blocking open questions remain; cc review was explicitly skipped in favor of Codex implementation and self-review.

## Requirements

### R1 — Todo fields and timestamp representation

Add `startAt: string | null`, `dueAt: string | null`, and `content: string | null` to the Todo domain/read model. Map them to nullable SQLite TEXT columns `start_at`, `due_at`, and `content`.

Locked timestamp contract (Q3):

- Accept the ISO-8601 subset `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss±HH:mm`, with a valid calendar date and explicit zone. Reject date-only, minute-only, timezone-free, fractional-second, and invalid/normalized-overflow inputs.
- Store and emit canonical UTC `YYYY-MM-DDTHH:mm:ssZ`; equivalent offsets identify the same instant. For example, `2026-11-04T18:00:00+08:00` becomes `2026-11-04T10:00:00Z`. Do not depend on the host timezone or preserve the original offset as another field.
- Use a dedicated parser, not lifecycle `parseTime`. Offset hours are 00–23, minutes 00–59; accept `-00:00` as UTC and reject lowercase t/z, `T24:00:00`, and `:60`. Compare across scheduling/lifecycle timestamp families by parsed instant. Never silently round or truncate subsecond input. This precision rule applies to the new fields only; existing lifecycle timestamps retain their current representation.
- When both values exist, validate `startAt <= dueAt` on the merged post-update state; equality is allowed. Past instants are valid.

### R2 — Creation, clearing, and lifecycle

Locked policy (Q1/Q2): both times are independently optional, and omitted values are `null`. There is no implicit deadline of now, end-of-day, start time, or a fixed duration. Either time can be explicitly cleared.

- `todo-add` may supply either or both times and content. New Todos still start `open` with system-generated `createdAt` and null `completedAt`.
- Todos created by `add --next`, legacy conversion, or other existing creation paths receive null new fields unless their API explicitly accepts values. This requirement adds no per-item time/content syntax to `add --next`; create with `todo-add`, then pin by UID when metadata is needed.
- Setting, changing, or clearing a time does not change status, `createdAt`, or `completedAt`. Completing/reopening a Todo preserves its times and content.
- Preserve 0.5.2 completion behavior: transition to `completed` sets `completedAt`; transition to `open` or `cancelled` clears it; repeated identical status preserves it.
- No ordering constraint with `createdAt` or `completedAt` is added: recording may be late, and completing after due is valid. No timestamps are inferred from title text or legacy records.

### R3 — Content and title

- Title remains required, trimmed, and 1–2000 characters using the existing validation convention. Reject null, empty, or whitespace-only titles.
- Content is optional multiline plain text; it is not parsed as commands, HTML, or an author signature. Locked limit: 8,000 JavaScript string code units (Q4).
- Normalization: omitted on create, explicit null, empty string (domain/HTTP only), or whitespace-only content means null. CLI `--content ""` is an error; use `--clear-content` to clear explicitly. Preserve nonblank content exactly, including line breaks and surrounding whitespace. Omission on update always means unchanged.
- Checklist labels and exact-title reuse use title only, never content. Editing content does not replace the title. Any UI rendering must escape user text.

### R4 — Atomic partial updates and immutable fields

`updateTodo` accepts only `title`, `content`, `startAt`, `dueAt`, `status`, and `project`. Apply every supplied field to one existing UID in one transaction; validate the resulting row before committing. Invalid fields, timestamps, ownership changes, or a missing UID reject the whole patch.

- Omitted fields remain unchanged. Null clears content/times under the locked optional policy in R2.
- `status` stays `open | completed | cancelled`; null is invalid. All three statuses may receive wording or metadata edits without implicitly reopening.
- Preserve project ownership restrictions: source-linked or snapshot-referenced Todos cannot change project. An unlinked, unreferenced Todo can be assigned to an existing project or cleared through the existing domain null operation. This increment adds no CLI project-clear flag.
- `uid`, `entryUid`, `stepIndex`, `createdAt`, and `completedAt` are not writable patch fields. The CLI UID selects the row; it cannot rename it. Reject unsupported keys/flags rather than ignoring them.
- An empty patch or a patch equal to stored values remains a no-op and returns the current Todo; it creates no snapshot or Todo and does not refresh completion time.
- Patches are serialized and merged with the latest stored row inside the transaction. Disjoint-field edits preserve one another; the last successful write wins for the same field. Optimistic version checks and an edit audit trail are outside scope.

### R5 — Pins, carry, provenance, and title reuse

- Editing preserves UID, source linkage, `nextTodoUids`, pin position, and pin identity. It never unpins, pins, duplicates, or rewrites a snapshot.
- Time/content/title edits do not change `openWork` selection or ordering: open pins first, then unpinned open work in the existing order. Future-start and overdue open Todos remain visible. Status edits retain the existing open-work filtering and later carry filtering.
- Exact-title reuse by `add --next` uses the current edited title. The former title is not an alias; a later `--next` with that old title can create another Todo. A title collision is allowed and does not merge UIDs; existing candidate selection remains unchanged.
- Editing changes the description of the same action or occurrence. A changed deliverable, occurrence, or scope needs a separate Todo under the previous requirement's evidence-based reconciliation; deadline-only changes keep the existing UID.
- Stored snapshot fields stay immutable. Refs-format snapshots retain no original title: a rename is lossy and `history.nextTodos` resolves the current title. Legacy `nextSteps` strings retain old wording while `openWork` shows the edited title. Record old wording in snapshot progress if needed. Legacy conversion retries resolve by `(entryUid, stepIndex)` and return the existing edited Todo.
- **Known limitation L3 — fixed-UID text retries after rename.** The existing comparison uses live titles because original per-pin titles are not stored. After a rename, the original text payload fails with `conflicting entry uid`; a payload matching the current title may return the stored entry with `inserted: false`. Neither case mutates the snapshot or Todos. This implements the draft's instruction to document retained retry limitations; it cannot promise original-text identity without additional storage. CLI writes do not pass fixed UIDs, imports use strict portable equality, and `--external-ref` replay is unchanged. Regression tests cover all three paths.

### R6 — Read surfaces and delivery scope

| Surface                                     | Implemented scope                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain / HTTP Todo APIs                     | Accept the R2/R4 inputs and return the three new nullable fields through shared validation. Existing routes and ownership checks remain. The entry-linked `/api/entries/:uid/todos` creation route stays title-only (or index conversion); `/api/todos` accepts metadata. All mutation request bodies retain the 32 KiB bound. 8,000 CJK content units plus a 2,000-unit title fit; heavily escaped JSON may return 413 even when the domain text limit is satisfied. |
| `todo-add`, `todo-update`, `todos --json`   | Return full Todo objects including the new fields.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `openWork`, `next --json`, `current --json` | Add the three fields to every `kind: "todo"` item, including unassigned Todos. Keep `legacy-step` items unchanged; reads do not create Todos.                                                                                                                                                                                                                                                                                                                         |
| `nextTodos`, `history`, `at`                | Keep existing projection contracts; no new `openWork` or historical scheduling reconstruction. Live title resolution follows R5.                                                                                                                                                                                                                                                                                                                                      |
| CLI text checklist                          | Append ` [due <UTC>]` in `next`, `current` open-work lines, and `todos` when due is non-null. Undated lines remain byte-identical. Full metadata is available in JSON.                                                                                                                                                                                                                                                                                                |
| Export/import                               | In scope and required; see R7.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Dashboard                                   | Existing Todo lists, title/status actions, and HTTP consumers must keep working. Metadata display/editor controls are deferred; absence from the UI must not clear stored values.                                                                                                                                                                                                                                                                                     |
| README / help                               | `skills/project-mgr/SKILL.md`, both READMEs, `docs/architecture.md`, `CHANGELOG.md`, and CLI help document flags, clearing, zones/precision, locked defaults, and UID-preserving edits.                                                                                                                                                                                                                                                                               |

### R7 — Portable data and renamed legacy-derived Todos

- Extend both JSON and JSONL round trips to preserve all new fields, nulls, UID, ownership, provenance, status, and lifecycle timestamps. Project-scoped exports must preserve referenced/unassigned dependencies as today.
- Use portable ledger **version 5** when exporting Todos with this extended shape. Existing empty/entry-only exports may retain their existing version selection. This number is separate from SQLite migration numbering.
- New importers accept existing supported formats, including versions 2–4; absent new fields in old Todo records become null. Version 5 requires all three new keys (explicit null is valid); records undergo the same timestamp/content normalization and start/due ordering validation before identity comparison. Reject unsupported future versions and unknown fields.
- Old 0.5.2 readers must reject the new version instead of silently dropping metadata. Do not label extended Todo records as version 3/4 merely because their new fields happen to be null.
- Retain transactional import and same-UID conflict detection. Compare normalized complete Todo values, including new fields. Import is not an upsert/edit mechanism; a divergent row must fail without partial writes.
- For the new format, a legacy-derived Todo may have a title different from the original step. Validate that its source exists, project matches, and `stepIndex` identifies a valid source step; do not require title equality. For refs-format sources retain the index-to-UID check. Preserve old-format validation and source uniqueness; do not detach or rewrite provenance to permit a rename.

### R8 — Agent guidance and correction vs. supersession

Update `skills/project-mgr/SKILL.md`, `README.md`, `README_CN.md`, `docs/architecture.md`, and `CHANGELOG.md` together:

- New timed actions use `todo-add --due-at` and then `add --next-todo`; keep times out of new titles. Existing titles are not automatically rewritten.
- A new deadline for the same deliverable/occurrence, including a deliberate reschedule, uses in-place `todo-update --due-at`, optionally followed by `add --progress` with the reason; supersede (cancel + new + pin) only when the deliverable, occurrence, or scope changes; separate renewals remain independent Todos. Create the replacement before cancelling the old UID and pinning the replacement in one `add`, with evidence in `--progress`. Creation and the final snapshot are separate transactions; existing staging recovery still applies.
- `todo-update` writes no snapshot or audit record. If evidence or old wording matters, follow it with `add --progress`; this pair is not atomic.
- Start/due never turn a watch into an action; due triggers no reminder. Gates stay in their owning records and check times in scheduled tasks.
- Mark the prior requirement's “until 21b3e139” workaround resolved by this document. Verify same-deliverable/occurrence corrections and reschedules preserve UID/pins, and deliverable/occurrence/scope supersession still satisfies that requirement's AC 3.

## CLI

Implemented flags (new in this working tree; unavailable in the baseline 0.5.2 build):

```text
pmgr todo-add --title <text> [--project <name>] [--entry <uid>]
  [--content <text>] [--start-at <iso-time>] [--due-at <iso-time>] [--json]

pmgr todo-update --uid <uuid> [--title <text>] [--content <text> | --clear-content]
  [--start-at <iso-time> | --clear-start-at]
  [--due-at <iso-time> | --clear-due-at]
  [--status open|completed|cancelled] [--project <name>] [--json]
```

- Clear flags map to explicit null; omitted flags do not appear as destructive defaults. Clear flags apply to update only. `--due-at` is optional; `--clear-due-at` is supported.
- Reject a value and its clear flag in the same command. Empty timestamp strings are errors, not clearing syntax. `--content ""` is an error; use `--clear-content`. Whitespace-only CLI values normalize to null, as do blank domain/HTTP values. Values beginning with `--` remain unsupported; file/stdin input is deferred.
- Update help, allowed flags, and the existing `pmgr status <action>` aliases consistently. `--source`, `--external-ref`, and author flags remain unsupported for Todos.
- A command can edit title/content/times and status together atomically. A new deadline for the same deliverable/occurrence preserves UID, whether correcting a mistake or deliberately rescheduling. Only changes to the deliverable, occurrence, or scope follow the supersede procedure. Editing records no evidence history: when needed, follow with `add --progress` as a separate, non-atomic command. A time does not turn a watch into an action and triggers no scheduled check.

## Migration

- **M1 — New schema migration.** Add `start_at TEXT`, `due_at TEXT`, and `content TEXT`, all nullable with default null. The baseline latest `schema_migrations` version is 5; the implementation adds **6**. Migration 4 is the Todo table's origin, not the current schema version.
- **M2 — Old rows.** Every existing row starts with null new fields. Preserve all original values, indexes, source uniqueness, and snapshot references. Do not backfill from dates embedded in titles or invent deadlines/authors.
- **M3 — Atomic and repeatable.** Run the migration through the existing transactional migration mechanism. Reopening the database must not reset edited values. Fresh databases and upgrades must yield the same schema.
- **M4 — Creation and interchange.** Cover all Todo insertion paths, new and old imports, legacy conversion, and projected reads. Portable version 5 and database migration 6 are independent contracts. Mixed old/new writers are not safe: an old build can open the migrated database but silently omit metadata on export. Back up first, build the new code and restart all dashboard/writer processes before the first metadata write; never use an old-build export as a complete backup. No destructive downgrade procedure is supplied.
- **M5 — No operational mutation here.** Implementation validation uses in-memory/temporary databases only. No real database migration or update/cancellation of either requirement Todo is authorized.

## Open questions — locked answers (2026-11-04)

All answers below were explicitly locked by the user; none is blocking. Round 0 is preserved and its findings are addressed by the final choices and Round 2; Round 1 is superseded history. No new cc review was requested or run.

1. **Due:** optional, default null, no inferred default; `--clear-due-at` is allowed.
2. **Start:** `startAt` means optional planned start, independently optional from due. Keep this name and `start <= due` when both exist.
3. **Timestamps:** R1 explicit-zone, whole-second input and canonical UTC output; reject fractions/zone-free input, retain no original offset. Offset hours are 00–23 and minutes 00–59; `-00:00` means UTC. Reject lowercase t/z, leap seconds, 24:00, calendar overflow, and normalization outside four-digit UTC years. Compare with lifecycle timestamps by parsed instant, not mixed-format lexical order.
4. **Content:** R3 plain multiline text, 8,000 code units, blank to null, preserve nonblank text. No Markdown rendering or file/stdin flags.
5. **Author/source:** excluded this round.
6. **Dashboard:** API/read compatibility only; no new controls. CLI `next`/`current`/`todos` text adds a lightweight due suffix; other metadata remains available via JSON.
7. **Portability:** v5 with version-gated relaxation of legacy title equality; retain source, project, index bounds, UID references, and uniqueness validation. Old-format title checks remain strict.

## Acceptance criteria

Policies are locked as above. Validation results and the Codex self-review disposition are recorded in the linked review. Use in-memory or temporary databases only; no acceptance case needs the real ledger.

1. Create a Todo with title only: under the locked optional policy all three new fields are null. Other existing creation paths produce the same defaults.
2. Create with offset timestamps precise to the second and multiline content; read back canonical UTC instants and preserved nonblank content. Equivalent offsets normalize identically. Reject `2026-02-30T00:00:00Z`, `2026-11-04T24:00:00Z`, `2026-11-04T10:00Z`, `2026-11-04T10:00:00.5Z`, missing zones, `:60`, lowercase t/z, invalid offset bounds, and invalid ordering without writing a Todo. Accept `2026-11-04T10:00:00-00:00` as UTC.
3. Partial update preserves every omitted field. Set and clear each nullable field; content blank/null behavior matches the accepted policy. Reject each value/clear conflict and unknown field/flag without changing any stored value.
4. Edit title, content, dates, and status in one command. An invalid title, date, or project rolls back all fields, including completion time. Empty patches and repeated status writes preserve lifecycle values.
5. Complete, reopen, and cancel with scheduling metadata present. Preserve metadata and the existing `completedAt` transition semantics; editing closed Todos does not reopen them. Creation/completion timestamps cannot be patched directly.
6. Rename a pinned Todo and change its schedule: UID, source, all snapshot pin lists, and pin order stay unchanged. `next`/`current.openWork` show the edited title and metadata immediately. Future/overdue items stay visible; status closure still filters and carries as before.
7. Rename an unpinned and an unassigned pinned Todo; verify both read projections include nullable fields. A renamed legacy-derived Todo survives conversion retries and a complete export/import round trip under its original UID and source index; legacy snapshot text stays old while `openWork` shows the edited title.
8. Title collisions do not merge Todos. Exact-title reuse uses current titles and existing selection rules; an old title is not an alias. External-reference replay remains side-effect free; L3 is explicit: after rename, the original fixed-UID text payload throws `conflicting entry uid`, current-title text returns the stored entry with `inserted: false`, and neither changes any Todo or snapshot.
9. Reject changes to immutable fields and prohibited project moves atomically. Interleaved disjoint-field patches from two database connections preserve both edits; same-field writes follow the stated serialization rule.
10. Upgrade a version-5 database with linked, pinned, completed, cancelled, and unassigned Todos. Original values and references are unchanged; new columns are null. Reopening preserves later edits; a fresh database has the same schema.
11. JSON and JSONL, full and project-scoped exports, round-trip extended Todos without loss. Old supported formats import with null new fields. Same-UID differences and invalid source/index references reject the whole import; old 0.5.2 rejects the new portable version.
12. HTTP Todo APIs use the same validation and return fields; existing dashboard actions preserve omitted metadata and continue to work. 8,000 CJK content units succeed through CLI and HTTP; 8,001 fail domain validation, while oversized escaped HTTP bodies return 413. CLI aliases/help and all R8 guidance match the accepted contract; due suffixes appear only on dated text rows.
13. For implementation acceptance, run the relevant domain/CLI/HTTP/import tests, then `pnpm test`, `pnpm typecheck`, and `pnpm lint`.
