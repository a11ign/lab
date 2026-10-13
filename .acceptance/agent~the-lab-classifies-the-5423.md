Closes a11ign/a11ign#5423

Acceptance: `bash -c 'cd ~/repos/lab && git fetch -q origin && { git grep -q --all-match -e "packages/control/src/fleet-converge.ts" -e "packages/control/src/fleet-dispatch.ts" -e "packages/control/src/fleet-lock.ts" -e "packages/control/src/worker-fleet-carried.ts" origin/main -- src/gates/exit-code-contract.test.ts || git grep -q --all-match -e "packages/control/src/fleet-converge.ts" -e "packages/control/src/fleet-dispatch.ts" -e "packages/control/src/fleet-lock.ts" -e "packages/control/src/worker-fleet-carried.ts" origin/agent/the-lab-classifies-the-5423 -- src/gates/exit-code-contract.test.ts; }'`

Mutation: the `fleet-lock.ts` entry removed -> 1 test fails, naming it; the entry renamed to a path that does not exist -> 2 fail; each restored from a copy and diffed byte-identical, 13 pass.

## What the Acceptance does and does not prove
- It is the structural half: all four paths are classified in the test file, on `origin/main` or on this branch (the row's own idiom, as a11ign/lab#112). It runs in the acceptance job's bare checkout.
- The row's own command, `node --test src/gates/exit-code-contract.test.ts` at `origin/main`, cannot pass in that bare checkout: `ERR_MODULE_NOT_FOUND: Cannot find package '@a11ign/toolchain'` (measured at lab `53a8afa3`), so it needs the cross-repo layout. That run is below, and the leg on lab `main` after the merge is the real check.

## Run in the CI-equivalent layout (measured)
`node --test src/gates/exit-code-contract.test.ts`, node v24.21.0, this branch as `packages/lab` of core `2b8489a8` (the current `CORE_REF`), `packages/worker-fleet` = screenreader-fleet v0.7.3, `packages/control` = control v0.13.15:

```
ℹ tests 13
ℹ pass 13
ℹ fail 0
```

`origin/main`'s test file in the same layout: 12 pass, 1 fail, naming the four files as classified nowhere.

## What changes
- `src/gates/exit-code-contract.test.ts`: classifies the four control files the cross-repo leg fails on (a11ign/a11ign#5413's lab half), each by the exit calls read from control v0.13.15 source: `fleet-converge.ts`, `fleet-dispatch.ts` and `fleet-lock.ts` are DOCUMENTED, `worker-fleet-carried.ts` is INFRASTRUCTURE. The entries are worker-5413's (lab `b56ff307`); every code in them was re-read from source here.

## Done-when 2 is NOT done here, and why
- `CORE_REF` is unchanged. Every core commit that holds a11ign/a11ign#5419's lines is past cut 9 (a11ign/a11ign#5087, `23a179418`, an ancestor of `87d89fde`), which deleted `layers.json` and `scripts/lay-layer.ts` and stopped `prepare` laying `packages/worker-fleet` and `packages/nvda-worker`. This file's `cp layers.json packages/control/layers.json` step fails there, and lab tests outside this row's Region read the laid layers. The move is its own row, a11ign/a11ign#5431.
- The test does not read the four docs lines: it reads `docs/gate-exit-codes.md` only to check it exists and names the dangerous shape. The classification alone turns the leg green at the current pin.

Fleet: No.
