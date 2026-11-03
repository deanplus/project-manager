# Next actions vs. watch items

Status: Accepted (review Round 4 GO); R1–R3 implemented as documentation and R4 triage applied with user authorization on 2026-11-03
Date: 2026-11-03 (Asia/Shanghai)
Builds on: [Next-Todo / current consistency](next-todo-current-consistency.md), [nextSteps as Todo references](../../requiments/nextsteps-as-todo-refs.md)
Review: [docs/reviews/2026-11-03-next-actions-vs-watch-items.md](../reviews/2026-11-03-next-actions-vs-watch-items.md)

## Problem

Since 0.5.0, `--next` creates a Todo, and since 0.5.1 open pins carry forward. `--next` is the only forward-looking field on a snapshot, so agents put everything forward-looking into it. Todos now mix three different things, and several agents write them for the same project without reconciling.

Evidence from the real ledger, `sui-liquidate`, 2026-11-03:

1. **Watch items stored as Todos.** `f686a4de` ("wait for race direct-send Clock relaxation, Suilend timeout, priority fee, DeepBook v9 samples") and `fe6e99e4` ("race direct-send waits for the first ≥$50K crash sample") wait on external events. Nobody can complete them by working on them. They also overlap each other, and the repo's own `todo.md` already tracks the same samples in its observation section.
2. **Disclaimers stored as Todos.** The cancelled chain `6117c972` → `d5ba7c88` → `7094af0c` → `842ff9ff` → `1ff5d945` → `ba1b9f10` is mostly "not verified this round" or "acceptance still pending" text. Each session wrote one and a later session cancelled it.
3. **Contradictory duplicates.** `31876fd0` ("BlockVision runs out around 11-05 morning; fall back to official per the 10-25 decision or decide on more quota") and `ffa73775` ("BlockVision runs out around 11-04 23:00; add quota then") cover the same quota with different dates and decisions. `ba7634db` and `9372df0f` both mean "upgrade the Suilend SDK". Exact-title reuse (R4.4 of the previous requirement) did not catch either pair.
4. **Snapshot contradicts its own Todo.** Snapshot `8749fb8e` has `status: completed` and summary "Upgrade Suilend SDK to 14.2.0", yet the Todo it created, `9372df0f` ("evaluate the 14.2.0 changelog, test locally, and upgrade"), is still open. `packages/liquidator-suilend/package.json` already pins `@suilend/sdk` `14.2.0`.

The same pattern appears in other projects' open work: `meme-pipeline` ("keep tracking…"), `svr-watch` ("keep current collection; observe naturally…"), `morpho` ("target_local=… automation single recheck"), `personal-ip` ("observe as needed…").

## Root causes

- **One field, three meanings.** The snapshot has nowhere else to put "what happens next", so actions, watches, and disclaimers all become Todos.
- **Agent routines route watches into `--next`.** End-of-turn status writebacks put next check times and timer ids into `--next`, and the daily-report automation's "next steps" section was copied into `--next` as a whole.
- **The same item lives on several surfaces.** Repo `todo.md`, scheduled tasks, external todo apps, and project-mgr each held their own wording, and agents were asked to keep all of them in sync. None of them was the authority.
- **Writers do not reconcile.** Agents are told to read `pmgr next` before `add`, but only exact titles are reused. A paraphrase or a revised date creates a second item, and nothing requires the writer to retire the first.

## Goals

- A Todo means one thing: concrete work someone can start and finish.
- Every forward-looking item has exactly one owning surface.
- A writer that adds work duplicating or superseding an open commitment reuses or retires that commitment in the same write, with commands the 0.5.1 CLI accepts.
- A watch leaves `pmgr next` only after its gates are verifiably owned elsewhere.
- `pmgr next` for `sui-liquidate` and similar projects shows only actions.

## Non-goals

- Automatic or fuzzy deduplication, or automatic cancellation. M3 of the previous requirement still holds: closing a Todo is a claim that needs evidence.
- Todo start/due timestamps (ledger Todo `21b3e139`) and Todo editing (`589f0f47`). Each keeps its own requirement.
- Schema or export format changes, unless the open question on a watch field is decided in favor of one.
- Changes to the daily-report automation of `sui-liquidate`. That repo owns its runbook; this document only states the rule it should follow.

## Definitions

Classification test: **"If someone were free right now, could they start this and finish it by working on it?"**

