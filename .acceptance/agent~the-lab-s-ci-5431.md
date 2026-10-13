Closes a11ign/a11ign#5431

Acceptance: `bash -c 'cd ~/repos/lab && git fetch -q origin && for ref in origin/agent/the-lab-s-ci-5431 origin/main; do ci=$(git show "$ref:.github/workflows/ci.yml" 2>/dev/null) || continue; pin=$(printf "%s\n" "$ci" | sed -n "s/^  CORE_REF: //p"); code=$(printf "%s\n" "$ci" | grep -v "^ *#"); git -C ~/repos/a11y-witness merge-base --is-ancestor 87d89fdec "$pin" && ! printf "%s\n" "$code" | grep -q "layers\.json" && printf "%s\n" "$code" | grep -q "^  FLEET_REF: v" && printf "%s\n" "$code" | grep -q "^  WORKER_REF: v" && printf "%s\n" "$code" | grep -q -F "FLEET_REF\" https://github.com/a11ign/screenreader-fleet.git" && printf "%s\n" "$code" | grep -q -F "WORKER_REF\" https://github.com/a11ign/screenreader-worker.git" && echo "OK $ref $pin" && exit 0; done; exit 1'` (the row's done-when 1, and the layout it needs: `CORE_REF` has `87d89fdec` as an ancestor, `ci.yml`'s code names no `layers.json`, and the fleet and the worker are cloned at a ref the file declares). The branch ref is tried first, as the row's own command is at `origin/main`: it cannot pass before the merge. It runs in a bare checkout, so it is the structural half; the layout run is below.

The row's own command (`node --test src/packaging/ci-composition.test.ts src/referenced-scripts.test.ts` in `~/repos/lab` at `origin/main`) fails at `origin/main` in a bare checkout for a reason that has nothing to do with this change: `ERR_MODULE_NOT_FOUND ... /home/agent/repos/guards/src/git-env.ts` (both files import the core by relative path), measured 2026-10-13 at lab `53a8afa3`. In the cross-repo layout it is run from the core's root, which is where `referenced-scripts.test.ts` reads `package.json` from.

## Run in the CI layout (measured)

How: the `run:` blocks of this branch's `ci.yml` were extracted with a YAML parser (not retyped) and executed in a parent directory holding `core` (a clone of a11ign/a11ign at `87d89fdec`) and `lab` (this tree), in order from "The layout check" to "The tool at the newest release tag", with `pnpm install --no-frozen-lockfile --ignore-scripts`, tool v0.194.0 from `agent-org-newest-tag.ts`, Node v24.21.0. Then the job's own commands: `eslint --no-ignore packages/lab`, `tsc -p packages/lab/tsconfig.json --noEmit`, and `rstest run --config scripts/rstest/rstest.config.ts` over `cross-repo-tests.ts --scope=own` and `--scope=cross-repo`.

| | `origin/main`'s lab + `origin/main`'s `ci.yml`, core `2b8489a8d` | `origin/main`'s lab + `CORE_REF` bumped only, core `87d89fdec` | this branch, core `87d89fdec` |
|---|---|---|---|
| lay steps | all ok | **die at `cp layers.json packages/control/layers.json`: `cp: cannot stat 'layers.json'`** (`git cat-file -e 87d89fdec:layers.json` exits 128) | all ok |
| `eslint --no-ignore` | 0 errors | not reached | 0 errors (2,039 warnings, 2 more than main, both in `ci-composition.test.ts`: the version floors `[0, 11, 0]` and `[0, 13, 0]`, spelled as the existing `[0, 13, 15]` is) |
| `tsc` | 0 errors | not reached (laid by hand without the `cp`: 5 errors, all in `layer-edges.test.ts`) | 0 errors |
| `own` leg | 1,660 pass (11 skipped) | not reached (laid by hand without the `cp`: **3 of 1,660 fail**) | **1,662 pass (11 skipped)** |
| `cross-repo` leg | 9 of 2,972 fail, 3 files | not reached | 100 of 2,976 fail, 45 files |

The cross-repo leg is `continue-on-error` and `failure` on lab `main` at the current pin (run 38402411384), so its CONCLUSION is no worse (`failure` and `failure`) and its COUNT is not: 9 of 2,972 became 100 of 2,976. That is the leg doing what it was built for (a newer core's tests fail the lab's copies of them); it is listed file by file on a11ign/a11ign#5435, not fixed here.

## Why the three own failures and the five `tsc` errors are in this diff

At `87d89fdec` the lab's own tree fails three of its own tests and `tsc`, so `checks (own)` could not be green with `ci.yml` alone. Each is the pin doing its job:

