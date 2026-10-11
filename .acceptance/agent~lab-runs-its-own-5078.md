Closes a11ign/a11ign#5078

ADR 0045 cut 1 of 9, lab side: the generator runs from the lab's own root, the lab's `package.json` holds the 70 scripts the core runs for it, and the product checks that read lab files arrive here. The core is untouched (its copies go in row 2).

**Region note.** Two files outside the row's Region are touched, one line each: `src/packaging/generated-paths.test.ts` and `src/packaging/user-facing-docs-file-facts.test.ts` run the generator from the CORE's root and read the core's `docs/coverage.md`; with the root now the generator's own location they pass `--out=docs/coverage.md`. Without it they read an absent or stale page.

Acceptance: `bash -c 'r=rules; ! grep -q "packages/lab" scripts/generate-coverage-doc.ts && test -f src/product-checks/coverage-doc.test.ts && for n in docs:coverage training:preflight "$r:gate" corpus:release; do grep -q "\"$n\":" package.json || exit 1; done'` (run from the lab root. It is the row's own command made to run here: the row's names `/home/agent/repos/lab`, the primary checkout, which holds this change only after the merge, and counts the four script names with one `grep -c`; the loop asks for each by name, and `"$r:gate"` is spelled in two parts so the acceptance reader does not take the NAME of a script for a run of it.)

Hand-run: the row's own command, with `L=/home/agent/repos/lab`, after the primary checkout is moved to the merge. Output goes on the row.

## The 70 scripts

All 70 are present under the core's names, plus `docs:coverage`, which is one of the 70. Targets are the core's with `packages/lab/` removed. Two spellings changed because they named the core: `node scripts/pnpm.ts run --silent X` is `pnpm run --silent X` (three `scorer:shortcuts*` scripts), and `packages/scorer/models/screenreader-scorer` is `node_modules/@a11ign/scorer/models/screenreader-scorer` (`scorer:verify`, `training:evaluate-acceptance:shipped`), which the published `@a11ign/scorer@0.3.4` tarball holds (read with `npm pack`). None is left out. `tsx` joins the dev dependencies at the core's range (`^4.23.15`) because 16 of the scripts name it (counted with `node` over the manifest). `scripts-name-real-files.test.ts` pins that every script's target file exists.

`runs/...` arguments are kept as written: they are the lab's own working corpus path relative to its root, not a path into the core.

## The product checks

The row counted twelve; reading the core for every test that touches `packages/lab` found thirteen (`model-input.test.ts` reads two lab files and was not in the count).

