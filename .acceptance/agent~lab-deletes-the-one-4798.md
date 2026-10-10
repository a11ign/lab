Closes a11ign/a11ign#4798

Acceptance: `cd /home/agent/repos/lab-wt-4798 && bash -c 'test "$(git ls-files scripts | grep -cE "[.](mjs|js|cjs)$")" -eq 0'` (the row's own command, run in this branch's worktree: its `cd /home/agent/repos/lab` form reads the primary checkout, a detached HEAD at another commit). Exit 0 at this head; at `origin/main` (`b23ac008`) the same count is 35. The row's second half, `npx tsc --noEmit`, cannot run in a lab checkout alone (its `tsconfig.json` extends the core's), so it was run the way CI runs it: from a core checkout at `da027c092` with this tree laid at `packages/lab`, `pnpm exec tsc -p packages/lab/tsconfig.json --noEmit` printed nothing and exited 0.

## What changes
- **The 35 one-release shims are deleted** (step 5 of 5 of a11ign/a11ign#4551): every `scripts/*.mjs`, each of which re-exported its `.ts` and, as the entry file, ran it. `scripts/` holds no `.mjs`, `.js` or `.cjs`.
- **`src/transitional-shims.ts` and `src/packaging/transitional-shims.test.ts` are deleted** with them, and the three tests that read `isTransitionalShim` (`exit-code-contract`, `verdict-adoption`, `gate-partial-corpus-contract`) lose that call: a `.mjs` name is no longer spelled by anything in `scripts/`.
- **`mjs-ratchet.baseline.json`** loses the 35 names (79 to 44 entries; `exceptions` stays empty). **It is not empty**: the 44 left are `src/training/*.mjs`, which this row's Region does not hold and its title does not name.
- **`src/packaging/every-test-file-is-run.test.ts`'s positive control** was `scripts/corpus-snapshot.mjs`, a tracked `.mjs` under `scripts/` that no glob reaches, and the last such file is gone. It is `scripts/action-dry-run.sh` now (a real tracked file that no runner glob reaches), with the covering glob `packages/*/scripts/**/*.sh`.
- **`CORE_REF`** moves from `c18c2dab7` to `da027c092c6ce17609599da8eaaefe2f1d3735d8`, core `origin/main` when this was read. `git show <sha>:package.json | grep -c 'packages/lab/scripts/.*mjs'` is 34 at `c18c2dab7` and 0 at `81c6680ad` (core #4801) and at `da027c092`, and the laid control (`v0.3.6`) names no `.mjs` in any `lab-job.yml` argv.
- **`.changeset/the-lab-script-shims-are-gone.md`**: patch.

## Evidence (measured)
Lab laid in a core worktree at `da027c092` (control v0.3.6 laid, `@a11ign/toolchain@0.7.0` linked into `packages/lab/node_modules`, `agent-org` v0.134.0 as the tool), **Node 24.21.0 (lab's CI runs 22: not measured)**.

| | this head |
|---|---|
| `git ls-files scripts \| grep -cE "[.](mjs\|js\|cjs)$"` | **0** (35 at `origin/main`) |
| `tsc -p packages/lab/tsconfig.json --noEmit` | **0 lines, exit 0** |
| `own` leg, `cross-repo-tests.ts --scope=own` (448 selection args) | **1599 tests in 200 files, 0 failed**, 10 skipped |
| `eslint --no-ignore` on the four changed test files | 0 errors, 8 warnings (the three shown are `no-magic-numbers` in `verdict-adoption.test.ts`, on lines this change does not touch) |
| `cross-repo` leg (446 args), this head vs lab `origin/main` laid at the same core | **61 failing of 3328 at this head; every one of them also fails with `origin/main` laid**, 0 fail only here |

- The `cross-repo` leg is red either way at `da027c092` and does not block. The two `exit-code-contract` failures are `packages/worker-fleet/src/*.mjs` names that layer renamed; the `typecheck-coverage` floor failure (`44 of 54 .mjs ... down from 69`) is not caused by deleting the shims, which were unmarked: at core `c18c2dab7` with lab laid (a sibling worktree, counted by hand) the marked count was already 44 of 89 `.mjs`, so the floor of 69 sat above the tree before this head. **Neither is this row's Region and neither is touched.**
- The `origin/main` run showed 7 further failures that this head does not (`tracked-source-leak-guard` x3, `tracked-symlink-targets`, two `package-rename-*`, `lab-extraction`): they came from the local layout's staged `node_modules` symlink in that run, not from the change. They are named so a reader does not take them for fixes.
- Lab#65 (a11ign/a11ign#4829) and #66 (a11ign/a11ign#4837) are open and fix tests AT `c18c2dab7`: whichever of those and this merges second re-runs `own` and `cross-repo` and says what moved.

## Mutation
Never restored with `git checkout --`: each file copied aside and `cmp`ed back byte-identical.
- The control names a path no file has: `every-test-file-is-run.test.ts` fails its POSITIVE CONTROL with "is not tracked" (1 of 10 across it and `mjs-ratchet.test.ts`, and no other).
- The control is a file some glob reaches (`scripts/bench-capture.ts`): the same test fails (1 of 10, and no other).
- A stray tracked `scripts/stray.mjs`: `mjs-ratchet.test.ts`'s real-tree test fails and names `scripts/stray.mjs` (1 of 10, and no other). Removed, 10 of 10 pass.

## Not done / open
- `tsconfig.json` still lists `scripts/**/*.mjs` and `*.mjs` in `include`: harmless (`src/**/*.mjs` still matches 44 files) and not in this Region.
- The baseline is 44, not empty: `src/training/*.mjs` is not this row's.

Host-install: none. No file here is named by a deployed unit or an Ansible task of this repository.
Outside-Region: .github/workflows/ci.yml, src/gates/exit-code-contract.test.ts, src/gates/gate-partial-corpus-contract.test.ts, src/gates/verdict-adoption.test.ts, .acceptance/agent~lab-deletes-the-one-4798.md
Fleet: No.
