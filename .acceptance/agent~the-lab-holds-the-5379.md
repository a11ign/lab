Closes a11ign/a11ign#5379

Acceptance: `bash -c 'for ref in origin/main origin/agent/the-lab-holds-the-5379; do git cat-file -e "$ref:src/packaging/real-pages-role-coverage.test.ts" 2>/dev/null && git cat-file -e "$ref:src/packaging/lab-job-catalogue-scripts.test.ts" 2>/dev/null && exit 0; done; exit 1'` (run from the lab root after `git fetch origin`). It is the row's command amended to `origin/main || origin/<PR branch>`, as product-manager directed, so it can pass before the merge. The row's Acceptance no longer greps `lab-carried`: the carried-copy assertion is a11ign#5401.

## What changes
- `post-qualification-status.test.ts`: unchanged, left as on `main`. The `lab-carried` import and the carried-copy assertion are removed; that assertion is a11ign#5401, edged under a11ign#5400 (lab CI names the control tag it lays) and under this row's merge.
- `real-pages-role-coverage.test.ts` (new): moved from control's `src/lab-pipeline.test.ts`. Every non-fixture role in `REAL_PAGES` must be captured by `PIPELINES["real-pages"]`'s `capture-real-pages` stages. Positive control: `scored` is non-empty.
- `lab-job-catalogue-scripts.test.ts` (new): moved from control's `src/control-owned/lab-job.test.ts`. Two checks: a dispatching gate in `scripts/` that the catalogue runs must carry `--local`; `axe-calibration`'s declared `exitMeanings` must each appear as `process.exitCode = N` in its script. Positive control: at least two dispatching gates are discovered.
- `baselines/layer-edges.baseline.json`: one entry, for `lab-job-catalogue-scripts.test.ts` -> `packages/control/ansible/lab-job.yml`. The entry for `post-qualification-status.test.ts` -> `lab-carried.ts` is removed with its import, since a baseline entry with no edge is a `STALE ENTRY`.

## Evidence (measured)
- Ran with `node --test` (node v24.21.0) in a CI-like scratch layout built from core `2b8489a8` (the lab's `CORE_REF`): `packages/lab` = this worktree, `packages/control` = control `origin/main`, `packages/lab/node_modules/@a11ign/control` linked to it.
- Mutations, each restored from a copy and re-run: phantom corpus role never captured -> 1 fail; `--local` removed from `gate-probe-order` in the catalogue -> 1 fail; `axe-calibration` exit codes no longer set -> 1 fail.

## Not done / open
- NOT RUN: `pnpm run lint`, the typecheck, and `pnpm test` (rstest). This checkout has no `node_modules`, and `@a11ign/control` is not on a registry, so the CI-like layout above is the only harness used.
- The layer-edges guard's own test was not run locally (the scratch layout is not a git-tracked lab tree).
- CI PIN: the lab's CI lays control at the core's pinned tag `v0.5.3` (`layers.json`), where `src/lab-carried.ts` does not exist. This row's files do not import it, so the pin no longer blocks this PR; a11ign#5400 owns the pin for #5401.
- Premise: control PR #87 (a11ign/control, merged 2026-10-13T06:21:30Z, merge `72bd32e`) landed before this row was filed, so control's `main` has already lost the three assertions. Accepted by product-manager. The two held assertions are restored by this PR's merge; the third is #5401.

Outside-Region: baselines/layer-edges.baseline.json — one `checkout-path` entry for the control read `lab-job-catalogue-scripts.test.ts` makes (`packages/control/ansible/lab-job.yml`), because the layer-edges guard refused it as NEW EDGE in CI.
Fleet: No.
