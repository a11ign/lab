Refs A11-127

Retires the old gate's `refusalOwners` job from lab's CI and moves the arm bot's cross-repo exit from an open GitHub row to a ticket key. `refusalOwners` asked GitHub whether the row a `REFUSED` string names is open; rows live in Linear now and every GitHub copy is closed, so it could only fail, and `gate` (the one required check) went red with it. The job is removed from `ci.yml`, from `gate`'s `needs` and from `gate`'s result checks, and its test is deleted. The arm bot's `Cross-repo-red:` line now names the ticket that greens the leg (`A11-123`), read by shape with no tracker read; `#n` and `owner/repo#n` no longer clear a refusal, and a missing line still refuses.

Acceptance: `ci.yml` has no `refusalOwners` job and `gate` needs only `changeset, checks, release-dry-run`; the arm bot clears a refusal for `Cross-repo-red: A11-1` and refuses `#5`, `owner/repo#5` and a missing line, and never asks GitHub for an issue.

```bash
! grep -nE "refusalOwners|refusal-owners" .github/workflows/ci.yml
grep -nF 'needs: [changeset, checks, release-dry-run]' .github/workflows/ci.yml
test ! -e src/packaging/refusal-owners-are-open.test.ts
# The auto-arm test reads the workflow with `yaml`, which a bare checkout does not have: lay it in for the run, and take it out again.
deps=$(mktemp -d)
npm install --no-save --no-package-lock --no-audit --no-fund --prefix "$deps" yaml@2 >/dev/null
mkdir -p node_modules && ln -s "$deps/node_modules/yaml" node_modules/yaml
node --test src/packaging/auto-arm-cross-repo-red.test.ts src/packaging/cross-repo-tests.test.ts; status=$?
rm -f node_modules/yaml && rmdir node_modules 2>/dev/null; rm -rf "${deps:?}"
exit "$status"
```

The two test files read only the workflow YAML and run the arm bot's shell under `bash` and `jq` against a fake `gh`; the block lays `yaml` in for them, since they import it, and removes it afterwards. Their ticket-key cases fail on the base `ci.yml` and `auto-arm.yml`.
