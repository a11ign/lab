Closes a11ign/a11ign#5571

Acceptance: `node --test src/packaging/arm-pr.test.ts`, run from `packages/lab` of a core checkout with this tree laid there as `packages/lab` (as CI does), with `AGENT_ORG_TOOL` set to an agent-org checkout at v0.210.2. The row's literal form, run from a standalone lab checkout, fails the five sessions-file tests (`#1453`, `#2505`, `#1951`, `#1453 STRUCTURAL`): `SESSIONS_FILE` resolves to `../../../../.agent-org/roles/sessions.json`, which exists only at the core layout. Measured in a laid core with `AGENT_ORG_TOOL` at v0.210.2: `tests 78 / pass 78 / fail 0`. Control at v0.206.8: `tests 78 / pass 76 / fail 2`, the two new `#1501` cases, which that tag cannot answer because `deliberateRefusalVerdict` does not exist there. Positive control, the unmodified test file on `main` at v0.210.2 in the same layout: `tests 76 / pass 52 / fail 24`, the 24 deliberate-read failures.

## What changes

The `run` stubs in `arm-pr.test.ts` answer the reads `deliberateRefusalVerdict` makes (agent-org#1501): the pull request as an org author whose head is the branch tip, the branch ref, no reviews, no added files, a comparison of one commit ahead, the row #725 as `session:worker-4`, and the closing references of a `Closes a11ign/a11ign#725` body (the cross-repo form, which GitHub honours). Two new cases: `refused` (the branch has moved past the head) asserts exit `DONE` and no arming write, and `cannot-ask` (the pull request is unreadable) asserts exit `CANNOT_ASK` and no write at all. The refusal posts its announcement comment by design; the test does not count that comment as a write.

## Evidence

- `layout-check`: `ok (819 files read)`.
- agent-org is not changed. The tag is not pinned back, and #129 is not reverted.
- No TypeScript compiler or ESLint is installed in this checkout and none is installed here, so `tsc` and lint were not run. The test file runs under Node's type stripping.

Outside-Region: none
Fleet: No.
