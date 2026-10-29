# nextSteps as Todo references

Status: GO after Codex Round 4; F11 wording cleanup applied — ready for implementation
Date: 2026-10-29 (Asia/Shanghai)
Related: [Independent Todos](./todos.md)
Review: [docs/reviews/nextsteps-as-todo-refs.md](../docs/reviews/nextsteps-as-todo-refs.md)

## Problem

Today, status snapshots still store concrete next-step **text**. New `--next` values also atomically create Todos linked by `(entryUid, stepIndex)`. That yields two sources of truth:

- Snapshot `nextSteps[]` strings remain the historical wording and still drive some digests/UI.
- Todos hold the actionable lifecycle (`open` / `completed` / `cancelled`), but dropping text from a later snapshot does **not** cancel the earlier Todo.
- Repeating similar `--next` text across follow-up snapshots can create duplicate open Todos.

The desired model: **Todos own the concrete work items**; a snapshot’s nextSteps field only **points at** zero or more Todos.

## Proposed model

1. **Source of truth for work content and status is the Todo** (title, project, open/completed/cancelled, optional source link).
2. A status snapshot’s “next steps” is an ordered list of **Todo UIDs** (references), not free-form commitment text.
3. Readers that need “what’s next” resolve those UIDs to current Todo rows (title + status). Historical snapshots keep their original UID list immutable; later Todo status changes do not rewrite the snapshot.
4. Creating work for a project should create/update **Todos** first (or in the same atomic write), then attach their UIDs on the new snapshot’s nextSteps refs.
5. Abandoning an item is `todo-update --status cancelled`, not deleting text from nextSteps. Completing is `completed`. Removing a UID from a newer snapshot’s ref list means “no longer listed as current next work”; it does **not** by itself cancel or complete the Todo unless the author also updates the Todo.
6. Independent Todos (no project / no snapshot) remain valid. Project-linked Todos need not appear on any snapshot; snapshot refs are a curated current subset, not the exclusive membership list.

## Compatibility with append-only history

- Do **not** rewrite historical `nextSteps` string arrays on old entries.
- Prefer additive schema: new-format snapshots store refs in a dedicated field (see Decisions). Legacy string `nextSteps` remains readable for old entries. Legacy rows omit `nextTodoUids` (absent, never materialized as `[]`).
- Explicit, one-time **legacy conversion** (already sketched in Independent Todos) remains for old string steps → Todos; after **all source indices are converted** and refs are materialized, subsequent new-format writes use refs only.
- Export/import must preserve Todo identities and the new reference field. Legacy entry-only imports must not invent open work.

## CLI / agent write path (intent)

- Preferred agent path for new work: create Todos, then `add` that references those Todo UIDs as next steps—**or** a single atomic `add` sugar that creates Todos and stores refs in one transaction (see Decisions).
- `todo-update` remains the shared way to complete/cancel/reopen; Dashboard/HTTP may call the same logic.
- Digest / daily list should prefer **open Todos**, optionally using current-snapshot refs as an ordering / “pinned next” hint—not as a parallel string inventory.

## Dashboard / API (intent)

- Current project view shows referenced Todos with live status badges.
- Activity history for legacy entries still shows original next-step text; for new entries shows linked Todos (title + live status at read time, with uid).
- Converting legacy steps remains explicit and idempotent per source index.
- “Add Todo” creates a Todo (optional project/source). Pinning it into the project’s **current** next list requires an explicit new snapshot that includes its uid among refs (never mutate historical refs).

## Acceptance criteria

- New-format status snapshots do not persist concrete next-step prose as the durable nextSteps payload; they persist Todo references in `nextTodoUids`. Exception: legacy-preserving follow-ups may still copy full string `nextSteps` with `nextTodoUids` absent until all source indices are converted (see Round 3 transition).
- Creating a Todo and attaching it as a current next step can be done without duplicating title text into a second mutable store.
- Cancelling/completing a Todo is reflected wherever that Todo is resolved from refs, without rewriting historical snapshots.
- Removing a Todo UID from a newer snapshot’s ref list does not implicitly cancel/complete that Todo.
- Legacy snapshots with string nextSteps remain readable; conversion remains explicit and does not double-create.
- Export/import round-trips Todo UIDs and new-snapshot refs without inventing open work on legacy import; conflicting or dangling refs fail the whole import batch.
- Daily digest / agent listing can answer “open work” from Todos without depending on string nextSteps on the latest snapshot.
- No commit, push, package publish, dashboard restart, or production DB migration is implied by accepting this requirements draft alone.

## Decisions after Round 1 (author)

