# Web UI internationalization review

Date: 2026-10-16 (Asia/Shanghai)
Reviewer: Codex, current review session
Baseline: `5a708449f1bccda43f48e4c6589df076f37cf886`
Status: complete for source review and automated validation.

## Scope and conclusion

Reviewed the unstaged changes to `src/web/ui.ts` and `test/server.test.ts`,
and the new `src/web/i18n.ts`, `src/web/script.ts`, `src/web/styles.ts`,
`src/web/locales/en.ts`, and `src/web/locales/zh.ts` files. The request was to
review the multilingual changes and directly fix any confirmed issues.

No actionable defects attributable to these changes were found. No implementation
changes were necessary. Existing working-tree changes were preserved.

## Evidence and coverage

- Compared the extracted script and styles against the original inline sections
  in `git show HEAD:src/web/ui.ts`. Differences were confined to localization,
  localized status searching, and language-switch layout.
- Traced `src/server.ts` root/index routes to the HTML generator and browser script.
  The server renders Chinese by default; the browser restores only supported saved
  locales, updates static labels and document language, and rerenders dynamic data.
- Checked both dictionaries against the status and source enums in `src/domain.ts`.
  All current enum values are covered. Unknown values retain the raw fallback.
- Checked translated project cards, grouped/flat activity rendering, localized
  timestamps, date filtering, search, empty states, and existing HTML escaping.
- Read the VM-based browser-script tests: Chinese/English switching, saved language,
  invalid switch requests, unavailable storage on startup, dynamic labels, localized
  status search, and unknown enum fallback are exercised.

## Validation

- `pnpm test`: 11 tests passed.
- `pnpm coverage`: passed all configured 100% thresholds.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm exec prettier --check src/web test/server.test.ts`: passed.
- `pnpm build`: passed.
- `git diff --check`: passed.

The coverage totals describe instrumented TypeScript; inline JavaScript is stored
in template strings, so they do not establish complete browser-branch coverage.
The VM tests exercise that script with a mock DOM. No real-browser visual,
keyboard, or screen-reader acceptance test was performed. No commit, push, or
deployment was performed.
