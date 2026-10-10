Closes a11ign/a11ign#4850

`src/packaging/pr-open.test.ts` and `src/packaging/dependency-pr-body.test.ts`: the tests that handed agent-org's reader a PR body with no `.acceptance/` file and no author. agent-org v0.138.0 reads a PR's Acceptance from the `.acceptance/<branch with / as ~>.md` file the PR adds (agent-org#519), and reads the body only for an exempt Dependabot author (`BODY_EXEMPT_AUTHORS`). Both files now present the reader the shape it reads: a diff that ADDS the acceptance file (with its text injected through `readFile`), and for the Dependabot path, `runCiBodyReports` with `author`. The refusal cases keep their assertions; a new case pins that a body-only PR is refused and that the same body with its file added is sent.

Acceptance: `bash -c 'for f in pr-open dependency-pr-body; do grep -qE "\.acceptance/|PR_AUTHOR" src/packaging/$f.test.ts || exit 1; done'` (run from the lab root; a structural check of the same regex over this branch's files, because the row's own command reads `main` and cannot pass before the merge).

Hand-run: the row's own command, `gh api` over `main`'s two files, is run by the host after the merge (it reads a file this pull request cannot yet have put on `main`); paste its exit code on the row.

## How each file ended
- `pr-open.test.ts`: every `checkBody` call now carries a diff that adds `.acceptance/agent~my-branch.md` and a `readFile` returning the fixture's Acceptance, so the reader finds the source where v0.138 looks for it. `gitFor(branch)` answers the `--abbrev-ref` and `--name-only` argv the way git does, instead of answering every argv with the same SHA. The new case is the ADR 0044 refusal: a body-only PR gets `ACCEPTANCE-SOURCE: none`, nothing is sent, and the positive control (file added) is sent.
- `dependency-pr-body.test.ts`: `shippedVerdict` now calls `runCiBodyReports(..., CI_BODY_REPORTS)` with `author`, so the Dependabot exemption is exercised by the same path CI runs. A new control: the SAME body from `a11ign-bot` is refused with `ACCEPTANCE: MISSING` and nothing runs, so the exemption is shown to be the author's, not the body's.

## Evidence
- Before: 18 of 77 failing in both files, measured on a CI-shaped core scratch copy at core `da027c092` with `packages/lab` laid in from this worktree (`/home/agent/core-sim-4850.baseline4.log`).
- After: 79 of 79 passing in the same harness (`/home/agent/core-sim-4850.after1.log`, rstest `VERDICT pass: 79 tests in 2 files`, exit 0).
- Not verified: ESLint reports both files as ignored by an ignore pattern, so lint did not check them; typecheck not run. The `checks (cross-repo)` leg of this PR's CI is the first real run against the lab's own layout.

Outside-Region: none
Fleet: No.
