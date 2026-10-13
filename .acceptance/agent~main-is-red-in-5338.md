Closes a11ign/a11ign#5338

Acceptance: `cd /home/agent/repos/lab-wt-5338 && bash -c 'test "$(git show HEAD:baselines/layer-edges.baseline.json | grep -c "release-checks.yml")" -ge 2'` (the row's own command, run in this branch's worktree: its `cd ~/repos/lab` form reads the primary checkout, a detached HEAD at `origin/main`, which is FALSE until this merges). Exit 0 at this head; at `origin/main` (`71e724e7`) the same count is 0. The row's Done-when 1 is that same command against `origin/main` after the merge, hand-run then.

This is the row's own check: `origin/main` names both edges `release-checks.yml` reads out of the core's checkout (`packages/scorer/models/screenreader-scorer` and `packages/scorer/package.json`).

Mutation, run in a scratch core checkout at the pinned `CORE_REF` (2b8489a8d) with this lab laid over `packages/lab` as CI does:
- Before the two entries: `layer-edges.test.ts` "the lab's edges agree with its own baseline" FAILS with exactly the two `NEW EDGE out: packages/lab/.github/workflows/release-checks.yml -> …` lines from the failing run (lab#103, 38328924450). 35 tests run, 34 pass, 1 fails.
- After: 35 of 35 pass.
- Drop the `package.json` entry: the test FAILS naming only that edge as NEW.
- Add a bogus `release-checks.yml` entry to a file that does not exist: the test FAILS naming it as STALE.
- Restoring the file from this branch, byte-identical (`cmp`), the test passes again.

Not run here: the lab's full `pnpm test`. The lab has no lockfile and its manifest names packages no registry holds, so it does not install standalone; CI's `checks (cross-repo)` leg is where that runs. The one test that reads this baseline ran as CI runs it.
