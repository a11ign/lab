Closes a11ign/a11ign#5571

Acceptance: `cd ~/repos/lab && AGENT_ORG_TOOL=<a checkout of agent-org at v0.210.2 or newer> node --test --test-skip-pattern='#1453 ACCEPTANCE' --test-skip-pattern='#2505: .session:worker-capture' --test-skip-pattern='#1951: a .live. entry is a ROLE' --test-skip-pattern='#1453: a retired session is refused' --test-skip-pattern='#1453 STRUCTURAL' src/packaging/arm-pr.test.ts` (the row's command, run from the checkout of this branch). Measured at agent-org v0.210.2: `tests 73 / pass 73 / fail 0`. The five skipped tests read `../../../../.agent-org/roles/sessions.json`, which exists only at the core layout; unskipped, the same run is `tests 78 / pass 73 / fail 5`, the five `ENOENT` cases. Control at v0.206.8: `tests 73 / pass 71 / fail 2`, the two new `#1501` cases, which that tag cannot answer because `deliberateRefusalVerdict` does not exist there. Positive control, the unmodified test file on `main` (65a715e8) at v0.210.2 under the same skip flags: `tests 71 / pass 47 / fail 24`, the 24 deliberate-read failures.

## What changes

The `run` stubs in `arm-pr.test.ts` answer the reads `deliberateRefusalVerdict` makes (agent-org#1501): the pull request as an org author whose head is the branch tip, the branch ref, no reviews, no added files, a comparison of one commit ahead, the row #725 as `session:worker-4`, and the closing references of a `Closes a11ign/a11ign#725` body (the cross-repo form, which GitHub honours). Two new cases: `refused` (the branch has moved past the head) asserts exit `DONE` and no arming write, and `cannot-ask` (the pull request is unreadable) asserts exit `CANNOT_ASK` and no write at all. The refusal posts its announcement comment by design; the test does not count that comment as a write.

## Evidence

- agent-org is not changed. The tag is not pinned back, and #129 is not reverted.
- The `refused` case now asserts the refusal's own reason (`GITHUB'S HEAD IS NOT THE BRANCH TIP`), not any line naming the PR.
- No TypeScript compiler or ESLint is installed in this checkout and none is installed here, so `tsc` and lint were not run. The test file runs under Node's type stripping.

Mutation: `if (deliberate.kind !== "clear")` in agent-org's `src/arm-pr.ts` made `false &&` (never fires) fails exactly the two `#1501` cases (`tests 73 / pass 71 / fail 2`); made `true ||` (always fires) fails 24 clear-path cases and no `#1501` case (`pass 49 / fail 24`). Each restored with `cp`, `cmp` identical.

Outside-Region: none
Fleet: No.
