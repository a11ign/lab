Closes a11ign/a11ign#4839

Acceptance: `bash -c '! grep -nE "worker-fleet/src/[a-z-]+\.mjs\"" src/gates/exit-code-c*.test.ts src/packaging/provisioning-installs-with-pnpm.test.ts src/packaging/tracked-source-leak-guard.test.ts src/packaging/fetch-wrapper-coverage.test.ts && grep -q "const AT_LEAST = 44;" src/packaging/typecheck-coverage.test.ts && ! grep -q REFUSED_AND_DECLARES_NOTHING src/packaging/declared-walk-scope.test.ts && ! grep -qF "node --import tsx scripts/coverage.ts" src/packaging/coverage-is-rstest.test.ts && ! grep -qF "\"npm-token:check\":" src/packaging/runner-path-has-no-tsx-c8.test.ts && grep -qF "\"autocompact\"" src/packaging/arm-pr.test.ts'` (run from the lab root, no token and no core layout needed): exits 0 at this head and 1 at `origin/main` `b23ac008`, where 12 lines still spell a `worker-fleet` `.mjs` path in four of the files, the floor reads 69, the exemption constant exists and the manifest pins carry `--import tsx` or the 27 retired names. It is a STATIC reading and the tests' own verdict is the next paragraph. Before the merge, from a core checkout at `c18c2dab7` with this tree laid at `packages/lab`, the tool at `v0.133.15` and `AGENT_ORG_TOOL` set, rstest over the ten files (each as `--include packages/lab/src/<dir>/<name>.test.ts`) printed 10 test files, 191 tests, 190 passed and 1 failed, the one being a Node 24.21.0 reading outside the row's 11 (below, filed as a11ign/a11ign#4843); at `b23ac008` the same command printed 192 tests, 12 failed in the same 10 files. And the row's own command, hand-run AFTER the merge because it reads the newest `main` run, which the pull request's own CI cannot yet show: `bash -c 'L=$(gh run list -R a11ign/lab --workflow ci --branch main --limit 1 --json databaseId --jq ".[0].databaseId"); T=$(gh run view $L -R a11ign/lab --log 2>/dev/null); echo "$T" | grep -q "Test Files" && ! echo "$T" | grep -E " FAIL .*(exit-code-contract|provisioning-installs-with-pnpm|tracked-source-leak-guard|coverage-is-rstest|arm-pr|runner-path-has-no-tsx-c8|typecheck-coverage|fetch-wrapper-coverage|declared-walk-scope|git-hooks-installed)\\.test\\.ts"'` exits 0.

## What changes

Each of the ten files, and how it ended. **Moved to a declared version: none.** What these read is the core's manifest, roster and scripts and the laid worker layer's source, and no `@a11ign/*` package carries any of it. **Retired: one exemption and the test of it**, whose guarantee lives in a declared version.

| file | tests failing | ended |
|---|---|---|
| `exit-code-contract` | 2 | **fixed forward.** The laid worker layer (screenreader-fleet v0.7.3) is `.ts`: eight classified keys are renamed from `.mjs`, and those eight are exactly the discovered set the first test called unclassified (measured). The reasons are unchanged. |
| `provisioning-installs-with-pnpm` | 1 | **fixed forward.** `DOCTOR` is `doctor.ts`; the assertions are unchanged and hold (no package manager spawned, `pnpm run` remedies found). Not retired: screenreader-fleet v0.7.3 pins nothing of the kind (measured: no test there names `npmCliInvocation` or `pnpmCliInvocation`). |
| `tracked-source-leak-guard` | 1 | **fixed forward.** The MUTATION target and the pattern control read `host-address.ts`. |
| `coverage-is-rstest` | 1 | **fixed forward.** a11ign/a11ign#4699 dropped `--import tsx` from the core manifest. The assertion is the script and the program, so the loader is optional in the regex and a respelling does not red the leg again. |
| `arm-pr` | 1 | **fixed forward.** a11ign/a11ign#4741 added `model`, `effort` and `autocompact` to the `liaison` entry, and the roster's own `_rolesNotProcesses` says they are role facts; they join `ROLE_ENTRY_KEYS`, as the assertion's message asks the writer to do. |
| `runner-path-has-no-tsx-c8` | 1 | **fixed forward.** 27 of the 48 named `tsx` uses ran under bare `node` after #4699; the 21 that still name `tsx` are measured from the manifest and every one was already named. |
| `typecheck-coverage` | 1 | **fixed forward: the floor fell on purpose, 69 to 44.** No marker was removed: see Evidence. |
| `fetch-wrapper-coverage` | 1 | **fixed forward.** The exemption keys on `doctor.ts` and the walk excludes `worker-http.ts`; the one raw `fetch(` and its reason did not change. |
| `declared-walk-scope` | 1 | **retired: the exemption `REFUSED_AND_DECLARES_NOTHING` and its test.** It named `packages/guards/src/walk-scope-declaration.test.ts`, which left the core for `@a11ign/toolchain` (a11ign/a11ign#4589); that guard's OBSERVED LIMIT test is pinned in the toolchain's `src/lib/walk-scope-declaration.test.ts` at v0.7.0. A refusal left in the scan still fails the suite (Mutation). |
| `git-hooks-installed` | 1 | **fixed forward.** The same respelling as `coverage-is-rstest`, for `prepare`. The core pins `prepare` nowhere else (measured), so this assertion stays. |

## Evidence (measured)

All in a core worktree at `c18c2dab7` (`CORE_REF` at lab `origin/main`), `pnpm install --offline` and `pnpm run build`, lab laid as `ci.yml` lays it (toolchain 0.7.0 beside it, the tool at `v0.133.15`, the newest stable the run resolved), **Node 24.21.0 (CI runs 22: not measured here, but see the last row)**.

| | before (`b23ac008`) | after (this head) |
|---|---|---|
| the ten files | **12 tests failing in 10 files** of 192 | **1 failing in 1 file** of 191 (one test retired) |
| CI, run 38056110285 at `9643e5d2` | 11 failing in the same 10 files | not run by me |
| `eslint --no-ignore` on the 10 touched files; `tsc -p packages/lab/tsconfig.json --noEmit` | | 0 errors; exit 0 |
| whole `cross-repo` leg (`scripts/cross-repo-tests.ts --scope=cross-repo`) | not run | 50 failing in 23 files of 3329 / 223; none is one of these ten except the one below. The 23 are other rows' files, and a11ign/lab#65's fixes are not in this tree |
| the one still failing: `declared-walk-scope` > "EVERY function on fs, ... is wrapped, or named in NOT_WRAPPED" | failing | failing, `test.expectFailure` and `test.getTestContext`: **`typeof` is `function` on Node v24.21.0 and `undefined` on Node v22.22.1**, so it is not among CI's 11. The list is the core's `packages/guards/src/walk-scope.ts`, outside this Region: filed as a11ign/a11ign#4843 |

**The floor, 69 to 44.** This repository's own tree had 44 of 85 `.mjs` marked at `91af8c01` (a11ign/a11ign#4551, the commit whose pull request set 69) and has 44 of 79 at `b23ac008`. Of the 108 marked at the flatten (`70dde37d`), 65 left the count: 32 are renamed to `.ts` and 33 are an UNMARKED one-release shim beside a `.ts` (all 65 have a `.ts` sibling, measured), 43 keep the marker and one gained it. The core's own tracked `.mjs` are 10 unmarked isolation fixtures at `989c2bcc3` and at `c18c2dab7`, so the other 25 of the 69 were the laid layers' (**inferred by elimination**, not counted at `989c2bcc3`), and the pins laid at `c18c2dab7` carry no `.mjs`: the population is 79 plus those 10, 89, of which 44 are marked (measured with `readdirSync`, as the test counts).

## Mutation

Each applied to the LAID copy under the core worktree and restored from the backup, `cmp`-identical every time (never `git checkout --`). Only the named tests failed in the file under test:
- `typecheck-coverage`: one marker stripped from a marked `.mjs`, and the floor raised to 45: each fails "the typechecked `.mjs` count never falls" and nothing else.
- `runner-path-has-no-tsx-c8`: a manifest script that starts naming `tsx`, and a named entry removed from `NAMED_TSX_USES`: each fails the one "named with its purpose" test; `tsx --test` added: that test and the ACCEPTANCE test above it.
- `exit-code-contract`: a classified key renamed away, and a key put back to `.mjs`: each fails "classified nowhere" and "still exists", and only those two.
- `arm-pr`: `effort` taken out of `ROLE_ENTRY_KEYS`, and a `workspace` pane binding added to a `live` entry: each fails the #1951 test alone.
- `git-hooks-installed`: `prepare` with the installer second, and with it not named: each fails the lifecycle test alone; with the `--import tsx` spelling put back it passes (the control for the optional loader).
- `coverage-is-rstest`: `c8` put back in front of the script fails the c8 ACCEPTANCE test and the script test; the `--import tsx` spelling passes.
- `provisioning-installs-with-pnpm`: a non-comment `npm install` appended to `doctor.ts` fails the doctor test alone.
- `tracked-source-leak-guard`: the detector made never fire fails three tests (the two MUTATION cases and the pattern-exercised test); the replaced sentence removed from `host-address.ts` fails the MUTATION case alone.
- `fetch-wrapper-coverage`: a raw `fetch(` added to an unlisted `worker-fleet` file, and the exempt one in `doctor.ts` renamed away: each fails the one tree-wide test.
- `declared-walk-scope`: a `packages/guards/src/*.test.ts` that quotes the declaration name in a regex literal fails the file at its `before` hook (1 file failed, 0 tests), so a refusal is still not tolerated now the exemption is gone.

## Not done / open

- `declared-walk-scope`'s enumeration test is red on Node 24 and not in the 11: a11ign/a11ign#4843, the core's `NOT_WRAPPED`.
- The sandbox, `../wt-4839-core` (a core worktree) and `../wt-4839-core-tool` (the tool clone), is what the figures above were read in; after the merge `git -C ../wt-4839 worktree remove --force ../wt-4839-core && rm -rf ../wt-4839-core-tool`.
- `continue-on-error` is still on the leg and `own` is untouched: no workflow changes.

Outside-Region: .changeset/ten-of-the-cross-repo-4839.md — the changeset the lab's `changeset` job requires for a change under `src/`
Outside-Region: .acceptance/agent~ten-of-lab-s-4839.md — this file, as ADR 0044 asks
Fleet: No.
