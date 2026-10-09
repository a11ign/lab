---
"@a11ign/lab": patch
---

Nine scripts and `src/gates/dispatch.ts` import the product's `git-env` and `npm-cli-executable` by their `.ts` names, the only files the product holds after its rename sweep, so `release:provenance` loads `promote-model.mjs` again. They need a Node that strips types (22.23 or later) (a11ign/a11ign#4568).
