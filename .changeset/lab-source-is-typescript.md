---
"@a11ign/lab": patch
---

27 of the 28 `.mjs` files in `src/packaging`, `src/gates`, `src/harnesses`, `src/capture` and `src/dataset-paths` are TypeScript, converted by `js-to-ts` (a11ign/a11ign#4277); `mjs-ratchet.baseline.json` 110 -> 83. `src/gates/qualification-status.mjs` stays `.mjs` until `@a11ign/control`'s `post-qualification-status` imports it under its new name. The JSDoc `any` that the conversion kept is one alias, `Loose` in `src/capture/loose.ts`.
