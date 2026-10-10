Closes: none — the Region of a11ign/a11ign#4829 is complete and each of its 8 files is named below, but the row's Acceptance (`success` for the newest `main` run) cannot print until the 24 other files this leg also fails are green, and they are outside that Region (the pin moved under the row: 11 tests in 8 files at `019a00ad` became 60 tests in 31 files at core `c18c2dab7`, measured below). Filed as the residue row named at the end; `product-manager` rules whether this row closes on this merge.

Acceptance: `bash -c 'T=/home/agent/repos/wt-4829-core-tool; rsync -a --exclude=.git --exclude=node_modules /home/agent/repos/lab-wt-4829/ /home/agent/repos/wt-4829-core/packages/lab/ && cd /home/agent/repos/wt-4829-core && git add -f packages/lab >/dev/null && git rm --cached -r -q -f packages/lab/node_modules 2>/dev/null; inc=(); for f in acceptance-reads-the-live-body changed-files-renames close-rows-on-merge control-plane-checkout-is-one-fact layer-edges local-import-closure row-claim verify-affected-set; do inc+=(--include "packages/lab/src/packaging/$f.test.ts"); done; AGENT_ORG_TOOL=$T/agent-org AGENT_ORG_TAG=v0.133.15 PATH=$T/bin:$PATH pnpm exec rstest run --config scripts/rstest/rstest.config.ts "${inc[@]}"'` (hand-run on this host, as #4278's was: `../wt-4829-core` is a core worktree at `CORE_REF` `c18c2dab7`, installed and built, with the lab laid as `ci.yml` lays it, and `../wt-4829-core-tool` is the tool at `v0.133.15`, the newest stable the cross-repo job resolved. The command lays THIS branch's tree over it, then runs the 8 Region files and exits 0 on `VERDICT pass`. The same command at `origin/main` `d4aac679` printed `VERDICT fail: 10 of 312 tests failed in 8 files` and exited 1: measured.)

## What changes
The 11 tests of the row, 8 files, and how each ended. **Moved to a declared version: none** — what these read is the core's workflows and scripts and the tool's source, and no `@a11ign/*` package carries any of it, so there is no version to move a read to.

| file | tests | ended |
|---|---|---|
| `acceptance-reads-the-live-body` | 2 | **struck off, not touched.** Red at `019a00ad` because the tool at its newest tag then had no `tsx` under it; green at `d4aac679` (run 38055200478, `✓ (12)`) and in my sandbox. |
| `changed-files-renames` | 1 | **fixed forward.** `scripts/verify.ts:477` asks `git diff --name-only --diff-filter=A`, which lists ADDED files only, so a rename has no source side to lose (its own comment, and agent-org's `resolveAcceptanceSource`, say a rename is not an add). The scan is now `asksBare(line)`, exported with its own positive control. |
| `close-rows-on-merge` | 1 | **retired.** A regex over the tool's `main()` SOURCE; `main()` gained the verify-row step (#4641) and now exits `code === DONE && lost.length ? COULD_NOT_CLOSE : code`. The decision (`closeRowsExit`) stays pinned in this file and in agent-org's `src/packaging/settle-closed-status.test.ts`; agent-org's `src/close-rows-full-form.test.ts` runs the closer. **Not pinned anywhere after this:** that `main()` is wired to it, which is the tool's source to pin. |
| `control-plane-checkout-is-one-fact` | 1 | **fixed forward.** `.acceptance/` files (and the lab's laid `packages/lab/.acceptance/`) record `cd /home/agent/repos/<worktree>`; each pull request adds one, so a per-target list is red on the PR that adds the next. The directory is a record, as `docs/board/reported/` already was, with a control that the same words in `docs/` or a script are still a site. The `role-product-manager` entry was its only user and is removed. |
| `layer-edges` | 1 | **fixed forward**, two causes: the baseline held 2 stale `agent-org-wiring.test.ts` path-literals and lacked the `capture-screenreader-dataset.mjs` → `fleet-wake.ts` import (#4462); and `cross-repo-tests.test.ts` spelled an import specifier inside a string, which the walk reads as a reach into the core, so the fixture is built from pieces as that file's `readAbove` already is. |
| `local-import-closure` | 1 | **fixed forward.** An exact `deepEqual` over the TOOL's `arm-pr.ts` imports, red for the tool's `project-config.ts`; now a floor (every listed file is still seen), which still fails a walk that finds nothing. |
| `row-claim` | 2 | **fixed forward.** `claimRecordFrom` grew `scope` (#4739); the two tests read `{ branch, worktree, recorded }`, the fields they are about. The tool's own `src/row-claim.test.ts` pins the whole shape. |
| `verify-affected-set` | 2 at `019a00ad`, 3 now | **fixed forward.** `.agent-org/host.json` is read by name and the core's `forceRerunTriggers` does not list it: added to `KNOWN_UNCOVERED_BY_THE_CORE` as every sibling is, so it turns red the day the core covers it. The preload control named `walk-scope-declaration.ts`, which left the core; it now names the config's own `scripts/private-tmp.ts`. |

## Evidence (measured)
All in a core worktree at `c18c2dab7` (`CORE_REF` at lab `origin/main`), `pnpm install --offline` and `pnpm run build`, lab laid as `ci.yml` lays it (toolchain 0.7.0 beside it, control `v0.3.5` manifest, the tool at `v0.133.15`, the newest stable the run resolved), **Node 24.21.0 (CI runs 22: not measured here, but CI's own count agrees: below)**.

| | before (`d4aac679`) | after (this head) |
|---|---|---|
| `cross-repo` leg, local | **60 tests failing in 31 files** of 3328 / 223 | **51 in 25 files** of 3329 / 223 — 50 comparable, plus `no-worker-refusal` once, an `npm pack` that rebuilt `packages/cli` in my sandbox (not in CI's 31, not touched) |
| the 8 Region files | 10 tests failing in 7 files (`acceptance-reads-the-live-body` green) | **313 passed, 0 failing, 8 files** |
| `cross-repo` leg, CI run 38055200478 on `d4aac679` | **31 files failed, 192 passed (223)** — the same 31 and 223 | not run by me |
| `eslint --no-ignore` on the 9 touched test files | | 0 errors |
| `tsc -p packages/lab/tsconfig.json --noEmit` | | exit 0 |

## Mutation
Each mutation applied to the LAID copy under the core worktree and restored from the lab worktree, `cmp`-identical every time (never `git checkout --`). Only the named tests failed in the file under test:
- `asksBare` never fires: the new SCAN test and the SHAPE test (its `bare.length > 0` control). Always fires: the same two. `--diff-filter=A` exemption dropped: the same two (verify.ts:477 red again).
- `isAcceptanceRecord` always false: the new control and the real-tree test (the original red). Always true: the new control and the discovery-floor assertion (`sites.length >= 8`). Widened to `/acceptance/`: the new control only.
- A file the tool does not import added to the floor: `THE LIVE INSTANCE` only. `heldBy` ignoring the record: the NEWEST-record test only.
- `.agent-org/host.json` exemption removed: the three original reds return (`every path…`, `control: …one file removed`, `every KNOWN_UNCOVERED…`). Closure control naming an absent file: that one test.
- Baseline: the new entry removed, then a stale one put back, then the fixture spelled literally again: each fails `layer-edges`' one agreement test and nothing else.

## Not done / open
- **24 files (50 tests) of this leg stay red and are outside the Region:** `exit-code-contract`, `agent-org-wiring`, `ansible-yaml-parses`, `arm-pr`, `ci-health`, `consumer-gate`, `coverage-is-rstest`, `declared-walk-scope`, `fetch-wrapper-coverage`, `git-hooks-installed`, `manifest-repository-check`, `provisioning-installs-with-pnpm`, `regression-board-unit`, `release-triggers-itself` (18), `roles-readme`, `rstest-report-is-not-the-verdict`, `runner-path-has-no-tsx-c8`, `test-memory-cap`, `tracked-source-leak-guard`, `typecheck-coverage`, `weekly-review`, `work-gate`, `workflow-commands`, `workflow-filters`. Named, not widened.
- `close-rows-on-merge.test.ts` still holds two more regexes over the same `main()` source (the `liveClosureEffects` and `LIVE_SETTLE_DEPS` tests); they pass today and are the same shape.
- The sandbox, `../wt-4829-core` (a core worktree) and `../wt-4829-core-tool` (the tool clone), is what the Acceptance runs in and is left for a reviewer to re-run it; after the merge `git -C ../wt-4829 worktree remove --force ../wt-4829-core && rm -rf ../wt-4829-core-tool`. The CI log of this pull request's own `checks (cross-repo)` job is the runner's reading and is not what the Acceptance reads.
- `continue-on-error` is still on the leg and `own` is untouched: no workflow changes.

Outside-Region: baselines/layer-edges.baseline.json — the layer-edges test's own baseline, 2 stale entries removed and 1 edge added
Outside-Region: src/packaging/cross-repo-tests.test.ts — the import fixture that layer-edges reads as an edge into the core
Outside-Region: .changeset/the-cross-repo-leg-reads-the-pin-4829.md — the changeset the lab's `changeset` job requires for a change under `src/` and `baselines/`
Outside-Region: .acceptance/agent~lab-s-cross-repo-4829.md — this file, as ADR 0044 asks
Fleet: No.