These close Codex Round 1 F1–F6 and the listed open questions for the next review pass. Implementation still waits for GO.

### Storage and API shape (F5)

- Add a dedicated snapshot field for refs, e.g. `nextTodoUids: string[]` (exact column/JSON key naming left to implementation). Do **not** overload `nextSteps` string arrays with UUID-looking titles.
- New-format writes set `nextTodoUids` and leave `nextSteps` empty/omitted. Legacy rows keep string `nextSteps` and **omit** `nextTodoUids` (absent—not empty array).
- On import: omit `nextTodoUids` only for legacy-shaped entries (string `nextSteps` present or both empty/absent). New-format entries must include `nextTodoUids` (possibly `[]`). Explicit `[]` means no pinned next Todos. Reject mixed shapes per the Round 2 matrix.
- `current` / `history` JSON: expose both raw refs and a resolved view `{ uid, title, status, project }` for convenience. `at` continues to return the snapshot as of T and may include stored refs, but **must not** claim resolved Todo titles/statuses are historical as-of T unless a later as-of-Todo feature is specified. Default: resolve live Todo rows for display helpers only, and document that limitation.
- Schema/version: export format bumps enough to carry `nextTodoUids`; readers detect new vs legacy by field presence, not by UUID regex on strings.

### Provenance vs refs (F2)

- Keep Todo provenance fields (`entryUid` / `stepIndex` or successor) as “created from this historical step,” separate from snapshot `nextTodoUids`.
- Import validation for **legacy** linked Todos may keep title match against string `nextSteps[stepIndex]` when that string list exists.
- Import validation for **new** snapshots: every `nextTodoUids` entry must refer to a Todo present in the same import payload (after entries are inserted); missing or unknown UIDs fail the entire import atomically. Do not require title equality against a string nextSteps list that is empty by design.
- Import order remains entries (and projects) before Todos when Todos need entry FKs; if refs are stored on entries, either (a) allow deferred FK check after Todos land in one transaction, or (b) accept Todos before finalizing entry ref constraints—implementation picks one atomic approach that never leaves partial state.

### Activity completion transition (F1)

- Completing an activity must not invent string nextSteps on the follow-up.
- If the **current** latest snapshot already has `nextTodoUids`, the completion follow-up **copies that uid list as-is** by default (including completed/cancelled UIDs still pinned). Authors may pass an explicit replacement list. Copying does **not** create new Todos.
- If the current latest snapshot still has legacy string `nextSteps` with `nextTodoUids` absent: follow Round 3 legacy rules (full string copy until all indices converted; then refs-only materialization). Do not auto-convert on completion.
- Superseded: any earlier wording that mixed refs with remaining strings on one snapshot, or filtered the copied string list.

### Write paths, atomicity, retry (F3)

- Keep a **single-transaction** path: `add` with text sugar (`--next`) creates Todos and writes `nextTodoUids` atomically, with the same externalRef / provenance dedupe behavior that prevents duplicate Todos on retry of the same logical write.
- Two-step `todo-add` then `add --next-todo <uid>…` is allowed when UIDs already exist. Retries of `add` with the same `externalRef` remain idempotent for the snapshot; they must not create additional Todos. `todo-add` retries without a stable client key may duplicate—agents should prefer the atomic `add --next` sugar or supply a stable Todo identity when the product adds one later.
- `add` that creates the first snapshot for a new project continues to ensure the project row exists inside the same transaction before attaching project-scoped Todos (same as today’s project ensure-on-write behavior).

### Ownership and export (F4)

- A snapshot may only reference Todos whose `project` is **null/unassigned** or **equal to the snapshot’s project**. Cross-project refs are rejected at write and import time.
- Ownership after attach: the **all-history lock** in Decisions after Round 2/3 is authoritative. Current unpinning does not unlock project changes. See those sections; do not follow any earlier softer reassignment wording.
- `export --project P` includes Todos with `project=P` and every Todo uid referenced by P’s exported entries (required for import integrity).

### Dedup and prior F5 (F6)

- Atomic `--next` sugar creates one Todo per new title on that write; identical titles on a **later** distinct snapshot are new Todos unless the author reuses UIDs via `--next-todo`. Acceptance: follow-up snapshots that intend to keep the same work must pass existing UIDs, not re-type the same `--next` string.
- Independent Todos review F5 is **already fixed**; this requirements change must preserve `nextStepsSourceUid` behavior for legacy string copies and must not reintroduce convertible duplicates.

### Other open questions

