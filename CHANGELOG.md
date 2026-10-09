# @a11ign/lab

## 0.1.13

### Patch Changes

- 70dde37: lab holds `@a11ign/lab` at its root (a11ign/a11ign#4215, ADR 0043): `packages/lab` is flattened into the repository root, the private `lab-workspace` manifest, `lerna.json` and the second README are gone, the one `package.json` carries the package's dependencies and the root's tooling, and `pnpm-lock.yaml` goes with it (the manifest names packages no registry holds, so no lockfile could be written). `ci.yml` lays the whole repository as the core's `packages/lab`, runs the shared layout check (`@a11ign/toolchain/layout-check`, pinned `0.1.5`) first, and `releasable-paths` is now `src/ scripts/ baselines/ rule-ownership.json CLAUDE.md`. `release.yml` drops `lone-package-dir`: the root package is the lone one, so the tag is still `v<version>`. This release is the first tag cut from the flat tree.

## 0.1.0

First release from its own repository. `packages/lab` moved out of `a11ign/a11ign` with its history (2,578 non-merge commits, internal addresses redacted from every file and commit message), and releases itself from here: a merge carrying a changeset is tagged `v<version>` with a GitHub Release. It is not self-contained: its CI lays it over a pinned checkout of `a11ign/a11ign`.
