Closes a11ign/a11ign#5198

Acceptance: `bash -c 'python3 -m pytest -q tests/test_accepted_acceptance_cases.py tests/test_criterion_with_no_head.py tests/test_near_cut_negatives.py tests/test_miss_above_the_floor.py tests/test_unclosable_map_is_current.py tests/test_grants_map_is_current.py tests/test_acceptance_cases_exist.py tests/test_acceptance_case_definitions.py'`

Mutation: run from this worktree with the `.venv` of the core checkout (it holds pytest 9.1.1), each restore a byte-identical copy of the branch (`diff` empty). Setting `ACCEPTED_CASES_FILE` back to `REPO_ROOT / "packages/lab/src/training/accepted-acceptance-cases.json"` alone fails 19 tests, all in `tests/test_accepted_acceptance_cases.py` and no other file. Setting `ACCEPTANCE_MATRIX` back to `./packages/lab/src/training/acceptance-matrix.mjs` alone fails 6, three in each of `tests/test_acceptance_case_definitions.py` and `tests/test_acceptance_cases_exist.py` and no other file.

Before: `pytest -q --continue-on-collection-errors tests/` at origin/main `43e59160` reads 39 failed, 150 passed, 2 errors (6 files failing, `test_accepted_acceptance_cases.py` and `test_criterion_with_no_head.py` erroring at collection). After: the Acceptance command reads 86 passed, and `pytest -q tests/` over the whole tree reads 214 passed, 0 failed, 0 errors.

Premise corrected: `tests/test_grants_map_is_current.py` (3 failures) and `tests/test_unclosable_map_is_current.py` (4) were never a path defect. They already anchor on the lab root and run `scripts/emit-*.ts` under Node, which could not import `@a11ign/evidence` and `@a11ign/screenreader-fleet/cli-flags` because the host had neither installed. With the declared `@a11ign/evidence` 0.5.0 and `@a11ign/screenreader-fleet` 0.5.3 extracted from `npm pack` into `node_modules` (no script run), both files pass unedited: 7 passed. They are in the diff by no change.

Outside-Region: `.changeset/lab-python-tests-anchor-on-the-lab-root-5198.md` -- `changeset-required` lists `scripts/` as releasable and this PR edits one.

Not changed, and why: `TRACKED_SOURCE_DIR = "packages"` in the evaluator is matched as a path component of the report being stamped and resolves no path; `tests/test_acceptance_gate_refuses.py` and `tests/test_no_writes_into_source_tree.py` (outside the Region, and passing) pin it. It no longer covers the shipped model's report, which lives under `node_modules/@a11ign/scorer/models/` since lab#96, so re-anchoring it is a behaviour change that needs its own test and is filed as its own row.

Not run here: the lab's `pnpm run verify`, lint and typecheck (no lockfile and no full install on this host; CI's `checks` job is that verification). The change is Python and one comment-and-constant edit, touching no `.ts` or `.mjs`.