| Kind             | Test result                                                 | Example                                                  | Owner                                                                                                                          |
| ---------------- | ----------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Action**       | Yes                                                         | "Add exponential backoff to Navi `fetchTx` on NOT_FOUND" | project-mgr Todo (`--next`)                                                                                                    |
| **Timed action** | Yes, at a known time                                        | "Add BlockVision quota on 11-04 23:00"                   | project-mgr Todo; put the time in the title until `21b3e139` adds due dates                                                    |
| **Watch**        | No — waits on a sample, an external event, or a time window | "Wait for the first ≥$50K crash sample"                  | Repo `todo.md` (gate and evidence); a scheduled task when there is a check time. project-mgr only mentions it in `--progress`. |
| **Disclaimer**   | Not work                                                    | "Production deploy not verified this round"              | `--progress` only                                                                                                              |

A watch becomes an action when its gate fires. The agent that observes the gate then records the resulting action with `--next`.

Reconciliation terms (R2):

- **Candidate**: an open item on the same topic as the work being written. Topic only finds candidates; it never decides an outcome.
- **Duplicate**: an item for the same deliverable or the same occurrence. "Implement the quota fallback" and "test the quota fallback" share a topic but are independent actions. Two separate quota renewals are independent occurrences.
- **Supersede**: the new action replaces the old commitment (revised date, decision, or scope). The writer states the evidence for the replacement in `--progress`, for example the newer quota reading or the user's decision.

## Requirements

### R1 — Agent guidance

Update `skills/project-mgr/SKILL.md`, `README.md`, and `README_CN.md`:

- State the classification test and the table above.
- `--next` takes actions and timed actions only. Watches go to `--progress` (topic, gate, next check time, timer id, evidence link). Disclaimers go to `--progress`.
- `--blocker` stays for things that stop an action. A watch is not a blocker unless it stops a named action.
- Do not attach `--next` items that restate the snapshot's own accomplishment, for example "finish upgrading X" on a snapshot reporting that X was upgraded.
- `--status` is the project's status, because the latest snapshot supplies `current.status`. Report a finished milestone in `--summary`/`--progress` and keep `--status active` while project work continues. Use `completed` only with evidence that the whole project is complete. Open Todos do not keep or restore `active`.

### R2 — Reconcile touched commitments

Extend the "Daily open-work checklist" section of the skill:

1. Run `pmgr next --project P --json` before every `add`.
2. For each action being written, list its candidates. Decide each candidate:
   - **duplicate** → keep the existing UID instead of creating a new Todo;
   - **superseded** → `--cancel-todo <old>` plus the new action in the same `add`, with the evidence in `--progress`;
   - **independent** → leave it open.
3. Reconcile only the commitments this write touches. Report suspected duplicates or watches on other topics in the reply and in `--progress` for later triage (R4); do not close them.
4. After the write, run `pmgr next --project P --json` and check that each touched commitment appears once.

**Executable forms (0.5.1 CLI).** `add` rejects `--next` together with `--next-todo` (R4.6 of the previous requirement), so the skill documents these forms:

| Situation                                         | Command                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep a pinned item                                | Nothing; carry mode keeps it                                                                                                                                                                                                    |
| Pin an existing unpinned item, no new work        | `add --next-todo <uid>`                                                                                                                                                                                                         |
| New actions only                                  | `add --next "<title>"`; exact trimmed titles reuse an open Todo — check the returned UIDs                                                                                                                                       |
| Keep or pin an existing item **and** add new work | 1. `todo-add --project P --title "<new>"` for each new action. 2. One `add --next-todo <existing> --next-todo <new> [--cancel-todo <old>]`. Record every UID step 1 returns. On any failure, follow **Failure recovery** below. |
| Reuse by exact title inside a `--next` write      | Allowed only when exactly one open item of P has that title; otherwise use the `todo-add` form                                                                                                                                  |

The `todo-add` form was checked on 0.5.1 against a temporary database: unpinned A and pinned "Quota on Nov 4"; `todo-add` "Quota on Nov 5"; then `add --next-todo <A> --next-todo <new> --cancel-todo <old>`. Result: one new snapshot, A pinned under its original UID, the old quota Todo cancelled, open work exactly A and "Quota on Nov 5".

**Failure recovery for the `todo-add` form.** The form is several commands with one final snapshot. It is not atomic across commands: each `todo-add` commits on its own, and `add` commits its transaction before printing its result, so a reported failure (for example lost output) can follow a committed write. After any failure or uncertain outcome, before retrying or cleaning up:

A staged Todo belongs to this attempt only when its UID came from this attempt's successful `todo-add` output. A title or creation-time match may point to a candidate for investigation, but it never authorizes cancelling it or adopting it into a retry: another writer may have created the same title.

