Closes a11ign/a11ign#4822

Acceptance: `cd /home/agent/repos/lab-wt-4822 && bash -c '! git grep -nE "(guards/src|test-support|scripts)/(tree-wide-guard|local-import-closure|sandbox-exhaustion|walk-scope-discovery|test-memory-cap|git-sandbox|product-home|fixture-symbols)[.]ts" -- src && git grep -n "CORE_REF" -- .github/workflows | grep -q c18c2dab76b795b1c3fec79d43ab3d653879bc9e'` (the row's own command, run in this branch's worktree: its `cd /home/agent/repos/lab` form reads the primary checkout, a detached HEAD at another commit). Exit 0 at this head; at `origin/main` the same grep lists 50 files.

## What changes
- **The 8 specifiers, in 49 files** (commit `a998a179`): `../../../guards/src/<m>.ts`, `../../../../scripts/test-support/git-sandbox.ts` and `../../../scripts/{product-home,fixture-symbols}.ts` become `@a11ign/toolchain/lib/<m>`. Five files name a module BY PATH and were not a mechanical swap: `fixture-absence-guard`, `sandbox-exhaustion`, `git-spawn-classification`, `test-memory-cap` (its `REPO` was derived from the module's own location) and `tree-wide-guard-walk` (spawns the module in a fresh process); `homepage-agreement` passes `REPO` because `productHome()` takes its root from the module's location, which in `node_modules` is the toolchain's.
- **`CORE_REF` 989c2bcc3 to `c18c2dab76b795b1c3fec79d43ab3d653879bc9e`** (core #4815), in the same PR: neither half is green alone (ruled on the row).
- **`tree-wide-guards.test.ts` and `lab-extraction.test.ts`** follow the discoverer of #4718: `MARKER_MODULE` is no longer exported; the toolchain's specifier is read off the comment-stripped SOURCE, and `MARKER_MODULES` is the one resolved path (agent-org's copy). Fixtures spell the import. One test is added: a specifier only in a COMMENT is not a declaration.
- **`doctor-next-command.test.ts`, `budget-ladder.test.ts`** name worker-fleet's `.ts` (`doctor.ts`, `source-walk.ts`, `capture-client.ts`, `worker-http.ts`).
- **`src/dataset-paths.test.ts`**: an EXEMPT entry, with its reason, for `packages/control/src/fleet-playbook.ts` (`PATCH_RUN_RECORD`, a one-field ledger; the shape `fleet-watch.ts` and `fleet-auto-off.ts` already carry).
- **`pre-push-hook-scope.test.ts`**: the cap prefix is the toolchain's (`node node_modules/@a11ign/toolchain/dist/lib/test-memory-cap.mjs run <name> --`, core #4590) and the hook runs `node scripts/changeset-untracked-check.ts` without `--import tsx`. Both are what the core at the new pin writes; with the old strings it is 3 failing in the `cross-repo` leg.
- **`ci.yml`, a second hunk**: `typescript` is installed beside the toolchain, version read from `core/package.json`. The toolchain's `walkTree({kind:"ts"|"both"})` does `createRequire(import.meta.url)("typescript")` from its OWN directory, and `typescript` is an optional peer that `npm install --prefix` does not install; without it `criterion-list-duplication.test.ts` is 3 failing ("Cannot find module 'typescript'"). Lab's own `^7.0.2` cannot be used: `typescript@7.0.2` has no JS entry point (`main` is null), so no `ScriptKind`.
- **`baselines/layer-edges.baseline.json`**: 56 entries for the deleted edges removed (`layer-edges.test.ts` says to), and the two `worker-fleet` targets renamed `.mjs` to `.ts`.
- `src/packaging/laid-control.ts` imports one of the eight and is swapped with the rest. `.changeset/the-lab-tests-import-the-toolchain.md`: patch.

## Evidence (measured)
All in a core worktree at `c18c2dab7` (`pnpm install --offline`, `pnpm run build`), lab laid as `ci.yml` lays it (toolchain 0.7.0 + `@rstest/coverage-v8` + `typescript` by `npm install --prefix`, symlinked; control v0.3.5 manifest by hand; agent-org v0.133.8 at `AGENT_ORG_TOOL`), **Node 24.21.0 (lab's CI runs 22: not measured)**. "Before" is lab `origin/main` `019a00ad` laid the same way.

| | before (`019a00ad`) | after (this head) |
|---|---|---|
| `tsc -p packages/lab/tsconfig.json --noEmit`, TS2307 | **58** (205 errors in all) | **0** (0 errors in all) |
| `eslint --no-ignore packages/lab`, errors | **14**, all `local/git-spawn-scrubbed` | **0** (2720 warnings, as before) |
| `own` leg (`cross-repo-tests.ts --scope=own`) | 10 files failing, 2 tests failing of 1556 (8 files cannot load: `Cannot find module '../../../guards/src/tree-wide-guard.ts'` etc.) | **1 test failing of 1613** (201 files, 10 skipped) |

- **The one `own` failure is `corpus-size-figures.test.ts` "CONTROL ON REAL HISTORY", and it is the same test failing before** (`git show d9521699e:packages/control/src/fleet-status.ts` in a deep checkout: the path is not in that commit). It is not touched here. It SKIPS when `d9521699e` is absent, which CI's `fetch-depth: 2` core checkout should make true (inferred from the test's own skip branch, not read from a CI run).
- **`dataset-paths.test.ts` fails before and passes after** (the red test: "every file matching the runs/-resolution signature imports dataset-paths.mjs, or is exempt": `packages/control/src/fleet-playbook.ts`).
- **`cross-repo` leg (not required, `continue-on-error`): 60 tests failing in 31 files at this head.** Not widened; named: `exit-code-contract`, `agent-org-wiring`, `ansible-yaml-parses`, `arm-pr`, `changed-files-renames`, `ci-health`, `close-rows-on-merge`, `consumer-gate`, `control-plane-checkout-is-one-fact`, `coverage-is-rstest`, `declared-walk-scope`, `fetch-wrapper-coverage`, `git-hooks-installed`, `layer-edges`, `local-import-closure`, `manifest-repository-check`, `no-worker-refusal`, `provisioning-installs-with-pnpm`, `regression-board-unit`, `release-triggers-itself`, `roles-readme`, `row-claim`, `rstest-report-is-not-the-verdict`, `runner-path-has-no-tsx-c8`, `test-memory-cap`, `tracked-source-leak-guard`, `typecheck-coverage`, `verify-affected-set`, `weekly-review`, `workflow-commands`, `workflow-filters`. Read for the Region files among them: `release-triggers-itself` (the live `release.yml` lacks the three called-workflow guard steps the test names), `row-claim` (the tool's record now carries `scope`), `local-import-closure` (the tool's `arm-pr` imports `project-config.ts`), `declared-walk-scope` (Node 24's `test.expectFailure`/`test.getTestContext`; `walk-scope-declaration.test.ts` now parses), `control-plane-checkout-is-one-fact` (the core's own `.acceptance/` file names `/home/agent/repos/control`), `layer-edges` (4 left: 2 new edges, `cross-repo-tests.test.ts` to `guards/src/y.ts` and `capture-screenreader-dataset.mjs` to `fleet-wake.ts`, and 2 stale `agent-org-wiring` path-literals): each reads the core or the tool at a version that moved, and none reads a module this PR swapped. The report lists 20 failures of 60, so the per-test names of the rest were not read one by one. The count moved 59 to 60 between two runs of the same tree.

## Mutation
Each edit copied aside and `diff`ed back byte-identical (never `git checkout --`). Against the core's `packages/guards/src/tree-wide-guards.ts` (the discoverer the rewritten tests drive), the rewritten `tree-wide-guards.test.ts` + `lab-extraction.test.ts` (25 tests, 0 failing unmutated):
- marker never recognised (`importsMarker = false`): 7 failing, among them the two MUTATION TARGET tests, the realistic-population vacuity guard and the lab-extraction control.
- import alone is enough (`CALLS_MARKER` ignored): 2 failing (the import-without-call test in each file) and no other.
- comments not stripped before the specifier is read: 2 failing (the new comment-only test, and the lab-extraction control whose third fixture is a commented call) and no other.
- any import counts as the marker (`imports(path).length > 0`): 1 failing (the false-friend control) and no other.
The `ci.yml` typescript line: 3 failing tests in `criterion-list-duplication.test.ts` without it, 0 with it, same layout.

## Not done / open
- CI at this head was not run by me: the numbers above are the laid core, not the runner. `own` is the required leg.
- The `cross-repo` residue above is a row of its own, not this one.

Host-install: none.
Outside-Region: .github/workflows/ci.yml, src/dataset-paths.test.ts (the row names `src/packaging/dataset-paths.test.ts`, which does not exist), .changeset/the-lab-tests-import-the-toolchain.md, .acceptance/agent~lab-s-50-test-4822.md
Fleet: No.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
