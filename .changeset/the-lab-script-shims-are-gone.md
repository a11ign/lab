---
"@a11ign/lab": patch
---

The 35 one-release `scripts/*.mjs` shims are deleted (a11ign/a11ign#4798, step 5 of a11ign/a11ign#4551), with `src/transitional-shims.ts` and its test. `scripts/` holds no `.mjs`, `.js` or `.cjs`, and `mjs-ratchet.baseline.json` is lowered by the 35 names (79 to 44; the 44 left are `src/training/*.mjs`). Anything still running a lab script by its `.mjs` path now fails to find it: the core from `81c6680ad` and control v0.3.6 name the `.ts`. `CORE_REF` moves to `da027c092`, past the core's last `packages/lab/scripts/*.mjs` reference.