1. Read back `pmgr current --project P --json`, `pmgr todos --project P --json`, and the **complete** history of P: page `pmgr history --project P --limit 100 --offset <n> --json` until a page returns fewer than 100 rows. Do not bound it with `--since`; snapshots can carry a backdated `--at`. A partial window is only a first look and cannot support a claim that something is absent.
2. Decide whether the final `add` committed: some snapshot in the complete history has this write's summary and the staged UIDs in its `nextTodoUids`.
   - **Committed** → the operation succeeded. Keep every staged Todo. Do not retry.
   - **Not committed** → a staged Todo may be cancelled, or reused in a retry, only when its UID was recorded from this attempt's `todo-add` output and no snapshot in the complete history lists it in `nextTodoUids`. A reference in any snapshot, including one later unpinned, means another write adopted it: keep it. Being unpinned now is not proof; unpinned Todos are valid backlog. Cancel with `todo-update --uid <uid> --status cancelled`.
3. If staging failed partway, apply step 2 to the Todos whose UIDs were recorded; do not run the final `add` with an incomplete set unless the writer re-plans it.
4. If the state or the complete history cannot be read, or a `todo-add` output was lost so a UID was not recorded, change nothing for the affected Todos and report the incomplete operation with the UIDs known so far and any title matches found.

### R2a — Watch handoff before retirement

A watch or disclaimer Todo may be retired with `--cancel-todo` during a routine write only when all of these hold:

1. Every gate the Todo still carries has a destination: a repo `todo.md` entry (or an equivalent record named in R3) that states the gate and its evidence link. A Todo bundling several gates needs coverage for each one.
2. Any check time promised by the Todo exists as a scheduled task, identified by its name or id, and verified per the scheduling tool's own rules.
3. The `add` names the destinations and the timer in `--progress`.

If a destination is missing, unreadable, or covers only some gates, keep the Todo open and report the incomplete handoff. Classification alone is not evidence that tracking can stop, and retirement never claims that a gate has passed.

Relation to M3 and R4: a verified handoff is the evidence M3 asks for, so a writer touching that watch's topic may retire it without separate user confirmation. Watches on topics the write does not touch are left for R4.

### R3 — Surface ownership

Document in the skill which surface owns what, so agents stop copying an item to every surface:

| Surface        | Owns                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Repo `todo.md` | The repo's detailed backlog and watch items: gates, evidence, acceptance criteria                                              |
| Scheduled task | When a check runs                                                                                                              |
| project-mgr    | The project's current actions across all repos: short titles, at most about 5 pins, linking to detail rather than repeating it |

### R4 — One-time triage (user-confirmed)

After R1–R3 land, triage projects whose open work contains watches or disclaimers. Each change needs evidence and user confirmation, per M3 of the previous requirement. Retiring a watch follows R2a. This review and this document are not approval for any row below.

Proposed for `sui-liquidate` (open work as of 2026-11-03):

