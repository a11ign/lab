Closes a11ign/a11ign#5379

Acceptance: `bash -c 'for ref in origin/main origin/agent/the-lab-holds-the-5379; do git cat-file -e "$ref:src/packaging/real-pages-role-coverage.test.ts" 2>/dev/null && git cat-file -e "$ref:src/packaging/lab-job-catalogue-scripts.test.ts" 2>/dev/null && git grep -q lab-carried "$ref" -- src/packaging/post-qualification-status.test.ts && exit 0; done; exit 1'` (run from the lab root after `git fetch origin`). It is the row's command amended to `origin/main || origin/<PR branch>`, as product-manager directed, so it can pass before the merge.

## What changes
- `post-qualification-status.test.ts`: imports control's carried copy (`../../../control/src/lab-carried.ts`) and asserts it returns the SAME payload as the original over every row of the existing table, that its constants and `exitCodeFor` match the originals, and keeps the positive control (the copy reaches `success` through exactly the PASS and exit-0 rows).
- `real-pages-role-coverage.test.ts` (new): moved from control's `src/lab-pipeline.test.ts`. Every non-fixture role in `REAL_PAGES` must be captured by `PIPELINES["real-pages"]`'s `capture-real-pages` stages. Positive control: `scored` is non-empty.
- `lab-job-catalogue-scripts.test.ts` (new): moved from control's `src/control-owned/lab-job.test.ts`. Two checks: a dispatching gate in `scripts/` that the catalogue runs must carry `--local`; `axe-calibration`'s declared `exitMeanings` must each appear as `process.exitCode = N` in its script. Positive control: at least two dispatching gates are discovered.

## Evidence (measured)
- Ran with `node --test` (node v24.21.0) in a CI-like scratch layout built from core `2b8489a8` (the lab's `CORE_REF`): `packages/lab` = this worktree, `packages/control` = control `origin/main`, `packages/lab/node_modules/@a11ign/control` linked to it. Result: `tests 34 / pass 34 / fail 0`.
- Mutations, each restored from a copy and re-run: carried-copy drift (exit-code rule changed) -> 1 fail; phantom corpus role never captured -> 1 fail; `--local` removed from `gate-probe-order` in the catalogue -> 1 fail; `axe-calibration` exit codes no longer set -> 1 fail. Restored: 34/34.

## Not done / open
- NOT RUN: `pnpm run lint`, the typecheck, and `pnpm test` (rstest). This checkout has no `node_modules`, and `@a11ign/control` is not on a registry, so the CI-like layout above is the only harness used.
- CI PIN: the lab's CI lays control at the core's pinned tag `v0.5.3` (`layers.json`), and `src/lab-carried.ts` does not exist at that tag (it first appears after v0.13.15). So `post-qualification-status.test.ts` fails at import in lab CI until the control pin moves. The other two new files are green at v0.5.3 (`lab-pipeline.ts`, `PIPELINES`, and `exitMeanings` all exist there).
- Premise: control PR #87 (a11ign/control, merged 2026-10-13T06:21:30Z, merge `72bd32e`) landed before this row was filed, so control's `main` has already lost the three assertions. The coverage lapse is on control `main` until this PR merges.

Outside-Region: none
Fleet: No.
