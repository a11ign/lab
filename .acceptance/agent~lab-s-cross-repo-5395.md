Closes a11ign/a11ign#5395

Acceptance: `bash -c 'node --test src/packaging/row-claim.test.ts src/packaging/cross-repo-tests.test.ts'` (run from the lab root, laid at `core/packages/lab` beside a core checkout at `2b8489a8d`, because `row-claim.test.ts` reads the core's tree and `~/repos/lab` has no core layout and no lockfile). Measured in that layout against agent-org v0.191.0: `ℹ tests 157 / pass 157 / fail 0`, exit 0.

## What changes
`src/packaging/row-claim.test.ts` only. The mock of the tool's `gh` calls now answers the reads agent-org v0.191.0 makes:
- the label read is REST `gh api repos/<repo>/issues/<n>` (agent-org#1302), not `issue view`; the mock answers it with `state` in lower case, which `fetchLabels` maps up;
- the comment read is REST `gh api repos/<repo>/issues/<n>/comments --paginate --slurp`, which returns one array of pages.

`isLabelRead` and `isIssueRead` name those reads, so the existing tests that matched `args[1] === "view"` now match both shapes.

**Contract change, #1432 (stated plainly):** the test "an existing LOCAL branch is refused ... naming the claim record's session" is rewritten. agent-org#1285 ADOPTS a local branch that the row's own claim record names, so the old expectation no longer holds. The test now uses a branch no record names (`agent/other-1432`) and asserts the refusal reason says the newest record does not name the branch. The adoption path is pinned in the tool's own `row-claim-existing-branch.test.ts`, not here.

## Evidence (measured)
- RED: baseline against v0.191.0, `ℹ tests 157 / pass 103 / fail 54`.
- GREEN: `ℹ tests 157 / pass 157 / fail 0`, exit 0.
- Mutation M1 (a mutated copy of the test file): `ℹ fail 51`, including the unclaimed-row claim test.
- Mutation M2 (a mutated copy of the test file): `ℹ fail 1`, the #1432 local-branch test.

## Done-when (2): what red remains on lab main
Newest lab main push run that reached the cross-repo leg: ci run 38376549284, head `fd7bd047`, `checks (cross-repo)` = failure, `Test Files 2 failed | 225 passed (227)`.
- `src/packaging/row-claim.test.ts`: this change.
- `layer-edges.test.ts`: NOT fixed here. Owner a11ign/a11ign#5187 (closed). Its change to `SCORER_PACKAGE` in `scripts/evaluate-screenreader-acceptance.py` made the baseline entry for `packages/lab/scripts/evaluate-screenreader-acceptance.py -> packages/scorer/models/screenreader-scorer` stale; line 4 of `baselines/layer-edges.baseline.json` should be removed by whichever row takes that fix.

## Not done / open
- The PR-head `checks (cross-repo)` run has not been observed yet; this file does not claim it.
- Layout sweep of all 227 cross-repo files in the scratch layout is NOT the leg's verdict (no real core there), and is not cited as one.

no-release: a test file only, nothing shipped changes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
