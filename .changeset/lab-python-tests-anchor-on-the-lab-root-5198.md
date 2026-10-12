---
"@a11ign/lab": patch
---

Eight of the lab's Python tests and two path constants in `scripts/evaluate-screenreader-acceptance.py` no longer resolve the core's monorepo layout (a11ign/a11ign#5198, after #5187). The evaluator reads `src/training/acceptance-matrix.mjs` and `src/training/accepted-acceptance-cases.json` from the lab root, which it would otherwise have failed to find on a lab checkout; the tests anchor on the lab root and read the shipped training report from `node_modules/@a11ign/scorer`. Nothing a consumer runs changes; the lab's Python tests are not yet a CI leg.
