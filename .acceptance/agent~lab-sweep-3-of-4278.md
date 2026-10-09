Closes a11ign/a11ign#4278 -- on the Acceptance bound below, which this PR proposes as `-le 35` (the row's `-eq 0` cannot be met without breaking CI at the pinned refs; the same relaxation `product-manager` ruled for #4276, #4277, #4268 and #4269). The 35 move with their callers in #4519's family of follow-up rows.

Acceptance: `bash -c 'test "$(git ls-files scripts | grep -cE "[.](mjs|js|cjs)$")" -le 35' && npx tsc --noEmit && cd ../.. && pnpm exec rstest run --config scripts/rstest/rstest.config.mjs --include "packages/lab/src/packaging/mjs-ratchet.test.ts"` (hand-run from the lab root, which is `packages/lab` of a core checkout at `CORE_REF`: `rstest` runs from that core, two levels up; the row names `src/mjs-ratchet.test.ts`, the file is `src/packaging/mjs-ratchet.test.ts`)

## What changes
3 of the 38 `.mjs` files in `scripts/` (the row says 37; `git ls-files scripts` counts 38 at `c22c3d17`) are renamed to `.ts` by `js-to-ts` (toolchain `dist/js-to-ts.mjs` at `e9c2e6f`, TypeScript 6.0.3): `bench-capture`, `claim-excludes-recompute`, `referral-repeat-share`. Commit 1 is the script's rename with no hand edit; commit 2 is the residue and the importers; commit 3 lowers the baseline, the `@ts-check` floor and adds the changeset.

**Dry-run estimate (pasted from the script):** whole slice, `js-to-ts: would rename 38 file(s) under TypeScript 6.0.3; 0 cannot parse`; as run (35 held back with `--exclude`), `js-to-ts: would rename 3 file(s) under TypeScript 6.0.3; 0 cannot parse`.
**Residue report:** the script printed `3 converted clean, 0 in the residue`, but its typecheck is vacuous in a bare lab checkout (`typecheck: NOT RUN (no tsconfig.json at the root)`; the lab's tsconfig extends the core's), as ruled on #4276. The real residue was read by `tsc -p packages/lab/tsconfig.json --noEmit` in a core worktree at `CORE_REF` with this tree laid: 8 errors, all from two JSDoc `@typedef`s in `referral-repeat-share` (now `type` aliases) and two inline JSDoc `Error` casts in `claim-excludes-recompute` (now `as`). The JSDoc `any` the conversion kept is `Loose` (`src/capture/loose.ts`), as in #4277. The script rewrote only the self-mentions inside `scripts/`; the importers in `src/` (five test files, two comments, `layer-edges.baseline.json`) were edited by hand in commit 2. `claim-excludes-recompute.test.ts` spawned the script with plain `process.execPath`; it now goes through `--import tsx` like the other `.ts` scripts (the host's node has no type stripping, ADR 0043), and the three usage strings say `npx tsx`.

## Why 35 stay (measured by grepping each basename in the core at `CORE_REF` a7d6a41, and in `origin/main` of control, agent-org, screenreader-fleet, screenreader-worker, documents, toolchain)
- 33 of the 38 are named by path in the core's `package.json` scripts (lab CI reads the core at `CORE_REF`, so its `referenced-scripts`-style tests read the old name). The 5 not named there are `axe-calibration`, `calibrate-abstention` (both run by plain `/usr/bin/node` from `@a11ign/control`'s `ansible/lab-job.yml` argv), `bench-capture`, `claim-excludes-recompute`, `referral-repeat-share` (the three converted).
- `lab-job.yml`'s argv also names `build-realism-tier`, `stability-gate`, `gate-probe-order`, `lab-inventory`, `corpus-prune-orphans`, `fleet-hours`, `evidence-check`; the core's `.agent-org/units/a11ign-corpus-release-nightly.service` runs `corpus-release-nightly.mjs` by `ExecStart`; the core's scorer tests spawn `emit-grants-map.mjs`/`emit-unclosable-vetoes.mjs` and read `build-realism-tier.mjs` by path. A plain-node entry cannot import a `.ts` on the host.
- The three converted are named by nothing outside this repository except comments (screenreader-fleet `compare-workers.ts`, the core's `docs/`), and no held-back `.mjs` imports them (`git grep`, tests only).
- Rows #4276 and #4277 hold back their own files for the same reason; #4519 (last six) is the follow-up pattern. The 35 here need the same landing order across the core's `package.json`/units, control's `lab-job.yml` and the lab; I did not file it (not this row's Region).

Baseline before and after: `mjs-ratchet.baseline.json` 88 -> 85 (3 files). It is NOT empty: the end state the row names is not reachable in this PR.
`typecheck-coverage.test.ts`: the `.mjs` `@ts-check` floor 165 -> 162, reason in the file (three marked files became `.ts`, which `tsc` checks without a marker).

Host-install: none. None of the three converted is named by a deployed unit, an Ansible task or a `bin`.
Outside-Region: baselines/layer-edges.baseline.json -- the path string of a renamed file inside a baseline, rewritten with the rename
Outside-Region: scripts/build-realism-tier.mjs -- comment naming a renamed file (js-to-ts rewrote it)
Outside-Region: scripts/calibrate-abstention.mjs -- comment naming a renamed file (js-to-ts rewrote it)
Outside-Region: scripts/fleet-hours.mjs -- comment naming a renamed file (js-to-ts rewrote it)
Outside-Region: src/capture/evidence-diff.ts -- comment naming a renamed file
Outside-Region: src/capture/sweep-costs.ts -- comment naming a renamed file
Outside-Region: src/gates/bench-population.test.ts -- imports a renamed file; the specifier follows the rename
Outside-Region: src/gates/exit-code-contract.test.ts -- path strings of renamed files
Outside-Region: src/gates/referral-repeat-share.test.ts -- imports a renamed file; the specifier follows the rename
Outside-Region: src/packaging/typecheck-coverage.test.ts -- the `@ts-check` floor 165 -> 162
Outside-Region: src/training/claim-excludes-recompute.test.ts -- imports and spawns a renamed file (through tsx)
Outside-Region: src/training/wake-by-hand.test.ts -- path strings of a renamed file
No workflow file is touched.

## Evidence
- `tsc -p packages/lab/tsconfig.json --noEmit` in a core worktree at `CORE_REF` with this tree laid: 0 errors (8 before the residue fix).
- eslint (`--no-ignore`, the core's config) on the four changed files: 0 errors.
- `rstest run --include "packages/lab/**/*.test.ts"` in that core: this branch 9 failed of 4901; `origin/main` laid the same way 10 of 4901. The failing names of this branch are a subset of `origin/main`'s (diff of the two sorted name lists: only `no-worker-refusal ... REFUSES, far below the 620s` is absent here, a timing test). The 9 are the scratch layout's, not this diff's. The seven test files this diff touches: 70 passed.
- Rstest first red: `typecheck-coverage` said 162 of 185 before the floor was lowered.
- Open-row sweep: searched the open `a11ign/a11ign` rows (REST search) for `bench-capture`, `claim-excludes-recompute`, `referral-repeat-share`: one hit (#20, the daily board report, not a row that names a path in Region or Acceptance). **0 rows amended.**
- The rstest config the title names is the core's `scripts/rstest/rstest.config.mjs`, not a file of this repository and not in this row's Region; it is not touched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
