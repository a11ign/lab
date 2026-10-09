---
"@a11ign/lab": patch
---

`CORE_REF` in `.github/workflows/ci.yml` moves to `989c2bcc3c6a3d350cb5d0eb7e612771dfb8589a` (core #4599), a core after the last of a11ign/a11ign#4393's renames and after the `// STAYS npm` marker on `scripts/release-tags-complete.ts` (a11ign/a11ign#4594), which `no-npm-spawn.test.ts` now allowlists. The lab's CI laid a core older than those renames, so agent-org's two synced copies (`git-sandbox.ts`, `tree-wide-guard.mjs`) read as drifted there and `agent-org-wiring.test.ts` [36] and [37] failed at agent-org v0.102.3 (a11ign/a11ign#4569).
