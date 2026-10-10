---
"@a11ign/lab": patch
---

The lab's tests import `@a11ign/toolchain/lib/*` (`tree-wide-guard`, `local-import-closure`, `sandbox-exhaustion`, `walk-scope-discovery`, `test-memory-cap`, `git-sandbox`, `product-home`, `fixture-symbols`) and no longer name the core's deleted copies, and `CORE_REF` moves to core `c18c2dab7` (a11ign/a11ign#4822). The tests that follow the core's moved contracts are updated with it: the tree-wide-guard discoverer (#4718), the `.mjs` to `.ts` of worker-fleet, the hook's toolchain cap. No behaviour of the lab's own code changes.
