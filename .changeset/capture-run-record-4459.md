---
"@a11ign/lab": patch
---

A capture run's fleet is recorded: `capture-fleet-guard.mjs` takes a `runRecord` option and, before either of its refusals can exit 3, appends `{ startedAt, readyCount, participants, excluded: [{ worker, reason }] }` to `runs/capture-runs.jsonl` through the new `capture-run-record.mjs`, with `reason` one of `inconsistent`, `asleep`, `down`. `readyCount` is what the guard's own `/health` probe saw answer; a figure the run did not read is `null`. The new `.mjs` joins `mjs-ratchet.baseline.json` because the guard is a plain-`node` entry's import and the host's Node has no type stripping (ADR 0043). `capture-real-pages.mjs` passes it to the check before the run, with the boxes the wake step left out (`asleep` when one `/health` probe returned nothing, else `down`), and a run that found nobody still writes a record with `readyCount: null` (a11ign/a11ign#4459).
