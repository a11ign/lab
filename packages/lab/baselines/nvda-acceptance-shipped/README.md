# The shipped NVDA reading of the held-out acceptance set

`gate:nvda-release` (`packages/lab/scripts/nvda-release-gate.mjs`) compares a release candidate's captures
of the held-out acceptance corpus against the readings stored here, field by field
(`compareCapture`/`nvda-release-regression.mjs`), and blocks a release whose evidence CHANGED against a
case captured here.

## What belongs here

`captures/<id>.good.json` and `captures/<id>.bad.json`, one pair per held-out acceptance case
(`packages/lab/src/training/acceptance-matrix.mjs`), in the same shape `readCapture`
(`packages/lab/src/capture/evidence-diff.mjs`) already reads everywhere else in this repo -- copied
straight from a real capture the currently-shipped code produced, never fabricated.

## Empty is a real, supported state

There is no snapshot here yet. `nvdaReleaseRegression()` treats a missing shipped reading as NEW COVERAGE
-- a NOTE, never a blocker, the same way `releasability.mjs` treats "no shipped model" -- so the gate
passes today and says so. The first time someone captures the held-out set with the code this repo has
actually shipped, copy that run's `captures/<id>.<variant>.json` files in here and commit them: from that
point on, every later release is compared against a real reading rather than against nothing.

## Keeping it current

After a release the gate has PASSED against, replace this snapshot with the candidate's own captures (the
ones the release just qualified), the same way `promote-model.mjs` copies the candidate's
`acceptance-report.json` into `packages/scorer/models/screenreader-scorer/` at promotion time. A snapshot
that is never refreshed stops being "shipped" and starts being "whatever we happened to capture once".