| core test | state |
|---|---|
| `judge/asserting-subtypes.test.ts` | **moved** (membership of the four asserting subtypes: `src/product-checks/rule-ownership.test.ts`, reading `@a11ign/judge/act-rules`). The half that reads the core's `CLAUDE.md` stays: it is the core's file. |
| `judge/subtype-ownership.test.ts` | **moved** (vocabulary, counts: `rule-ownership.test.ts`). The half that reads `criterion-coverage.ts` TEXT stays: a published export holds the values, not the prose around them. |
| `judge/coverage-doc.test.ts` | **moved**: `src/product-checks/coverage-doc.test.ts` |
| `scorer/tests/test_grants_map_is_current.py` | **moved**: `tests/` (featurizer from the published `@a11ign/scorer`'s `python/`) |
| `scorer/tests/test_unclosable_map_is_current.py` | **moved**: `tests/` (emits into a `RUNS_ROOT` of its own) |
| `scorer/tests/test_shortcuts_baseline_is_current.py` | **moved**: `tests/` |
| `judge/route-navigated-is-not-evidence.test.ts` | **moved** for the lab's file (`route-navigated-is-not-evidence.test.ts`). The `packages/` walk and the Python featurizer are the core's. |
| `scorer/record-builders.test.ts` | **moved** for the three lab builders (`record-builders.test.ts`). `score.py` is the scorer's. |
| `scorer/model-input.test.ts` | **moved** (`model-input-builders.test.ts`). |
| `judge/interaction-declarations.test.ts`, `judge/structure-declarations.test.ts` | **named consumer moved** (`wire-type-declarations.test.ts`: `judge-file.ts` derives from the wire types). The tree-wide scan **waits on a11ign/a11ign#5092** (the detector is a test helper, not an export). |
| `cli/probe-consent.test.ts` | **waits on a11ign/a11ign#5091**: it compares the CLI's defaults, which `a11ign` does not export, to the lab's real-page body. |
| `judge/fitness/rules-fitness-cases.test.ts` | **not moved, no producer row**: it compares the product's copy of the fitness cases to the lab's by reading both, which rule 2 forbids from either side, and its own title says to delete it with the lab's copies. That is row 2's to carry. |

The two edges are **not** added to #5078: the engineer brief (#4437) says a row is one deliverable and a claim is not held for what is found beyond it, so both are new rows that name this test, not blockers.

## Measured

- **Generator, `src/product-checks/generate-coverage-doc.test.ts`:** 6 tests pass. From a fixture root holding a `rule-ownership.json` (a copy of the generator in its `scripts/`, run from a third directory) it writes `docs/coverage.md` there with the `GENERATED by` line, `assessed` above zero and `` `missing-alt` rules `` from the fixture. An empty file, a file with `{"subtypes": {}}` and an absent file each exit non-zero and write no page.
- **Product checks, `src/product-checks/`:** 17 tests in 7 files pass. **Python:** `pytest tests/test_grants_map_is_current.py tests/test_unclosable_map_is_current.py tests/test_shortcuts_baseline_is_current.py`: 10 passed.
- **The lab's own-scope suite** in the core's rstest config with the lab laid at `packages/lab` (core `8c26afab5`, no `control` or `screenreader-fleet` layer laid): origin/main's lab `30 of 1469 tests failed in 200 files`; this head `30 of 1491 tests failed in 207 files`. The two failure sets are identical by name (`comm` of the sorted lists is empty both ways); the 22 added tests (16 + 6) all pass. The same 30 fail on origin/main, so they are not this change; this layout lacks the `control` and `screenreader-fleet` layers, which I did not confirm per failure. `src/packaging/generated-paths.test.ts` and `user-facing-docs-file-facts.test.ts` run in the cross-repo scope: 14 of 15 pass, the one failure is `packages/control has a README` (control not laid).
- **Lint:** `eslint --no-ignore` over the touched paths, 0 errors, 0 warnings. **Typecheck:** `tsc -p packages/lab/tsconfig.json`: 0 errors in the touched files; 33 in the tree, all `Cannot find module` for `control`/`worker-fleet` (not compared against origin/main). `layout-check`: ok.

## Mutation

Each in the laid copy, restored byte-identical (`cmp`) every time.

- **The three-up root restored** in the generator: 4 of 6 red in `generate-coverage-doc.test.ts`, the fixture-root positive test among them (the row's mutation), plus the own-ownership test, the no-subtypes message and the source pin.
- **The empty-declaration refusal never fires:** 1 of 6 red, the `{"subtypes": {}}` test only.
- **`route-navigated`:** the `signal-predicates.mjs` exception removed: 2 of 3 red (the scan, and the guard on the guard, which then names a path that does not exist).
- **`record-builders`:** the realism tier stops writing `observation:`: 1 of 2 red. **`model-input-builders`:** the export script's `modelInput(` renamed: 1 of 1 red. **`rule-ownership`:** the first `rules` owner turned `overlap`: the asserting-set test red, 1 of 3. **`wire-type-declarations`:** `Pick<CaptureStructure` renamed in `judge-file.ts`: 1 of 2 red. **`scripts-name-real-files`:** `scripts/explain-scorer.ts` renamed to a missing file in `package.json`: 1 of 4 red.
- **Python:** `A11Y_SCORER_PYTHON=/nonexistent` makes collection of `test_shortcuts_baseline_is_current.py` error.

## Not checked, and what the move does not do

- **The lab's CI on this pull request** is the merge check for the tests; nothing here ran it.
- **Running the 70 scripts.** They were not run (the resource ban); only that each target file exists.
- **The programs still assume the core above them.** Of the 61 scripts whose target is a `.ts`/`.mjs` file, 52 import, through their relative imports, a path of `../../../` (`src/dataset-paths.ts` computes `REPO_ROOT` that way, 51 non-test files use it; 13 import the core's or a layer's code by that route). Measured with a one-off walk of each script's relative imports at this head. So the scripts are right from the lab's root in the shape CI lays it (`packages/lab`) and are not yet right from a standalone checkout. That is the programs' own root, outside this row's Region, and it is for `product-manager` to place among the remaining cuts. `.venv/bin/python` is the same: relative to the working directory, as in the core.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
