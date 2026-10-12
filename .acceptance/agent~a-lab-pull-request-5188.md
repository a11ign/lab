Closes a11ign/a11ign#5188

Acceptance: `grep -c "Cross-repo-red" .github/workflows/auto-arm.yml`

Run from this worktree of lab: prints `7` (0 at origin/main 4499f6df, the row's Open-check).

**Which arming paths it covers: all three, by two jobs.** `arm` (the sweep: on `opened`, `ready_for_review`, `reopened`, `synchronize`, now `edited`, and on `push` to `main`) and `arm-approved` (an approving review, via `relay`) both load ONE text, the workflow-level `CROSS_REPO_RED_LIB`, and ask `cross_repo_gate` before they arm; `arm-approved` asks before it marks a draft ready as well. **Dependabot has no path of its own**: its pull requests are in `arm`'s listing (`pull_request_target` runs `main`'s copy with a write token) and are approved through `arm-approved` like any other, so the three are covered. Not covered: a pull request armed by hand or by the previous copy of this file, which the jq filter skips as already armed.

**Run once against lab#92's head** (`ebc0fe82`, leg `failure`; real API reads, the comment poster not reached):

```
newest trunk run now: 38218432835            (leg failure, on the same test file: layer-edges.test.ts)
lab#92, newest trunk run now:                clear|-
lab#92, against push run 38210583502 (06:01:51Z, leg success):
                                             red|the newest push run on main (https://github.com/a11ign/lab/actions/runs/38210583502) had the leg `success`, and its body carries no `Cross-repo-red:` line
```

So the refusal fires on lab#92 against the trunk it merged onto, and says `clear` against today's, which is red on the same file (lab#92 itself put it there).

**The row's premise needed one addition, and the change carries it.** "Refuse to arm a pull request whose leg concluded `failure`" would NOT have stopped lab#92: `arm` armed it at 07:17:55Z, at `opened`, 4m21s before its leg concluded (07:22:16Z), and the approval at 07:28:54Z found it "already armed" (`arm-approved` skipped). The same holds for every pull request, since the leg takes about five minutes and the sweep fires in the first second. So the gate WAITS for a leg that has not concluded (up to ten minutes, `CROSS_REPO_DEADLINE`) and leaves the pull request unarmed after that; the next `push` to `main`, a body edit or an approving review asks again. Measured from the check runs of `ebc0fe82` and runs 38216941304 / 38210583502 / 38218432835 (read with `gh api`, 2026-10-12).

**Known gap, filed rather than worked around (a11ign/a11ign#5188's comment names the row):** agent-org#1045 compares failing test FILES; this does not. That needs the job log, which takes `actions: read`, and `auto-arm-octo-sts.test.ts` pins the minting jobs at `id-token: write` and no `github.token` outside `relay` (my first form used both and that test failed it; measured: job logs answer 403 unauthenticated, the check-run, run, job, pull and issue reads answer 200). So a leg that is red on `main` ALREADY is `clear`: a pull request adding a second red file to a red `main` is not caught, and `main` is red now.

Tests: `src/packaging/auto-arm-cross-repo-red.test.ts` (new, 8 tests) runs the embedded text, taken out of the YAML, under real `bash` and `jq` against a fake `gh`: with HEAD's workflow it fails (0 pass, 1 file error: no `env`), with the change 8 pass. Run with `node --test`; `auto-arm-octo-sts.test.ts` (6) and `auto-arm-filter.test.ts` (2) pass alongside it.

Mutation (each on a copy of the workflow, restored from a copy and checked with `diff`, identical; each caught by its own test, and no other):
- the red verdict never reached: the three tests that expect `red`/a refusal fail
- an inherited red (trunk leg `failure`) not treated as clear: the red-vs-inherited test fails
- a pending leg read as clear: the pending test and the gate test fail
- an OPEN declared row ignored: the declaration test fails
- `cross_repo_gate "$n" || continue` removed from `arm`: the ordering test fails
- `cross_repo_gate "$PULL_REQUEST" || exit 0` removed from `arm-approved`: the ordering test fails
- `edited` removed from the trigger types: the ordering test fails

Not run: the workflow itself on GitHub (it can only run as `main`'s copy after merge), `pnpm run verify` and the lab's CI legs, which lay this tree over the core. `agent-org-wiring.test.ts` and `auto-arm-sweep.test.ts` do not run here (module not found at `/home/agent/scripts/agent-org-newest-tag.ts`), and fail the same way with HEAD's workflow.

Outside-Region: src/packaging/auto-arm-cross-repo-red.test.ts — the failing-before test the acceptance standard asks for; the Region names the workflow file only.
