Closes a11ign/a11ign#5063

Acceptance: `bash -c 'grep -q "release-dry-run:" .github/workflows/ci.yml && grep -q "needs.release-dry-run.result" .github/workflows/ci.yml && node --test src/packaging/cross-repo-tests.test.ts'` (the row's two greps, which name `/home/agent/repos/lab`: a detached primary checkout, read here by relative path in this branch's tree, plus the test that pins the same wiring)

Mutation: `gate`'s `needs:` without `release-dry-run` fails the pin (4 pass, 1 fail); `gate`'s loop reading `needs.checks.result` where it reads `needs.release-dry-run.result` fails the new assertion (4 pass, 1 fail) and the row's second grep. Each restored byte-identical with `cp` and `diff`.
