## Independent local review — canonical report

**Assessment:** L1 is fixed and independently verified. L2 remains an unresolved requirements conflict. No additional correctness findings were identified. Full acceptance remains pending the L2 disposition.

### L1 / P1 — Invalid Todo provenance after carry

**Original finding:** Before the fix, `src/db.ts:556–562` saved each new Todo’s `stepIndex` using its input `nextSteps` index. Carried refs can precede those new Todos. Writing A, then carrying A while adding B, produced snapshot refs `[A,B]` but recorded B with `stepIndex: 0`.

**Impact:** Export succeeded, but importing that export into a clean `:memory:` ledger failed with `invalid next step index`. The unchanged strict importer requires `entry.nextTodoUids[todo.stepIndex] === todo.uid` at `src/db.ts:1460–1462`. This broke portable round trips for ordinary CLI append workflows.

**Current disposition: CLOSED.** The fix at `src/db.ts:562` saves `nextTodoUids.indexOf(uid)` after carry and deduplication. New Todo UIDs are unique and included in the final refs, so this preserves the existing source/index invariant without weakening import validation.

The new regression at `test/open-work.test.ts:775–806` combines carry, reuse, duplicate titles, export/import equality, and a subsequent carry write. I independently verified clean-memory round trips for new-title inputs:

- `["B"]`
- `["A","B"]`
- `["B","A"]`
- `["A","B","A"]`
- `["B","B"]`

Each independent case also carried an open A and filtered a cancelled prior pin. New Todo provenance matched the final snapshot refs, and exported bundles round-tripped unchanged.

### L2 / P2 — Carry deduplication conflicts with strict-suffix retry identity

**Original finding:** `src/db.ts:537–543` implements R4.1’s first-occurrence UID deduplication. `src/db.ts:427–434` implements R4.5’s strict stored-suffix comparison.

With current pins `[A,B]`, a fixed-UID carry write naming A succeeds and retains `[A,B]`. The identical retry throws `conflicting entry uid` because A is not the final suffix. This independently reproduces with both `nextSteps:["A"]` and `nextTodoUids:[A.uid]`.

**Impact:** Some successful fixed-UID carry writes cannot be retried idempotently.

**Current disposition: OPEN — requirements clarification.** The implementation follows the explicit strict-suffix rule, but that rule conflicts with the broader carry-idempotence requirement when R4.1 retains a reused UID at an earlier position. Strict suffix remains implemented while clarification is pending.

**Suggested resolution:** Explicitly choose the intended identity rule, then test carried-position text reuse and explicit refs, multiple UID ordering, changed non-next fields, and retries after Todo status changes. Avoid accepting arbitrary title matches that would weaken identity conflict detection.

### Verification and version boundaries

Initial independent validation passed **56/56 tests**, TypeScript, and ESLint while both reproductions still failed. Passing tests therefore did not establish correctness.

After the author’s L1 fix and added regression:

- `pnpm test`: **57/57 passed**
- `pnpm exec tsc --noEmit`: passed
- `pnpm exec eslint .`: passed
- Independent L1 provenance/round-trip matrix: passed
- Independent L2 text and ref reproductions: remain reproducible

Reviewed final `git diff HEAD -- src/db.ts` SHA-256: `80539f976d46b00182e5ed296f808681626271d09d04946ac12ebf4bcf681af9`.

Reviewed `test/open-work.test.ts` SHA-256: `feb49f6a945c12bdbb20393252055c925c941064004cba2d2ac690fac5ab52c2`.

### Coverage and limitations

Read the complete requirements and Round 0, all requested implementation/documentation diffs, new tests, and related domain/index, Todo lifecycle, import/export, completion, and CLI transaction paths. Checked closure ownership and rollback, external-ref replay, legacy preservation/conversion, carry/reuse/deduplication, open-work ordering, and strict portable identity boundaries.

The author added tests and fixed L1 during the review; the original finding and subsequent disposition are preserved above. Generated evidence files were excluded from code findings.

No reviewer edits, staging, commits, publishing, project-status writes, real-ledger access, sensitive-file access, external-review invocation, or external network tool use occurred. Tests used isolated memory or temporary ledgers.

---

Confirmed: the provenance comment and explicit strict-suffix text/ref regression do not change the review dispositions. **L1 remains CLOSED; L2 remains OPEN pending requirements clarification.** No new concern or test rerun.

Updated SHA-256 values:

- `git diff HEAD -- src/db.ts`: `acdbbf3bc0073ec27416cafa29106f47677e045eb1ac2d71d157955fc655472a`
- `test/open-work.test.ts`: `fdcbf22c2abb5ef4523a21b6c6a72cf44818c527ca39180ed8981f6f2b6c2e83`
