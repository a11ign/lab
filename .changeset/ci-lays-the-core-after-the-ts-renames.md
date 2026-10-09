---
"@a11ign/lab": patch
---

`CORE_REF` in `.github/workflows/ci.yml` moves to `f3b5c5f595428bdfd970bd8ab6cf55edc770cf88`, the last commit of a11ign/a11ign#4393's renames. The lab's CI laid a core older than those renames, so agent-org's two synced copies (`git-sandbox.ts`, `tree-wide-guard.mjs`) read as drifted there and `agent-org-wiring.test.ts` [36] and [37] failed at agent-org v0.102.3 (a11ign/a11ign#4569).
