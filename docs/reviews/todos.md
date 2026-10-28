# Independent Todos and dashboard completion review

Date: 2026-10-26 (Asia/Shanghai)
Base: `a3cf9e822c2203da132c4e82756cf2845769ac1c`
Requirements: [Independent Todos](../../requiments/todos.md)

## Scope and execution

The working tree was initially clean. Scope includes domain/database migration,
CLI, HTTP mutation routes, dashboard and translations, regression tests, README,
architecture, and changelog. No commit, package upgrade, deployment, or production
schema migration was performed.

Claude Code 2.1.292 was invoked with Sonnet/high, read-only instructions, and the
approved source-only scope. The provider rejected the request with HTTP 429
`usage_limit_reached` (weekly limit). Exit code 1; actual inference model unknown.
Claude review status: **failed**, not passed. See [prompt](evidence/todos/prompt.txt),
[execution](evidence/todos/execution.txt), and [provider result](evidence/todos/claude-result.json).

An independent Codex session performed three read-only review rounds as a fallback.
This was a same-model independent review, not a successful cross-model review.
Actual model/effort were not available to the reviewer. It inspected complete
changed paths and executed isolated in-memory reproductions; it did not independently
rerun the full test suite or browser scenarios.

Original reports are retained verbatim in [fallback reports](evidence/todos/fallback-original.txt).

## Original reviewer findings (English translation)

### Round 1

- **F1 / P1:** `completeActivity` created the latest snapshot using only status and
  summary, dropping current progress, blockers, next steps, decisions, and tags.
  Completing an unrelated older activity cleared the current approval blocker in
  an in-memory reproduction. Preserve current context without generating new Todos.
- **F2 / P2:** Decoding each HTTP Buffer separately corrupted Chinese characters
  split across chunks. A split title containing Chinese reproduced replacement
  characters. Accumulate raw bytes and decode once, with a byte limit.
- **F3 / P2:** Fetch failures were shown only in the activity panel and swallowed.
  Todo creation then cleared input despite failing to refresh, leaving the user
  uncertain and risking repeat creation. Show global errors and distinguish a
  successful write from a failed refresh.
- **F4 / P2:** `select.value || activeProjectFilter` overwrote an explicit unassigned
  selection whenever the project-filtered view rerendered. Default only on explicit
  project navigation, preserving empty selections across renders.
- Navigation observation: refresh after mutation repeatedly applied the deep-link
  activity tab, unexpectedly switching away from Todos.

### Round 2

F2–F4 and the navigation issue were fixed. F1 preserved context but introduced:

- **F5 / P2:** Copied next steps on completion follow-ups had a new source UUID and
  appeared independently convertible. Converting the copy increased the Todo count
  from one to two. Preserve source identity in both UI and server-side conversion.

### Round 3

F1–F5 are fixed; no new valid blocking findings. Independently verified consecutive
completion follow-ups retain the original source, copied-step conversion returns
existing Todos without increasing count, and export/import preserves identities.
Review status: **complete for the fallback scope**, with the limitations above.

## Coder disposition

All five findings were accepted and fixed. Completion follow-ups preserve current
snapshot context and carry a validated direct `nextStepsSourceUid`. Conversion and
rendering reuse the original source. Request bodies are accumulated as bounded
bytes. Fetch failures are global; successful saves with failed refresh have an
explicit message. Form selection and current tab survive refreshes.

## Final verification

- `pnpm test`: 23 tests passed, including legacy conversion, independent completion,
  snapshot preservation, retry behavior, portability/conflict rollback, CLI,
  HTTP origin/content/size checks, chunked Chinese, and UI error/selection regression.
- `pnpm typecheck`, `pnpm build`, `pnpm lint`, touched-file Prettier check, and
  `git diff --check`: passed.
- Browser against isolated temporary SQLite databases: standalone creation,
  completion and persistence after reload; project assignment/filtering; source
  links; activity completion leaving Todos open; Chinese/English switching;
  explicit unassigned selection preserved; deep-link refresh stays on Todos.
- Final browser regression: completing an activity produced zero duplicate
  conversion buttons and retained exactly one open source Todo, with no action error.
- Browser showed no application JavaScript errors. An initial favicon 404 was
  unrelated; browser-environment warnings were not treated as application failures.

The installed dashboard has not been upgraded or restarted. Release/deployment
acceptance and successful Claude cross-review remain separate from local validation.