| Todo                                                          | Kind                  | Proposal                                         | Evidence still needed                                                                                                                   |
| ------------------------------------------------------------- | --------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ffa73775` BlockVision quota, 11-04 23:00                     | Timed action          | Keep                                             | — (the quota policy itself is the user's decision, not part of triage)                                                                  |
| `1bb055f5` Navi NOT_FOUND backoff (P2)                        | Action                | Keep                                             | —                                                                                                                                       |
| `f686a4de` wait for race/timeout/fee/DeepBook samples         | Watch, four gates     | Retire per R2a                                   | Repo `todo.md` coverage for each of the four gates; overlaps `fe6e99e4`                                                                 |
| `fe6e99e4` wait for first ≥$50K crash sample                  | Watch                 | Retire per R2a                                   | Repo `todo.md` coverage of the ≥$50K gate                                                                                               |
| `9372df0f` Suilend SDK 14.2.0 changelog, local tests, upgrade | Action, possibly done | Complete only if all three commitments are shown | `package.json` pins `14.2.0` and snapshot `8749fb8e` reports the upgrade; changelog evaluation and local test results are not yet shown |

Candidates in other projects, to check case by case: `meme-pipeline`, `svr-watch`, `morpho`, `personal-ip`, `hype-carry-paper`, `negrisk-basket` ("2026-11-04 weekly read-only review window").

## Out-of-repo follow-up

- The `sui-liquidate` daily-report runbook should map its "next steps" section by the Definitions table instead of copying it into `--next`. That change belongs to the `sui-liquidate` repo.

## Acceptance criteria

1. The skill and both READMEs contain the classification test, the surface-ownership table, and the R2 procedure.
2. An agent following the skill on a scenario like "wait for the first ≥$50K sample, recheck tomorrow 08:00" writes no `--next`, and its `--progress` names the gate, check time, and timer.
3. Revised timed action: with action A kept and dated action B superseded, one new snapshot results; A keeps its UID, old B is cancelled, and open work is exactly A and the new B. Run it once with A pinned and once with A unpinned (the `todo-add` form).
4. Two independent actions on one topic both stay open after a write touching that topic. An unrelated pre-existing duplicate is reported, not closed.
5. Watch handoff: a watch with no destination stays open; a multi-gate watch with partial coverage stays open; a fully covered watch is retired, and `--progress` names the destinations without claiming the gate passed.
6. Failure recovery for the `todo-add` form:
   - final `add` rejected (for example an invalid `--cancel-todo` UID) → readback shows no new snapshot; staged Todos created by this attempt are cancelled or reused on retry, and nothing else changes;
   - staging fails after some `todo-add` calls → only the Todos that were created are handled, per step 2;
   - final `add` committed but its output is lost (simulated by a throwing output callback) → readback finds the snapshot; no staged Todo is cancelled and no retry happens;
   - state unreadable or a staged Todo's origin unknown → no change, incomplete operation reported;
   - this attempt's `todo-add` fails before writing and another writer then creates a Todo with the same title → that Todo is reported as a title match and left open;
   - a staged Todo adopted by another writer and then unpinned by more than five later snapshots → the complete-history read finds the reference and the Todo stays open.
7. Milestone with remaining work: the snapshot has a completion summary and `--status active`, and `current` stays `active`.
8. After R4 triage, `pmgr next --project sui-liquidate --json` lists only actions and timed actions.
9. If no code changes: docs-only diff. If code changes (see open questions): `pnpm test`, `tsc --noEmit`, and ESLint pass.

## Open questions

- **A dedicated watch field.** Option: a snapshot-level `--watch` string list (replace semantics, never creates Todos), shown by `current` but not by `pmgr next`. Default: **no**. Start with R1–R3 and repo `todo.md`. Revisit if agents keep putting watches in `--next` after the guidance change, or if a cross-project "what am I waiting on" view is needed.
- **Write-time warning.** Option: `add` prints a warning when a `--next` title shares a long common substring with an open item of the same project. Default: **no**, because the previous requirement excluded fuzzy matching and a noisy warning trains agents to ignore it. Revisit with data from post-change usage.
- **`completed` snapshot with new `--next`.** Option: reject or warn when `--status completed` has `--next`. Default: **no** blanket rejection. A `completed` snapshot means the project is completed (R1), and a completed project can still record follow-up work, for example a post-release check. Misuse of `completed` for a milestone is covered by the R1 status rule, not by validation.

## Scope

R1–R3 are implemented in `skills/project-mgr/SKILL.md`, `README.md`, `README_CN.md`, and `docs/architecture.md`. No commit or release is implied by this document.

## R4 triage result (2026-11-03)

The user authorized the full cleanup. Every change was written with `--source agent` and its evidence in `--progress`:

- `sui-liquidate`: `9372df0f` completed (changelog diff, local tests, and commit `df5814d1` in the repo's 2026-10-31 SDK review; deployed 10-31). `f686a4de` and `fe6e99e4` retired after the three open gates were added to the repo `todo.md`, tracked by the daily-report scheduled task; the Suilend timeout gate had already passed. Open work: `ffa73775`, `1bb055f5`.
- `morpho`: `edd18e33` completed (root check passed and pushed per the repo `todo.md`). The live automation recheck and the formal-run action stay.
- `meme-pipeline`: B1 acceptance watches `4cf31398` and its duplicate `a925d4b3` retired to the repo `todo.md`; the 429 root-cause action stays.
- `teaching`: the TTS action was converted to a Todo and kept; the "commits not pushed" state line was dropped from open work.
- Legacy next steps with no commitment, or with gates recorded in a repo `todo.md`, were unpinned with `--replace-next` in 10 projects: `metric-arbitrage-research`, `hyperevm-shadow`, `antigravity`, `arc-shadow`, `polymarket-perps-research`, `personal-ip`, `svr-watch`, `liqs-hyperlend-shadow`, `feed-reader-skill`, `hype-carry-paper`.
- Kept and reported, because no destination for their gates was found (R2a): `weather-arb` (Värmland settlement write-off), `soccer-exact-score` (stale preflight automation), `meme-pipeline` `2ebd45a0` (title lost its token names). The user then decided to cancel all three; they were removed the same day. `xiaoyuzhou` mixes a watch with cross-platform verification work and was kept. Actions were kept unchanged, as were the unassigned personal Todos.
