Closes a11ign/a11ign#5200

Acceptance: `python3 -m pytest -q tests/test_acceptance_gate_refuses.py tests/test_no_writes_into_source_tree.py`

Hand-run from the lab worktree root with `.venv` (pytest 9.1.1, numpy 2.5.4) first on `PATH`, and `node_modules/@a11ign/scorer` at 0.3.1 copied from a sibling worktree's install, because the lab's `@a11ign/control` 0.1.0 is not on the npm registry and a full `pnpm install` cannot resolve here. Before the change the two files read `19 passed`; the new refusal test failed (`DID NOT RAISE SystemExit`) against the unchanged guard, and after it both files read `21 passed`. The whole `tests/` directory reads `212 passed, 4 skipped`, 0 failed.

Mutation, in both directions, each restored byte-identical (`cmp` against a scratchpad copy of the fixed file):
- `SOURCE_DIRS = ()` (never fires): 4 failed, the two `packages/` refusals and the two `node_modules/` refusals.
- guard body `if False:` (always fires): 4 failed, the three stamp-into-`runs/` tests and the new `runs/model-shipped` control.
- `SOURCE_DIRS = ("packages",)` (the pre-change behaviour): 1 failed, `test_refuses_to_stamp_a_report_inside_the_installed_scorer_package`, and every other test passes.

Premise checked: `refuse_to_stamp_source_tree` returned without raising for `node_modules/@a11ign/scorer/models/screenreader-scorer/training-report.json` on the unchanged code, which is the failing test's red.
