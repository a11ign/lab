---
"@a11ign/lab": patch
---

`src/eval/pages/books/filter-status-checkbox-polite.html` is the §31 condition the calibration set lacked: one checkbox whose `change` handler synchronously rewrites a `role="status"` count, with no timer. It is kept out of `src/training/case-matrix.mjs` because an intermittent case teaches the model noise. `src/eval/filter-status-checkbox-polite.test.ts` pins the three properties that define the condition and runs the same predicate on `filter-status-good.html` as a positive control. a11ign/a11ign#4567.
