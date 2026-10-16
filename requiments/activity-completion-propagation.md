# Activity completion propagation

Status: Revised after CC re-review; ready for implementation
Date: 2026-10-16

## Problem

Activity entries are append-only status snapshots. Later work can finish the work described by earlier entries, but those entries continue to display ACTIVE. Readers cannot distinguish completed work from outstanding work.

Showing only “Superseded” does not satisfy this requirement. When later work completes an earlier activity, that activity must visibly show “Completed”. A single follow-up may complete multiple earlier activities.

## Required behavior

1. A follow-up entry can explicitly identify one or more earlier entries whose work it completes.
2. Each identified entry displays **已完成 / Completed** as its effective activity state, with a link to the follow-up that completed it.
3. Preserve the original entry, including its status, text, timestamps, blockers, and next steps. Retain the original status as historical context without presenting it as the primary current activity badge.
4. Record completion through an append-only relationship or event, rather than rewriting the historical snapshot. The exact storage and API design is subject to review.
5. Completion must be explicit. A newer entry, shared project name, or words such as “deployed” do not by themselves complete earlier entries. The author must identify the entries whose outstanding work has actually been completed.
6. Partial progress does not mark the whole earlier activity Completed. Remaining work must stay visible. A separate partial-completion workflow is not required for the initial implementation.
7. The latest project snapshot remains the source of the project's current status. Completing an earlier activity does not automatically complete the project or change the latest snapshot's status.
8. For entries that are not the latest snapshot, “已有后续更新 / Superseded” may indicate that a newer project snapshot exists. This label is independent of completion: it must not imply that the earlier work is finished, and a completed entry may show both labels. Only the latest snapshot is labeled “当前状态 / Current status”.

## Example

An earlier `sui-liquidate` activity records a review and lists report corrections, deployment, and natural-sample acceptance as follow-up work.

- If the later entry confirms only corrections, commit, and deployment, the earlier activity is not yet fully completed if natural-sample acceptance is still outstanding.
- Once all outstanding work covered by that activity is completed and explicitly linked, the earlier card displays **已完成 / Completed**, with “Completed by [follow-up entry]”.
- Its original review content, original ACTIVE status, and original next steps remain available as historical context.
- The same follow-up can complete other explicitly selected earlier activities. It must not close unrelated activities in the project.

## Acceptance criteria

- A follow-up completing one earlier ACTIVE entry makes that earlier entry display Completed.
- A follow-up can complete multiple earlier entries; all selected entries update consistently.
- Unselected entries retain their effective state, even within the same project.
- Adding a newer entry without completion links does not mark earlier entries Completed.
- Incomplete work is not implicitly closed by a commit or deployment update.
- History preserves original contents and provides a navigable completion source.
- Grouped and flat activity views show the same effective completion state.
- Date filters and pagination do not lose a completion relationship merely because the follow-up is outside the visible results.
- Project current-state queries still select the latest snapshot; activity completion does not alter that selection.
- Existing records remain readable without bulk rewriting or automatically classifying historical work.
- Invalid references, self-references, and duplicate completion requests are handled explicitly and safely, without partial writes or duplicate visible completion links.
- Chinese and English labels communicate the same distinction between original state, effective completion, and project current state.

## Decisions after review

- Keep the primary effective badge **已完成 / Completed**, as requested. Always accompany propagated completion with “由后续动态完成 / Completed by follow-up” and its link. Original snapshot status is secondary historical context. An originally completed snapshot must never be classified as open merely because it has no completion link.
- An explicit completion asserts that all outstanding commitments described by the entry are resolved, including its next steps and blockers. The author assesses this; the system does not infer completion from prose. Entries without those lists can still be linked when the work described in their summary/progress is complete. Original completed or archived status does not prohibit an explicit link; archived alone does not mean completed.
- Preserve snapshots and store completion and revocation as append-only events. Require a reason for revocation. Allow at most one effective completion source per target; repeating the same active link is a no-op, while a different source requires explicit revocation first.
- Links stay within a project and cannot target the source itself. A target's occurrence time must be strictly earlier than its follow-up's; links between snapshots with equal occurrence timestamps are rejected, so link validation never depends on destination-local numeric IDs.
- Add portable identities for entries and completion events. Backfilling identifiers is permitted without changing historical content. Export/import must preserve identities, event order, timestamps, revocations, and links; repeated imports are idempotent. Conflicting content under an existing identity must fail explicitly. Legacy entry-only imports remain supported.
- CLI writes create a follow-up and its completion links atomically, with separate operations to link an existing follow-up and revoke a mistaken link. Invalid input rolls back the entire operation. Keep HTTP writes out of scope; the existing HTTP API remains read-only.
- Resolve completion evidence in the shared database/read layer, independently of the rows loaded by a client. Expose original status separately from completion evidence; consumers derive the displayed state without overwriting the original status. Do not equate “no completion link” with “outstanding work”.
- History date filters select which snapshots are visible, while their completion annotations show today's effective result. Include both the follow-up occurrence time and the completion event recording time in evidence. Current/superseded markers use the full project history, not the filtered page. Completion and snapshot recency are independent labels, not a precedence chain that hides one of them.
- Historical as-of completion views are deferred. The existing `at` query returns only the latest snapshot at T, which can never carry a completion annotation, so no current query would exercise an as-of completion cutoff. `at` keeps its current behavior and does not return completion evidence. Completion and revocation events still record their recording time, so an as-of activity view (for example `history --as-of T`) can be added later without schema changes.
- Update agent instructions to inspect original state and completion evidence before linking predecessors. A commit or deployment may complete an entry if it resolves all that entry's commitments; it is insufficient when further acceptance remains outstanding.

## Additional acceptance criteria

- An original completed snapshot without a completion link still displays Completed and is not returned as open solely due to the missing link.
- Propagated completion always displays its source; the original status remains inspectable.
- Completion and revocation survive export/import, including repeated imports and equal-time snapshots, without changing the effective result.
- Identity conflicts fail explicitly and atomically.
- Revocation restores the target's underlying snapshot state and preserves the completion audit trail.
- A current snapshot marker is not assigned merely because an entry is newest within a filtered page.

## Implementation details to finalize

- Exact schema, column names, and command/flag names for completion links and revocation.
- Serialization format for entry identities and completion events in export/import, including how legacy entry-only files are detected.
- Update agent usage instructions so authors inspect original state and completion evidence, then explicitly identify completed predecessors when recording follow-up work.

## Deferred

- As-of completion cutoff and an as-of activity query (see “Decisions after review”).

## Scope

Implementation is authorized following requirements review. Historical record reconciliation, commit, push, and deployment remain outside this change. The consolidated review is in [reviews/activity-completion-propagation.md](../reviews/activity-completion-propagation.md). The directory name `requiments` follows the user's requested spelling.