- `src/referenced-scripts.test.ts`: `ENOENT packages/control/layers.json` (in Region).
- `src/packaging/lab-fetch-paths.test.ts`: `package.json has no script training:export-acceptance`. Cut 9 moved the 69 lab scripts to the lab's own `package.json`, and the test read the core's.
- `src/packaging/public-api.test.ts`: the CLI exports `DEFAULT_PROBE_FLAGS` beside `reportLines` since core #5091 (`7dcd7d231`, inside the 246 commits).
- `src/packaging/layer-edges.test.ts`: 5 `tsc` errors, `BASELINE_PATH`, `judgeEdges`, `describeVerdict` and `countByDisposition` left the core's `layer-edges.ts` at cut 9. They are moved here verbatim to `src/packaging/layer-edges-baseline.ts`, which is the lab's own baseline's judge.

Outside-Region: src/packaging/lab-fetch-paths.test.ts — reads the lab's own `package.json` for the scripts a lab job runs; cut 9 took them out of the core's (measured: the test fails at `87d89fdec`, passes after)
Outside-Region: src/packaging/public-api.test.ts — the CLI's documented surface is now `reportLines` and `DEFAULT_PROBE_FLAGS` (core #5091); the assertion that said "only the renderer" failed at `87d89fdec`
Outside-Region: src/packaging/layer-edges.test.ts — typechecks again (the judge is imported from the lab's own file), excludes the baseline file from its own scan in code (a named `SELF`, because cut 9 dropped `\.baseline\.json` from the core guard's own), and follows the core's fixtures to `nvda-speech` and the guard's `REACH`/`no reach` wording
Outside-Region: src/packaging/layer-edges-baseline.ts — NEW: `judgeEdges`, `describeVerdict`, `countByDisposition` and the disposition vocabulary, copied from the core at `23a179418~1`; the three things it read from the core's `layer-edges.ts` (`EDGE_KINDS`, `LAYER_PACKAGES`, `Edge`) are declared in the file, because a non-test file of the lab does not import the core by a relative path, and `layer-edges.test.ts` asserts the two lists equal the core's
Outside-Region: baselines/layer-edges.baseline.json — 11 entries that no longer exist removed, 15 added (the six `ci.yml` reads of the laid fleet and worker, `laid-worker.ts`'s path, and eight fleet reads the scan now sees because cut 9 removed the core's `.gitignore` lines that hid the laid directories); `layer-edges.test.ts` fails on a new or a stale entry (mutated: see below)

## Mutation (both directions), on the laid copy, each restored byte-identical (`cp` before, `cp` after, `diff -q`)

| Break | Fails | Passes |
|---|---|---|
| `ci.yml`: the `WORKER_REF` `.layer-ref` write deleted | the fleet-and-worker declaration test only | the rest of `ci-composition.test.ts` (14) |
| `ci.yml`: `FLEET_REF: v0.10.9` | the same test only | 14 |
| `ci.yml`: `cp layers.json packages/control/layers.json` put back | the control order/shape test only | 14 |
| `ci.yml`: the fleet step's `rm -rf` written in the other order (the marker the order test looks for is gone) | the fleet-and-worker order test only | 14 |
| `referenced-scripts.test.ts`: `unrunnableReferences` never refuses (`filter(() => false)`) | the POSITIVE CONTROL only | the tracked-ness test |
| `referenced-scripts.test.ts`: `unrunnableReferences` always refuses (`filter(() => true)`) | the tracked-ness test AND the positive control (it holds the same function's "tracked is fine" row) | the tsconfig test |
| `lab-fetch-paths.test.ts`: the manifest read from `../../../../package.json` (the core's) | "every resolved entry is exactly where its producer writes it" only | the other 8 |
| `public-api.test.ts`: the expected surface back to `["reportLines"]` | the CLI surface test only | the other 5 |
| `layer-edges.test.ts`: the `SELF` filter removed | "the lab's edges agree with its own baseline" only | the other 33 |
| `layer-edges.test.ts`: everything excluded (`filter(() => false)`) | the same test, at its positive control ("the scan found N edges from lab") | the other 33 |

Unmutated: `ci-composition.test.ts` and `referenced-scripts.test.ts` 18 of 18 under `node --test` from the core's root (16 of 16 at `origin/main`'s files in the old layout).

## What this does not do

- It does not make the cross-repo leg green: 46 test files read what the core changed in 246 commits (a workflow deleted, scripts moved to the lab's `package.json`, fixtures re-pointed). They are a11ign/a11ign#5435, with the file list; one lab pull request cannot land 46 files inside "the CI lays the layers".
- Whether the lab keeps a baseline of its reaches at all, against ADR 0045 rule 5 ("a new edge is a change to this ADR, not to a baseline"), is not decided here: the judge is moved so the lab's tests keep running, and the question is a11ign/a11ign#5436, with a recommendation.
- The lab's CI on this pull request is the real check. `pnpm install` ran with `--ignore-scripts` here (the core's `prepare` installs git hooks into the shared repository), then `pnpm run build` by hand.
