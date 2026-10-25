A11-252 (https://linear.app/a11ign/issue/A11-252/replace-lockfile-and-dependency-list-snapshot-tests-with-invariants), lab's part. `src/packaging/judge-peer-covers-tested-sdk.test.ts` keeps its invariant (the judge's `@anthropic-ai/sdk` peer covers the SDK a11ign tests) and adds one: the peer has no hand-written upper bound below the next semver major. The ceiling that a11ign at the current `CORE_REF` still carries (`<0.132.0`) is tolerated by name while `ci.yml` names that commit, so the file passes against that tree and against the widened `>=0.106.0` alike.

Acceptance:

```bash
# the file runs only in the core's lay (ci.yml `checks`), because it reads a11ign's root and judge manifests by relative path
git clone --quiet https://github.com/a11ign/a11ign.git core && git -C core checkout --quiet 87d89fdec2c26b9fb3d2e8dd99160ec8c52f9dc1
(cd core && pnpm install --no-frozen-lockfile && mkdir -p packages/lab/src/packaging && cp ../src/packaging/judge-peer-covers-tested-sdk.test.ts packages/lab/src/packaging/ && mkdir -p packages/lab/.github/workflows && cp ../.github/workflows/ci.yml packages/lab/.github/workflows/ && git add -f packages/lab)
(cd core && pnpm exec rstest run --config scripts/rstest/rstest.config.ts --include 'packages/lab/src/packaging/judge-peer-covers-tested-sdk.test.ts')
```

**What the block shows:** 6 tests pass against a11ign at `CORE_REF` as it is (peer `>=0.106.0 <0.132.0`, root `^0.131.0`), because `ci.yml` still names that commit. With the peer set to `>=0.106.0` and the root to `^0.140.0` they pass too. A peer with another ceiling, an exact version, a `^0.x` caret or a `~` fails with a message saying why; an SDK below the floor fails; and once `ci.yml`'s `CORE_REF` is any other commit the old ceiling is no longer tolerated.

**Done-when, "control#131 passes on a re-run" (before merge).** That test is control's, in a11ign/control#143, not in this repository, and this change does not touch control's production closure. The pre-merge proof is there: pull request a11ign/control#145 (closed unmerged) was control#143 plus control#131's own lockfile, and control's `checks` and `gate` passed on it: https://github.com/a11ign/control/actions/runs/40188494109. The command anyone can rerun from a checkout of control#143's branch, and what a pass looks like (`VERDICT pass: 16 tests in 1 file`), are in that pull request's `.acceptance` file. After all four pull requests merge, the owner is A11-256 (today's open Dependabot pull requests): `@dependabot rebase` on control#131 by an identity with push access, then its `checks` and `gate` should be green; it is not a merge condition.
