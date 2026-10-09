---
"@a11ign/lab": patch
---

`src/training/page-server.mjs` imports the product's CLI helper as `scripts/npm-cli-executable.ts`, the name it has had since a11ign#4393 renamed it from `.mjs`. The old `.mjs` specifier made `capture-regression` fail at start in `release.yml` (`ERR_MODULE_NOT_FOUND`, before any capture), and nothing in lab saw it because the lab's own tests do not import that path through a loader. Only the import line changes.
