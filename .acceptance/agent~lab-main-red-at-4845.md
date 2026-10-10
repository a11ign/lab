Closes a11ign/a11ign#4845

`src/packaging/git-population-vacuity.test.ts`, the `ansible-yaml-parses.test.ts` entry only: `guard` is now `assert.ok(ours.length >= MINIMUM_FILES`, the expression lab#67 left in that file, and the `note` says the pin is a floor on purpose (a11ign#4840), what the floor still holds (the walk is not empty, and has not lost files the layer last held) and what it no longer holds (that the count is right). The `powershell-parses` entry and `ansible-yaml-parses.test.ts` are untouched.

Acceptance: `bash -c 'T=$(gh api "repos/a11ign/lab/contents/src/packaging/git-population-vacuity.test.ts?ref=main" --jq .content | base64 -d); ! echo "$T" | grep -qF "guard: \"assert.equal(ours.length, EXPECTED_FILES\"" && echo "$T" | grep -A1 -F "ansible-yaml-parses.test.ts\": {" | grep -qF "MINIMUM_FILES"'`

Measured here: the same two greps run over the edited working file print a pass (rc=0); on `origin/main` 46eddbf7 the first fails (line 515 still carries the old guard). The test itself was NOT run in this checkout: it imports `@a11ign/toolchain` and `../../../guards`, and the worktree has no `node_modules`. The 12-tests/1-failing count before, and the count after, are read from this PR's cross-repo leg, not claimed here.

Not checked: that the one failing test passes. Only the cross-repo leg can say.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
