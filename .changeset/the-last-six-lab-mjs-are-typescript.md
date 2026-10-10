---
"@a11ign/lab": patch
---

The six `.mjs` files lab sweep 2 left behind are TypeScript: `src/gates/qualification-status.ts` and `src/harnesses/{assert-action-report,capture-check,capture-fixtures,occurrence-verdict-stability,page-identity-rate}.ts` (a11ign/a11ign#4519, step 1 of 5). Each old `.mjs` name stays for ONE release as a shim, because the core's `package.json` and workflows at the `CORE_REF` this repository's CI pins name the harnesses by path, and `@a11ign/control` v0.3.2 imports `qualification-status.mjs`: the gate's shim re-exports, and each harness shim THROWS (a re-export would exit 0 having measured nothing). They go in the release after control's import and the core's callers name the `.ts`.
