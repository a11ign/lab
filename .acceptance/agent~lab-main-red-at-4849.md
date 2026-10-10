Closes a11ign/a11ign#4849

`src/packaging/acceptance-reads-the-live-body.test.ts` only. `commandProblems` expects the command step's env to be exactly `PR_BODY,PR_AUTHOR,ACCEPTANCE_ROW_LABELS` (the core's `reusable-acceptance.yml` has handed it `PR_AUTHOR` since a11ign/a11ign#4834), and a new check pins `PR_AUTHOR` to `${{ github.event.pull_request.user.login }}`, so a value taken from the body or the token is still refused. The comment beside the key list says why neither extra key is a credential. `holdsCredential` and the core's workflow are untouched. A new mutation sets `PR_AUTHOR` to the live body, the event payload's body and the token, and each is refused; for the live body it is the author check alone that refuses it.

Acceptance: `bash -c 'F=src/packaging/acceptance-reads-the-live-body.test.ts; ! grep -qF "!== \"PR_BODY,ACCEPTANCE_ROW_LABELS\"" $F && grep -qF "PR_AUTHOR" $F'`

This is the row's own command with `gh api ...?ref=main` replaced by the checked-out file, because the row's form reads `main` and cannot pass before the merge; after the merge the row's command is the one that counts.

Measured here, in a scratch copy of the core's layout (the test reads `../../../../.github/workflows/reusable-acceptance.yml`; core `da027c092`, lab `bd4424ed`) run with `node --import tsx --test`: on the edited file 11 of 13 pass; `the shipped workflow holds every property` passes. On `origin/main`'s file it fails (9 of 12 pass), which is the red this row is about. The same two tests, `clause 1: the step prints the LIVE body` and `a body that tries to end the value early`, fail identically on both files in that scratch copy and not because of this change (the stub-`gh` run answers with only the `Closes` line, an artifact of the scratch checkout); the cross-repo leg is the reading that counts for them.

Mutation, in both directions, each restored byte-identical (`diff` printed nothing):
- the new `PR_AUTHOR` check deleted (never fires): only `clause 2: an author taken from the body or the token FAILS` goes red;
- the new check replaced by `true` (always fires): only `the shipped workflow holds every property` goes red;
- the key list put back to `PR_BODY,ACCEPTANCE_ROW_LABELS`: only `the shipped workflow holds every property` goes red.

Not checked: lint and typecheck of the lab package, which the worktree has no `node_modules` for; the cross-repo leg runs both.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
