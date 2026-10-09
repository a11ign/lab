---
"@a11ign/lab": patch
---

`capture-screenreader-dataset.mjs` appends the same per-run record to `runs/capture-runs.jsonl` that `capture-real-pages.mjs` does (`{ startedAt, readyCount, participants, excluded }`), including a run that finds nobody. It is not put behind the fleet guard, so it reads no ready count and writes `readyCount: null`. A record that cannot be written is said on stderr and never changes the run's exit (a11ign/a11ign#4462, #4459).
