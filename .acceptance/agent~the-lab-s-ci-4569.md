Closes a11ign/a11ign#4569
Closes a11ign/a11ign#4568
Closes a11ign/a11ign#4561

DRAFT, NOT READY, HELD behind lab#48 and lab#49 (`Waiting-for: merged a11ign/lab#48`, `merged a11ign/lab#49`), and [36]/[37] wait for agent-org#505 and a new agent-org tag. Moves `CORE_REF` to `f9299dbe557758014ea1653302ecf0c1c3153b8e` (core #4558), the oldest core at or after `f3b5c5f59` that measures green on all but three files (below); fixes the two `.ts` renames in `ci.yml` (`agent-org-newest-tag.ts`, `rstest.config.ts`); cherry-picks lab#50 and lab#51 (`26d660fc`, `0d63cb7b`); and sweeps every specifier naming one of the 41 files core #4393 renamed `.mjs` to `.ts` (`git diff --name-status -M a7d6a4158 f3b5c5f59`), extension only.

Acceptance: `bash -c 'sha=$(grep -E "^  CORE_REF: [0-9a-f]{40}$" .github/workflows/ci.yml | grep -oE "[0-9a-f]{40}") && test -n "$sha" && git -C /home/agent/repos/role-product-manager merge-base --is-ancestor f3b5c5f59 "$sha"'`

Measured: lab `checks` run 37959305984 at head `4c4cf8c9`: 2 of 419 files red (agent-org-wiring [36]/[37] waits for agent-org#505 and a new tag; no-npm-spawn is a core fact, on the row), against 1 of 419 at `a7d6a4158`. The per-sha counts, the old and new values and the file list are in the PR body.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
