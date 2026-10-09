---
"@a11ign/lab": patch
---

3 of the 38 `.mjs` files in `scripts/` are TypeScript, converted by `js-to-ts` (a11ign/a11ign#4278): `bench-capture`, `claim-excludes-recompute` and `referral-repeat-share`; `mjs-ratchet.baseline.json` 88 -> 85. The other 35 stay `.mjs` because each is named by path in the core's `package.json`, a deployed unit, or `@a11ign/control`'s `lab-job.yml`, at refs this repository's CI pins; they move with their callers (a11ign/a11ign#4519). The three run through `npx tsx`, and their usage strings say so.
