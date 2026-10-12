Closes a11ign/a11ign#5203

Acceptance: `bash -c 'test -z "$(grep -n "test_miss_above_the_floor" baselines/layer-edges.baseline.json)"'`

Hand-run by the engineer who lands the fix: `gh run list --repo a11ign/lab --branch main --limit 1 --json databaseId,headSha,conclusion` names the run on this PR's merge sha, and `gh run view <id> --repo a11ign/lab --json jobs` reads `checks (cross-repo)` success.

Cause (read from the code, not the run alone): lab#100 (`60c1fb02`) rewrote `tests/test_miss_above_the_floor.py` to build the shipped report's path as `scorer_python().parent / "models" / "screenreader-scorer" / "training-report.json"` instead of a literal `packages/scorer/...` string. The layer-edges scan no longer sees that edge, so its baseline entry is stale. lab#97's head `b3e6b80c` predates lab#100, which is why it passed there and fails on the merge.

Change: the one baseline line for that edge is deleted. No other entry moves, and lab#97 is not reverted.

Not run here: the cross-repo leg (it lays the core and needs CI). The JSON still parses (`node -e "JSON.parse(...)"`, printed `json ok`).
