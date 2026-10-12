---
"@a11ign/lab": patch
---

Five lab files take the core's root by name, `coreRoot(...)` or `runsRoot()`, not by four `../` climbs out of the lab (a11ign/a11ign#5191, the follow-up to #5185). A standalone lab sets `A11Y_CORE_ROOT` (or the per-module variable), or these modules refuse at import, naming the variables. `core-root.test.ts` now scans for three or four climbs.
