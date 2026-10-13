Closes a11ign/a11ign#5401

Acceptance: `bash -c 'cd ~/repos/lab && git fetch -q origin && { git grep -q "lab-carried" origin/main -- src/packaging/post-qualification-status.test.ts || git grep -q "lab-carried" origin/agent/the-lab-asserts-control-5401 -- src/packaging/post-qualification-status.test.ts; }'`

## What changes
- `post-qualification-status.test.ts`: restores the carried-copy assertions that worker-5379 wrote at `fa977515` (blob `ba750672`) and narrowed away at `0e2fa473`. It imports control's `src/lab-carried.ts` (control v0.13.15, the `CONTROL_REF` lab CI lays, a11ign#5400) and asserts the carried copy returns the same payload as the original over every row of the table, that the same success rows reach `success` through it (the positive control), and that its constants and `exitCodeFor` are the originals'.
- `baselines/layer-edges.baseline.json`: one `moves-with:control` entry for the new reach into `packages/control/src/lab-carried.ts`, beside the entry for `post-qualification-status.ts`.

## Evidence (measured)
- Ran with `node --test` (node v24.21.0) in a CI-like scratch layout: `packages/lab/src` = this worktree, `packages/control/src` = control `v0.13.15`, `scripts/` and `.agent-org/` and the `packages/{guards,judge,scorer,evidence,cli}` sources from core `2b8489a8` (the lab's `CORE_REF`). Result: 31 of 31 pass, including the four carried-copy tests.
- Mutation, each restored from a copy and diffed byte-identical: the carried copy reports PASS as `failure` -> 4 fail; the carried copy's exit rule maps INCONCLUSIVE to 1 -> 2 fail. Unmutated -> 31 pass.
- `tsc --noEmit --strict` over the test file in the same layout: no error in the test file or in `lab-carried.ts`; 11 errors elsewhere in the scratch layout (`scripts/`, `guards`, control's `post-qualification-status.ts`), none of them in a changed file.

## Not done / open
- NOT RUN: `pnpm run lint`, the lab's `pnpm test` (rstest), and the layer-edges guard's own test. This checkout has no `node_modules`, and the lab's manifest names `@a11ign/control` and other workspace-only packages no registry holds, so the CI-like layout above is the only harness used. The lab CI run on the PR is the real check.
Outside-Region: `baselines/layer-edges.baseline.json`, one `moves-with:control` entry for the new control read the carried-copy assertion makes. Without it the layer-edges guard refuses the import as a NEW EDGE.
Fleet: No.
