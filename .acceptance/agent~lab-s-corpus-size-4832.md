Closes a11ign/a11ign#4832

History: full

Acceptance: `bash -c 'git -C ../.. cat-file -e d9521699e^{commit} && git -C ../.. show d9521699e:packages/control/src/fleet-status.mjs >/dev/null && node --test src/gates/corpus-size-figures.test.ts'` (the row's own command with its path corrected to the name the file had at that commit, then the control that reads it; run in a lab worktree laid at `packages/lab` of a FULL-history core checkout, the only place `d9521699e` exists and `REPO_ROOT` is the core)

Mutation: `flagged` made to never flag, then to always flag, then `fleet-status.mjs` dropped from `REGION_AT_BASE_2155` -- each went red in `CONTROL ON REAL HISTORY` (5, 4 and 1 test(s) failing), and the file was restored by `cp` and `diff`ed identical.

## What changes
`REGION_AT_BASE_2155`, the list `CONTROL ON REAL HISTORY: 9 of d9521699e's 10 figures are flagged` reads out of git, named `packages/control/src/fleet-status.ts`, which `d9521699e` does not hold: the file was `fleet-status.mjs` there, and `git show` threw, so the control was red in every checkout holding the commit and passed (skipped) only where it was absent. The list is now the five paths that commit holds, written out rather than derived from `GUARDED_2155`, so the control reads `fleet-status.mjs`. The guard's own list (`GUARDED_2155`) and every assertion are unchanged.

## Evidence
Measured at this head, lab `019a00ad` laid at `packages/lab` of core `e677b97b1` (a full-history checkout), Node 24.21.0, `node --test src/gates/corpus-size-figures.test.ts`:
- Before: 7 tests, 6 pass, 1 FAIL (`CONTROL ON REAL HISTORY: 9 of d9521699e's 10 figures are flagged`, `git show d9521699e:packages/control/src/fleet-status.ts` exit 128).
- After: 7 tests, 7 pass, 0 skipped. **The figure counts were re-derived by the control itself, not edited to fit**: the population at `d9521699e` is still 10 corpus-size figures and 9 are flagged, and the dated one is still the sample status block.
- Mutation, three runs, the file restored by `cp` and `diff`ed identical after: (1) `flagged` never flags: 5 fail, including the control; (2) `flagged` always flags: 4 fail, including the control; (3) `fleet-status.mjs` dropped from the list: the control alone fails, so the entry is read and counted.
- `packages/control` was laid for the run as a symlink to a sibling worktree's control at v0.3.5 (the core pins v0.3.6): the first test reads `fleet-status.ts` from the working tree, and only its existence matters to it.
- Not run: the rest of the lab's suite, lint and the typecheck (a one-list edit in a test file; CI's `checks` runs them). Resource ban respected: no `fleet:*`, `lab:*`, `worker:*` or gate run.

## Not done
- Nothing in the PR makes the control run in CI: the `own` leg checks out at depth 2, where `d9521699e` is absent and the control skips by design (named in a11ign/lab#62). It is a control a full-history session now sees pass, which is what the row asked for.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
