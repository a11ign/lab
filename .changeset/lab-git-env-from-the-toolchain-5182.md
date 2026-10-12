---
"@a11ign/lab": patch
---

The lab's four scripts that clean the git environment (`check-rehearsal-currency.ts`, `claim-excludes-recompute.ts`, `evidence-check.ts`, `promote-model.ts`) import `sandboxGitEnv` from `@a11ign/toolchain/lib/git-env` instead of `../../guards/src/git-env.ts`, a two-level reach out of the lab that resolved only while the core laid the lab under its `packages/` (a11ign/a11ign#5182, epic #4425 done-when 3). `src/packaging/no-relative-core-imports.test.ts` no longer keeps a list of known reaches: a new one fails, and none is listed.
