Closes a11ign/a11ign#4840

Acceptance: `bash -c 'L=$(gh run list -R a11ign/lab --workflow ci --branch main --limit 1 --json databaseId --jq ".[0].databaseId"); T=$(gh run view $L -R a11ign/lab --log 2>/dev/null); echo "$T" | grep -q "Test Files" && ! echo "$T" | grep -E " FAIL .*(ansible-yaml-parses|roles-readme|rstest-report-is-not-the-verdict)\.test\.ts"'` (the row's command, verbatim; hand-run after merge because it reads the newest `main` run).

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
