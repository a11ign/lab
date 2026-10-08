---
"@a11ign/lab": patch
---

`calibrate-abstention.mjs` also writes `runs/abstention/calibration-judgments.json`: each scored page's findings (`wcag`, the quoted `evidence`, `mapping`) beside its `cantTell` and `predicted` criteria, so the referral repeat share can be counted per page. `abstention-sweep.json` is unchanged (a11ign/a11ign#4293, #4241).