- Todo **title mutation** is out of scope for v1 (`todo-update` stays status/project only).
- “Only `todo-update` completes/cancels” means one shared domain function; Dashboard/HTTP remain allowed callers.
- Daily digest consumer for this repo’s agents: open Todos (`status=open`), with current snapshot `nextTodoUids` used only as preferred ordering for that project’s open items when present. Exact CLI flags for filtered listing are an implementation detail but must exist or be documentable via existing `todos --json` post-filter for agents.

## Decisions after Round 2 (author)

Closes Round 2 F7–F9 plus duplicate-ref and CLI-combine questions. Implementation still waits for GO.

### Legacy conversion and completion (F7, F10) — Round 3 revision

- Per-index conversion remains; conversion does **not** append/rewrite snapshots.
- **No mixed rows.** A snapshot never carries both nonempty string `nextSteps` and present `nextTodoUids`.
- While **any** index on the effective legacy source remains unconverted, every completion/follow-up/`add` that preserves current next work MUST copy the **full** original string list and `nextStepsSourceUid` (same lengths/indices as the source). Do **not** filter to unconverted-only strings. Do **not** set `nextTodoUids` on that follow-up (field **absent**, not `[]`). Converted indices continue to resolve via provenance on the original source; Dashboard indices stay aligned with the full list.
- **Refs materialization** (refs-only snapshot) is allowed only when **every** index on the effective source already has a Todo. Then write `nextTodoUids` in source-index order, omit/empty string `nextSteps`, and preserve existing Todo uids/statuses (no new Todos).
- Acceptance: converting a remaining item through a completion copy, repeated completion, and export/import keeps original indices and each Todo uid/status.

### Ownership across history (F8) — Round 3 revision

- Write-time: snapshot may only attach refs to Todos that are unassigned or already in that project.
- **All-history lock is authoritative for v1:** if a Todo uid appears in **any** stored `nextTodoUids`, or has provenance `entryUid` tied to a project entry, **reject any project change** (including assign-from-unassigned and clear-project). Current unpinning does **not** unlock assignment: historical refs remain, so a once-referenced unassigned Todo stays unassigned under v1.
- Retain the existing source-linked reassignment prohibition.
- Import uses the write-time ownership rule against payload/DB; conflicts fail the batch.

### Format discriminator (F9)

Per entry, exactly one of these valid shapes:

| `nextSteps` (strings) | `nextTodoUids`             | Meaning                                        |
| --------------------- | -------------------------- | ---------------------------------------------- |
| absent/empty          | absent                     | Legacy empty next work (pre-refs era)          |
| nonempty              | absent                     | Legacy string commitments                      |
| absent/empty          | present (`[]` or nonempty) | New-format refs (empty array = no pinned next) |
| nonempty              | present (any)              | **Invalid** — reject on write/import           |

- “Absent” means the field is missing in JSON / NULL in DB. Serializers MUST NOT materialize `nextTodoUids: []` onto legacy string rows on export; omit the field for legacy rows.
- New-format writers always set `nextTodoUids` (possibly `[]`) and omit or empty `nextSteps`.
- Completion uses: if `nextTodoUids` is **present** (including `[]`), treat as new-format (copy refs; do not resurrect strings). If `nextTodoUids` is **absent** and strings exist, use legacy completion rules above (full string copy until full conversion, then materialize).
- Round 3: the “smallest consistent transition” supersedes any Round 2 wording that mixed refs with remaining strings on one snapshot.

### Duplicate UIDs and CLI combine

- Within one `nextTodoUids` list, duplicate uids are **rejected** on write/import (order matters; no silent dedupe).
- A single `add` may not combine text `--next` sugar with `--next-todo` refs; reject the combination. Use one mode per write.

## Decisions after Round 3 (author)

Accepted Codex Round 3 F7/F9 conflict, F8 exception, and F10 index preservation. The Round 3 revision subsections above replace the conflicting Round 2 transition/ownership text. Duplicate-UID and CLI-combine remain as in Round 2.

## Decisions after Round 4 (author)

Codex Round 4: **GO**. Accepted F11 as documentation cleanup only; earlier contradictory summaries aligned with Round 3 authoritative rules above. Implementation may proceed; correctness still requires implementation review.

## Deferred

- Historical as-of resolution of Todo title/status at time T.
- Stable client-supplied Todo idempotency keys beyond existing provenance/externalRef behavior.
- Soft “abandoned” status separate from `cancelled`.

## Scope

Requirements only until a follow-up review records GO in `docs/reviews/nextsteps-as-todo-refs.md`. No commit/push/deploy in the requirements phase. Directory name `requiments` follows the user’s spelling.
