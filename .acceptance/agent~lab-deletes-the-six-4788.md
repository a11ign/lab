Closes a11ign/a11ign#4788

Acceptance: `cd /home/agent/repos/lab-wt-4788 && bash -c 'test "$(git ls-files src/gates src/harnesses | grep -cE "[.](mjs|js|cjs)$")" -eq 0'` (the row's own command, run in this branch's worktree: its `cd /home/agent/repos/lab` form reads the primary checkout, a detached HEAD at another commit). Exit 0 at this head; at `origin/main` (`d4aac679`) the same count is 6. And, from a core checkout at `c18c2dab7` with this tree laid at `packages/lab` (the row's hand-run second half): `bash -c '! pnpm exec tsc -p packages/lab/tsconfig.json --noEmit | grep -E "(qualification-status|assert-action-report|capture-check|capture-fixtures|occurrence-verdict-stability|page-identity-rate)[.]mjs"'` exits 0, and `tsc` itself prints nothing.

## What changes
- **The six one-release shims are deleted** (step 5 of 5 of a11ign/a11ign#4519): `src/gates/qualification-status.mjs` (a re-export of the `.ts`) and `src/harnesses/{assert-action-report,capture-check,capture-fixtures,occurrence-verdict-stability,page-identity-rate}.mjs` (each threw). `src/gates` and `src/harnesses` hold no `.mjs`, `.js` or `.cjs`.
- **`mjs-ratchet.baseline.json`** loses the six names (85 to 79 entries, the file `mjs-ratchet.test.ts` reads).
- **`.changeset/the-last-six-lab-mjs-are-gone.md`**: patch.
- **`CORE_REF` is not touched**: a11ign/a11ign#4822 (lab#62) moved it to `c18c2dab76b795b1c3fec79d43ab3d653879bc9e`, and this branch is on top of that merge.

## Evidence (measured)
Lab laid in a core worktree at `c18c2dab7` (control v0.3.5 laid, toolchain 0.7.0 in `packages/lab/node_modules`), **Node 24.21.0 (lab's CI runs 22: not measured)**.

| | lab `origin/main` `d4aac679` | this head |
|---|---|---|
| `git ls-files src/gates src/harnesses \| grep -cE "[.](mjs\|js\|cjs)$"` | 6 | **0** |
| `tsc -p packages/lab/tsconfig.json --noEmit` | not run (the six files exist; nothing could name them as missing) | **0 lines of output**, TS2307 0 |
| `own` leg, `cross-repo-tests.ts --scope=own` (448 selection args) | 9 of 1603 tests failing in 201 files | **9 of 1603 tests failing in 201 files; the sorted failing-test names are IDENTICAL** (`diff` empty) |

- The 9 failures are the same nine before and after, and none is in this Region: `corpus-size-figures` "CONTROL ON REAL HISTORY" (reads `d9521699e`, absent in a shallow history), 3 in `criterion-list-duplication`, `fixture-absence-guard` POSITIVE CONTROL, 2 in `reported-counts`, 2 in `tree-wide-guards`. They are this laid worktree's (the `typescript` optional peer, git history under a core checkout), not this change's: #4822's own run in a CI-shaped layout had 1 failing of 1613, and the same test is that one. **CI's `own` leg is the verdict and I did not run it**; it is the row's Done-when 2, read on the merge commit.
- `mjs-ratchet.test.ts` is among the passing files at this head, with the baseline lowered by exactly the six deleted names.

## Not done / open
- `eslint` was not run: the change only deletes files and `tsc` is clean.
- The core reader `scripts/test-support/launcher-reach.stand-in.cmd` line 12 names `capture-check.mjs`, already a throwing shim: not this row's Region and not made worse (read on the row by `product-manager`).

Host-install: none.
Outside-Region: .acceptance/agent~lab-deletes-the-six-4788.md
Fleet: No.
