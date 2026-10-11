---
"@a11ign/lab": patch
---

The lab runs its own programs from its own root (ADR 0045 cut 1, a11ign/a11ign#5078). `scripts/generate-coverage-doc.ts` takes its root from its own location and reads `rule-ownership.json` there, writing `docs/coverage.md` under it or to `--out=<file>`, and refuses an ownership file that is empty or declares no subtypes. `package.json` gains the 70 scripts the core's `package.json` ran against the lab, with targets relative to this root, and `tsx` as a dev dependency they name. The product checks that read lab files arrive in `src/product-checks/` and `tests/`, reading `@a11ign/judge`, `@a11ign/scorer` and `@a11ign/evidence` by their published exports. The core keeps its copies until row 2.
