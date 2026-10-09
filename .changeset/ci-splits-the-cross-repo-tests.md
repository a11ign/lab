---
"@a11ign/lab": patch
---

`ci.yml` runs the lab's tests in two legs: `checks (own)`, required through `gate`, and `checks (cross-repo)`, which cannot block a pull request. `scripts/cross-repo-tests.ts` assigns each test file: one that resolves a path above the lab root, or uses the tool, is cross-repo (223 of 419 measured at this commit), because its verdict moves with another repository's tree. Lint and the typecheck run in `own` only. `ci.yml` also runs on `push` to `main` and nightly, so a red lab baseline shows the hour it happens (a11ign/a11ign#4588).
