Closes a11ign/a11ign#4462

Acceptance: `node --test src/training/capture-screenreader-dataset-record.test.ts`

Mutation: five breaks, each restored by copy and diffed byte-identical, each failing the new test and no other: (1) delete the `recordDatasetRun(run, checked ?? [lease.worker])` call: 1 fail; (2) add an import of `./capture-fleet-guard.mjs` to the dataset script: 1 fail; (3) `readyCount: 0` in `recordUnguardedRun`: 3 fail; (4) rethrow instead of reporting an unwritable record: 1 fail; (5) report on a successful write: 1 fail. Green after all five restores: 9 of 9.

## What changes
`recordUnguardedRun` in `capture-run-record.mjs` (the builder #4459 added) writes the record for a run that never passes the fleet guard: `readyCount: null`, `participants` the boxes used, `excluded` the named boxes that were not (probed as `absentFrom` does). `capture-screenreader-dataset.mjs` calls it once the pool is checked and before the first case, and with no participants when acquiring or checking the pool throws. It does NOT import the guard (the ruling on #4462).

## Not run, and why
The test drives the helper with stubbed probes and reads the script's wiring as text: the script cannot be imported in a lab checkout (`page-server.mjs` and `fleet-wake.ts` resolve into the core and control). `tsc` is vacuous in a bare lab checkout (the lab's tsconfig extends the core's; the untouched `capture-run-record.test.ts` reports the same TS7016/TS7006). No fleet or lab command was run. The early exits before any worker is acquired (power refusal, bad `--only=`) write no record: nothing was probed.

Outside-Region: src/training/capture-run-record.mjs — gains `recordUnguardedRun`, the shared helper the dataset script calls (the Region named the script and its test only; a helper in the script cannot be imported by a test here)
