Closes: none -- fix-forward for a11ign/lab#81, which merged (or is queued) with `checks (cross-repo)` red on two tests it caused; #81's branch could not be updated once queued, and its row (a11ign/a11ign#5078) closes on #81's merge

`checks (cross-repo)` on a11ign/lab#81 failed in two core tests that read the lab's tree, both caused by that change (run 38151196621, read from its job log; main's leg was green at `6288cfff`):

- `every-test-file-is-run.test.ts`: `packages/lab/scripts/generate-coverage-doc.test.ts` is reached by no runner glob (the core's globs are `packages/*/src/**`). The test now lives at `src/product-checks/generate-coverage-doc.test.ts`, inside the row's own Region and under a glob.
- `layer-edges.test.ts`: three new edges. Two are cut (a `packages/scorer/python` literal in a docstring; a bare `"scripts"` literal). The third, `scripts-name-real-files.test.ts -> package.json`, is this repository's own manifest, which the detector resolves against the core's root; it is baselined `checkout-path` like the 47 other reads of that name, with the reason.

Acceptance: `bash -c 'test -f src/product-checks/generate-coverage-doc.test.ts && ! test -e scripts/generate-coverage-doc.test.ts && grep -q "scripts-name-real-files.test.ts" baselines/layer-edges.baseline.json && ! grep -q "packages/scorer/python" tests/_scorer_python.py'` (run from the lab root)

Measured locally (core `8c26afab5` with this lab laid at `packages/lab` and staged with `git add -f`, control not laid): `layer-edges.test.ts` reports 0 `NEW EDGE` lines and no `STALE ENTRY` outside `packages/control` (those are the layer this layout does not hold); `every-test-file-is-run.test.ts` passes; `src/product-checks/` 23 tests in 8 files pass; the three Python tests 10 passed.

Not checked: this pull request's own `checks (cross-repo)` log is the reading for the leg.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
