---
"@a11ign/lab": patch
---

`refuse_to_stamp_source_tree` in `scripts/evaluate-screenreader-acceptance.py` now refuses a report inside `node_modules/` as well as `packages/`. The shipped model's training report lives in the installed `@a11ign/scorer` package since lab#96, so the guard that was written for `packages/` let a stamp into it through (a11ign/a11ign#5200). The refusal's hint now names the `node_modules/@a11ign/scorer` path to copy from. Nothing a consumer runs changes: a run that writes under `runs/` is still allowed.
