Closes a11ign/a11ign#5423

Acceptance: `bash -c 'cd ~/repos/lab && git fetch -q origin && git checkout -q --detach origin/main && node --test src/gates/exit-code-contract.test.ts'`

Hand-run: the test imports the control package, which this job's bare checkout does not lay; run in the CI-equivalent layout (core 2b8489a8, screenreader-fleet v0.7.3, control v0.13.15, lab branch at packages/lab)

## Hand-run output
`node --test src/gates/exit-code-contract.test.ts`, node v24.21.0, this branch as `packages/lab` of that layout:

```
ℹ tests 13
ℹ pass 13
ℹ fail 0
```

Mutation: the `fleet-lock.ts` entry removed -> 1 test fails, naming it; the entry renamed to a path that does not exist -> 2 fail; each restored from a copy and diffed byte-identical, 13 pass.

## What changes
- `src/gates/exit-code-contract.test.ts`: classifies the four control files the cross-repo leg fails on (a11ign/a11ign#5413's lab half), each by the exit calls read from control v0.13.15 source: `fleet-converge.ts`, `fleet-dispatch.ts` and `fleet-lock.ts` are DOCUMENTED, `worker-fleet-carried.ts` is INFRASTRUCTURE. The entries are worker-5413's (lab `b56ff307`); every code in them was re-read from source here.

## Done-when 2 is NOT done here, and why
- `CORE_REF` is unchanged. Every core commit that holds a11ign/a11ign#5419's lines is past cut 9 (a11ign/a11ign#5087, `23a179418`, an ancestor of `87d89fde`), which deleted `layers.json` and `scripts/lay-layer.ts` and stopped `prepare` laying `packages/worker-fleet` and `packages/nvda-worker`. This file's `cp layers.json packages/control/layers.json` step fails there, and lab tests outside this row's Region read the laid layers. The move is its own row, a11ign/a11ign#5431.
- The test does not read the four docs lines: it reads `docs/gate-exit-codes.md` only to check it exists and names the dangerous shape. The classification alone turns the leg green at the current pin.

## Evidence (measured)
- Layout: core `2b8489a8` (the current `CORE_REF`), `packages/worker-fleet` = screenreader-fleet v0.7.3, `packages/control` = control v0.13.15, this tree as `packages/lab`; `node --test` v24.21.0.
- Before (`origin/main`'s test file): 12 pass, 1 fail, naming the four files as classified nowhere. After: 13 pass, 0 fail.
- Mutation, restored from a copy and diffed byte-identical: the `fleet-lock.ts` entry removed -> 1 fails, naming it; the entry renamed to a missing path -> 2 fail. Unmutated -> 13 pass.

Fleet: No.
