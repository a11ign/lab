---
"@a11ign/lab": patch
---

`release-triggers-itself.test.ts` finds the core's three `node scripts/…` guard steps again (a11ign/a11ign#4837). The core dropped the `--import tsx` loader from its workflows' `node` calls (#4597) and the test's predicates for `manifest-repository-check`, `release-gate-scope` and `generate-consumer-gate --check` named only the old spelling, so every property read the three guards as missing and 18 of its 32 tests were red at core `c18c2dab7`. Both spellings are the one guard now, with a control that rewrites the live steps each way and one that a step running another script is still refused. No behaviour of the lab's own code changes.
