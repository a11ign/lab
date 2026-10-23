---
"@a11ign/lab": patch
---

Add batch 2 of the real-page corpus (A11-170): `BATCH_2_PAGES`, 120 addresses drawn by ADR 0010's selection rule (seed `A11-170`, round-robin over the conformant publishers the corpus already cites, from their own sitemaps snapshotted in `src/training/real-page-batch-2/`), for the announcement emulator's final Gate (A11-166). Deliberately outside `REAL_PAGES` and with no `role`, so no lab reader can capture or score one before that freeze.
