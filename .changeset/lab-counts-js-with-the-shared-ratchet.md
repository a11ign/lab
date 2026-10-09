---
"@a11ign/lab": patch
---

lab counts its `.js`/`.mjs`/`.cjs` source against a committed baseline (a11ign/a11ign#4262, the adoption half of #4243). `src/packaging/mjs-ratchet.test.ts` calls `checkMjsRatchet` from `@a11ign/toolchain/mjs-ratchet`, and `mjs-ratchet.baseline.json` records the reading at this commit: 113 files, no exceptions. The pin moves to `^0.1.4`, the release that carries the function. A new `.mjs` now fails the repository's own `pnpm test`; no workflow file is touched.
