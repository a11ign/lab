---
"@a11ign/lab": patch
---

`CORE_REF` in `.github/workflows/ci.yml` moves to `eb33d3c9850daccb0c36f356b0bfe9341bc267d2`, the commit after the last of a11ign/a11ign#4393's renames, which also drops the `estree` import the lab's `tsc` could not resolve. The lab's CI laid a core older than those renames, so agent-org's two synced copies (`git-sandbox.ts`, `tree-wide-guard.mjs`) read as drifted there and `agent-org-wiring.test.ts` [36] and [37] failed at agent-org v0.102.3 (a11ign/a11ign#4569).
