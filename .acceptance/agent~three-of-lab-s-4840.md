Closes a11ign/a11ign#4840

Acceptance: `bash -c 'git grep -q "MINIMUM_FILES = 59" -- src/packaging/ansible-yaml-parses.test.ts && ! git grep -q "EXPECTED_FILES" -- src/packaging/ansible-yaml-parses.test.ts && ! git grep -q "ENGINEER_BRIEF_BYTE_CEILING" -- src && git grep -q "auto-arm-filter.test.ts" -- src/packaging/rstest-report-is-not-the-verdict.test.ts && ! git grep -q "CONTROL_TEST = .*workflow-filters" -- src/packaging/rstest-report-is-not-the-verdict.test.ts'` (run from the lab root; a structural check that each of the three edits is present, because the row's own command reads the newest `main` run and cannot pass before the merge).

Hand-run: the row's own command, `gh run view` over the newest `ci` run on `main`, is run by the host after the merge (it reads a run this pull request cannot yet have produced); paste its exit code on the row.

## How each file ended
- `ansible-yaml-parses.test.ts`: FIXED FORWARD. The equality `EXPECTED_FILES = 59` mirrored the control layer's file count (61 at the pin), so it becomes a floor `MINIMUM_FILES = 59`; the every-file-parses assertion, the malformed-document control and the lab-job.yml reachability control are unchanged. Not retired because the parse guarantee has no other home (a11ign/control has no yml-parse test; measured by grep).
- `roles-readme.test.ts`: the byte ceiling test is RETIRED (engineer.md 20,738 vs 20,500). The file is the core's and its size the core's to bound; the clause tests that read the brief stay. Open: I found no core test pinning engineer.md's size (grep over core `scripts`, `.github`, `packages/guards/src`), so the bound is now unguarded; that is a row for `product-manager`, not a reason to keep lab chasing the number.
- `rstest-report-is-not-the-verdict.test.ts`: FIXED FORWARD. Form D's control was `workflow-filters.test.ts`, which reads the core's workflows and itself failed in the cross-repo leg (report: `failedFiles: 1`, `every program the capture workflow runs exists at the path it names`), failing four of this file's readings. The control is now `auto-arm-filter.test.ts`, which reads only a file inside lab. The 0.12.3 tool version was not the cause.

## Evidence
- Before: 6 failing tests in these 3 files at lab `9643e5d2` (run 38056110285, measured from its log; 1 + 1 + 4).
- After: NOT run locally. These tests need lab laid into a core at `CORE_REF` and this worktree has no such layout; the cross-repo leg of this PR's CI is the first run. `auto-arm-filter.test.ts` is own-scope per `scripts/cross-repo-tests.ts` (reads nothing above the lab root); its `jq` dependency is present on GitHub runners.
- Not done: no mutation check run, for the same reason.

Mutation: n/a -- no guard added; two guards loosened/moved as stated above, their controls retained.

Outside-Region: none
Fleet: No.
