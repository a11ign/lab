---
"@a11ign/lab": patch
---

The lab now holds the 14 Python tests of the scorer's lab scripts that left the core (a11ign/a11ign#5187, after a11ign#5087). They run from the lab's own checkout: `scripts/evaluate-screenreader-acceptance.py`, `scripts/audit-scorer-shortcuts.py`, `scripts/train-screenreader-model.py` and `scripts/diagnose-false-positives.py` anchor on the lab root and read `@a11ign/scorer` from `node_modules`, and `scripts/fixtures/calibration-verdicts.json` comes with them. Nothing a consumer runs changes; the lab's Python tests are not yet a CI leg.
