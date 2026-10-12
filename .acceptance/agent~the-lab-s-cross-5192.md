Closes a11ign/a11ign#5192

Acceptance: `grep -c "actions: read" .github/chainguard/auto-arm.sts.yaml`

Run from this worktree of lab: prints `1` (0 at origin/main 911ac456, the row's Open-check).

**Which arming paths it covers: all three, by two jobs.** `arm` (the sweep) and `arm-approved` (an approving review, via `relay`) both `eval` ONE text, the workflow-level `CROSS_REPO_RED_LIB`, so the file-by-file comparison is in both; Dependabot has no path of its own (its pull requests are in `arm`'s listing and approved through `arm-approved`), so the three are covered.

**What changed.** The policy grants `actions: read` (the job log; `actions: write` is not asked for). `cross_repo_verdict`'s trunk-leg-`failure` branch, which read `clear`, now reads the head's and the trunk's job logs (`failing_files`, the shell form of agent-org's `failingFilesFromRstestLog`) and is `clear` only when every file the head's leg fails the trunk's leg failed too; a log that cannot be read, or names no failing file, is `cannot` (unarmed), never an inherited red.

**The row's premise needed one correction, and the change carries it.** The row asks for `actions: read` "in the `permissions:` of the minting jobs of `auto-arm.yml`". That block is `GITHUB_TOKEN`'s; the minted Octo STS token's grant is the POLICY's alone (the minting jobs' own comment says so), so adding it there grants the mint nothing and widens a token the pin test holds at `id-token: write`. It is NOT added, and `auto-arm-octo-sts.test.ts` now pins its absence. The row's ordering concern (the workflow asks for a permission the server refuses) does not arise either: `gh api apps/octo-sts` (2026-10-12) lists the Octo STS app's `actions: write`, so a read is within what the app holds; and the policy is read from the default branch while the workflow runs as `main`'s copy, so both take effect in the same merge.

**One trap found on the way, now pinned.** `gh api` REFUSES a response carrying terminal escape sequences ("pass --allow-escape-sequences"), and every rstest job log carries them: the first form of the log read failed that way on a real log, and the fake `gh` in the test now refuses a log read without the flag, so dropping it fails three tests.

**Run against real logs once** (real API reads with this session's token, the comment poster not reached; 2026-10-12):

```
lab#92 (head ebc0fe82, leg red on layer-edges.test.ts), newest trunk run now 38223882311 (leg success):
    red|the newest push run on main (.../runs/38223882311) had the leg `success`, and its body carries no `Cross-repo-red:` line
lab#92 against 38218432835 (the row's measured trunk, leg red on the SAME file):
    clear|-                                   <- the row's expected `clear`
lab#97 at head eae3c09d (leg red on git-spawn-classification.test.ts AND layer-edges.test.ts) against 38218432835:
    red|the newest push run on main (.../runs/38218432835) did not fail packages/lab/src/packaging/git-spawn-classification.test.ts, and its body carries no `Cross-repo-red:` line
the same, body `Cross-repo-red: a11ign/a11ign#5192` (open):   clear|-
```

The third is the row's "a head adding a second red file": a REAL head, not a constructed one. Not covered: the minted token's real `actions: read` read, which can only run as `main`'s copy after this merges (the reads above used the session's own token); the first `push` run after the merge is the read-back, and a mint refused by the server would show as the `arm` job's annotation.

Tests: `src/packaging/auto-arm-cross-repo-red.test.ts` (11, was 8) and `auto-arm-octo-sts.test.ts` (6) and `auto-arm-filter.test.ts` (2) pass under `node --test`. Before the change the three new file-by-file tests fail (trunk-red read `clear` whatever the files).

Mutation: each on a copy of the workflow or policy, restored from a copy and checked with `cmp`, identical; each caught by its own test(s)):
- `--allow-escape-sequences` dropped from the log read: the file-by-file, unreadable-log and declared-row tests fail
- a non-empty `added` never reads `clear` (always red): the file-by-file and unreadable-log tests fail
- `added` forced empty (always clear): the file-by-file and declared-row tests fail
- the head's unreadable log ignored: the unreadable-log test fails
- an unreadable log read as an empty one: the unreadable-log test fails
- `actions: read` removed from the policy: the policy pin fails
- `actions: write` added to the policy: the policy pin fails

Not run: the lab's `pnpm run verify` and CI legs (no `node_modules` in this worktree; `yaml` linked from the core's), and `agent-org-wiring.test.ts` / `auto-arm-sweep.test.ts`, which cannot resolve `/home/agent/scripts/agent-org-newest-tag.ts` here and failed the same way before the change.

Outside-Region: src/packaging/auto-arm-cross-repo-red.test.ts — the failing-before tests for the verdict port; the Region names `auto-arm-octo-sts.test.ts` only.
