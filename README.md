# lab

The eval harness, the training-corpus pipeline, the release gates and the analysis programs of a11y-witness. Moved here from
[`a11ign/a11ign`](https://github.com/a11ign/a11ign) with its history (`packages/lab`, 2,578 non-merge commits), and `packages/lab/` keeps the
monorepo's path so that what reaches the core by relative path still does.

| | |
|---|---|
| [`packages/lab`](packages/lab) | `@a11ign/lab`, **AGPL-3.0-or-later**, never published to a registry. See its README. |

The root [`LICENSE`](LICENSE) is the core's, byte for byte (`lab` shipped none of its own).

**A gate that reads `runs/` is not yours to report** (`packages/lab/CLAUDE.md`): the corpus belongs to the lab, and a verdict comes from the agent driving the fleet and the lab.

## It is not self-contained

`packages/lab` reaches the core's `scripts/`, the private `guards` package, root files and files of other packages that no published tarball ships, by relative path
(569 `checkout-path` edges in `a11ign/a11ign`'s `packages/guards/layer-edges.baseline.json`). Its manifest also names the monorepo's workspace versions of its siblings, which
the registry does not hold. CI (`.github/workflows/ci.yml`) therefore lays it over a checkout of `a11ign/a11ign` at the commit in `CORE_REF`, installs there, and runs the
core's eslint, tsc and rstest config on it. To do the same by hand:

```bash
git clone https://github.com/a11ign/a11ign core && git -C core checkout <CORE_REF>
rm -rf core/packages/lab && cp -R packages/lab core/packages/lab
cd core && pnpm install --no-frozen-lockfile && pnpm run build
pnpm exec eslint packages/lab && pnpm exec tsc --noEmit
pnpm exec rstest run --config scripts/rstest/rstest.config.mjs --include "packages/lab/**/*.test.ts"
```

Bumping `CORE_REF` is a pull request: the only way the core's changes reach this repository. `pnpm test` here runs only this repository's own checks (the workflows).

## How it installs, and why `packages/lab` is not a pnpm workspace member (a11ign/a11ign#3711)

`pnpm install --frozen-lockfile` at the root installs the root's own dev dependencies and nothing else, and it passes on `main` and on any pull request that changes only `packages/lab/package.json`
(a Dependabot bump, which is the usual one). **There is no `pnpm-workspace.yaml`, so `packages/lab` is not an importer in `pnpm-lock.yaml`, and that is the decision.** Its `@a11ign/*` dependencies
are not on the public registry (`a11ign/a11ign#2703`: no registry, no token), so a lockfile entry for it could not be produced, and one that could would fail every pull request that edits that manifest.
`lerna.json` is what lets `changeset` find the package instead: with no workspace file, pnpm sees no package, and changesets' tool detection falls through to lerna's `packages` glob
(measured 2026-10-05 against `@changesets/cli` 3.0.3: `changeset status` lists `@a11ign/lab`). Dependencies of `packages/lab` are installed only in the core's workspace, where `ci.yml` lays it.
**Consequence for a reviewer:** the review tree's install is the root's dev dependencies alone, which is all a reviewer of a pull request that changes no code it must run needs; running `packages/lab` is `ci.yml`'s recipe above.

`main` takes pull requests only, each with one approving review, through the merge queue.

## Releasing

A change that should be released carries a changeset (`pnpm exec changeset`); **merging it is the release**. `.github/workflows/release.yml` cuts the tag
`v<version>` and a GitHub Release carrying the CHANGELOG entry: no registry, no token. A consumer pins a tag. **The first tag, `v0.1.0`, is cut by hand**, once,
on the merge of the pull request that added the workflow, because the workflow reads what the last tag consumed and so needs one.
