---
"@a11ign/lab": patch
---

`board-gates`, `power-guard` and `real-page-drift-summary` in `src/training` are TypeScript, converted by `js-to-ts` (a11ign/a11ign#4276). The other 43 `.mjs` of the directory stay: a plain `node` entry (`lab-job.yml`'s `argv`, the core's `training:*` scripts) runs them or imports them, and the host's Node has no type stripping (ADR 0043).
