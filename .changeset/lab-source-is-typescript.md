---
"@a11ign/lab": patch
---

22 of the 28 `.mjs` files in `src/packaging`, `src/gates`, `src/harnesses`, `src/capture` and `src/dataset-paths` are TypeScript, converted by `js-to-ts` (a11ign/a11ign#4277); `mjs-ratchet.baseline.json` 110 -> 88. Six stay `.mjs` because another repository names them by path: `src/gates/qualification-status.mjs` (imported by `@a11ign/control`'s `post-qualification-status`) and the five `src/harnesses` files `assert-action-report`, `capture-check`, `capture-fixtures`, `occurrence-verdict-stability` and `page-identity-rate` (named by the core's workflows and `package.json` scripts, which CI reads at the pinned `CORE_REF`). The JSDoc `any` that the conversion kept is one alias, `Loose` in `src/capture/loose.ts`.
