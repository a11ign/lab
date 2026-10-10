---
"@a11ign/lab": patch
---

The six one-release shims are deleted (a11ign/a11ign#4519, step 5 of 5): `src/gates/qualification-status.mjs` and `src/harnesses/{assert-action-report,capture-check,capture-fixtures,occurrence-verdict-stability,page-identity-rate}.mjs`. `src/gates` and `src/harnesses` hold no `.mjs`, and `mjs-ratchet.baseline.json` is lowered by the six. Anything still importing `qualification-status.mjs` (`@a11ign/control` v0.3.4 and earlier) or running a harness by its `.mjs` path now fails to resolve it; control v0.3.5 imports the `.ts`.
