Closes a11ign/a11ign#4854

`src/packaging/acceptance-reads-the-live-body.test.ts` only. The two tests that read the step's output back (`clause 1: the step prints the LIVE body` and `a body that tries to end the value early`) ran the step with no author, so the tool, which since ADR 0044 (agent-org#519) answers "the body" for an exempt author alone, narrowed the body to its `Closes` line. They now spawn the step with `PR_AUTHOR=dependabot[bot]` (`DEPENDABOT_AUTHOR`), which the core's step hands to the reader since a11ign/a11ign#4857. The hostile body gains an `Acceptance:` line so the step's re-read loop for that author ends at once (measured 90.5 s without one); the empty-body and failed-read tests keep the author out. No assertion was loosened and no test skipped or deleted.

Acceptance: `bash -c 'grep -q "PR_AUTHOR: \"dependabot" src/packaging/acceptance-reads-the-live-body.test.ts'` (run from the lab root; the row's own command reads `main` over `gh api` and cannot pass before the merge).

Hand-run: the row's own command, `gh api` over `main`'s file, is run after the merge; its exit code goes on the row.

Measured, in a scratch copy of the core's layout (core `36c354839`, which holds a11ign#4857; tool v0.138.1; lab file laid at `packages/lab/src/packaging/`), `node --import tsx --test`:
- origin/main's file: 11 of 13 pass, the two named tests fail.
- this file: 13 of 13 pass.

Mutation, restored `cmp`-identical each time: `DEPENDABOT_AUTHOR` emptied (the author never reaches the step) turns exactly the two tests red and nothing else (11 of 13). Not run in the opposite direction: handing the author to a body with no `Acceptance:` line makes the step wait its 90 s loop rather than fail an assertion, and that was measured once on the row, not repeated.

Not checked: lint and typecheck of the lab package (the worktree has no `node_modules`); the cross-repo leg runs both. The next `main` run's `checks (cross-repo)` log is the real reading for Done-when 2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
