# `@a11ign/lab`

**Private, and it stays private.** This is the workshop: the corpus generator, the training pipeline, the
evaluation harnesses and the gates. Nothing here ships to a consumer — what ships is the *output*, which is
the weights in `@a11ign/scorer` and the rules in `@a11ign/judge`. **AGPL-3.0-or-later**, never published to a registry: a release is the tag `v<version>`.

This repository holds the package at its ROOT (a11ign/a11ign#4215). It was moved from [`a11ign/a11ign`](https://github.com/a11ign/a11ign) with its history (`packages/lab`, 2,578 non-merge commits).
`packages/lab` is still the path the CORE addresses it by: the core lays this repository at `packages/lab`, and what the code reaches by relative path (`../../scripts/...`) resolves from there.
The root [`LICENSE`](LICENSE) is the core's, byte for byte (`lab` shipped none of its own).

**A gate that reads `runs/` is not yours to report** ([`CLAUDE.md`](CLAUDE.md)): the corpus belongs to the lab, and a verdict comes from the agent driving the fleet and the lab.

## What lives here

| directory | what it is |
|---|---|
| `src/training/` | the corpus. Case definitions, page generation, capture orchestration across the worker pool, the export to training records, and the signal checker |
| `src/eval/` | judge quality against labelled fixtures — the held-out measurement |
| `src/capture/` | host-side capture verification, including the predicates that gate a capture |
| `src/harnesses/` | experiment rigs that are not gates |
| `scripts/` | the long jobs and the audits — training, calibration, benchmarks, and the two shortcut audits |

## The five things you will actually run

```bash
pnpm run training:generate        # write the corpus pages from the case definitions
pnpm run training:capture         # drive them through the worker fleet (cached; a full run is ~1,100 pairs)
pnpm run training:check-signals   # does every case still discriminate its good page from its bad one?
pnpm run corpus:starvation        # which features will the corpus starve — asked BEFORE a capture run
pnpm run scorer:shortcuts         # which features did a head penalise for free — asked AFTER training
```

Long jobs do **not** run from a shell. They are named jobs dispatched through Ansible and supervised by
systemd (`pnpm run lab:job -e job=train`), for the reasons in
[ADR 0013](https://github.com/a11ign/a11ign/blob/main/docs/adr/0013-lab-job-control.md) — chiefly that the way this project's most expensive
operations were started used to exist nowhere in the source tree.

## The two audits, and why there are two

They ask the same question at different times, and both are needed.

`corpus:starvation` reads the **case definitions**. `scorer:shortcuts` reads the **trained weights**. The
question in both cases is: *is there a feature that no positive of a subtype carries?* If so, a head may
penalise it at no training cost — and no accuracy metric can see that, because every held-out split shares
the corpus's structure.

That is not hypothetical. Measured on the shipped weights: **225 such free vetoes across all 13 heads**, one
of which meant the scorer reported an unnamed control only on pages where *nothing* was correctly named.
[ADR 0015](https://github.com/a11ign/a11ign/blob/main/docs/adr/0015-one-defect-per-page-taught-the-scorer-to-veto.md) has the measurement.

The corpus-side audit exists because the weights-side one arrives after a capture run, an export and a
train — too late to be a design tool.

## Rules that cost something to learn

**A check must never reject evidence whose absence is the finding.** Some bad pages announce *nothing*, and
that absence is the failure. Gating on "the probe produced something" threw away exactly those captures.

**Append cases; do not worry about position.** Page furniture used to be keyed on array index, so inserting a
case re-sized every case after it and invalidated their captures silently. It is now keyed on the case ID —
adding 60 cases changed zero existing pages, which is how that fix was verified.

**Acceptance and repeatability runs never cache.** `DATASET_KIND=acceptance` refuses it outright, because
those runs exist to test whether NVDA's output is still stable.

**`pnpm run eval` cannot run in CI** — it needs the Python venv. Neither can the corpus-dependent tests, which
need `runs/`. Both skip *honestly* rather than passing quietly, because a check that reports success having
examined nothing is how "verified" comes to mean "unexamined".

## It is not self-contained, and has no lockfile

The package reaches the core's `scripts/`, the private `guards` package, root files and files of other packages that no published tarball ships, by relative path
(569 `checkout-path` edges in `a11ign/a11ign`'s `packages/guards/layer-edges.baseline.json`). Its manifest also names the monorepo's workspace versions of its siblings, which
the registry does not hold, so **no lockfile could be written for it and none is kept**, and `pnpm install` here cannot run. CI (`.github/workflows/ci.yml`) therefore lays this repository
over a checkout of `a11ign/a11ign` at the commit in `CORE_REF`, installs there, and runs the core's eslint and rstest config on it, and typechecks it with `tsconfig.json`, which extends the core's.
That one run covers the package's tests AND this repository's own (`src/packaging/`: the workflows, the arming filter, the composition, the `.mjs` ratchet). To do the same by hand:

```bash
git clone https://github.com/a11ign/a11ign core && git -C core checkout <CORE_REF>
rm -rf core/packages/lab && mkdir core/packages/lab && cp -R . core/packages/lab && rm -rf core/packages/lab/.git
pnpm -C core install --no-frozen-lockfile && pnpm -C core run build
pnpm -C core exec eslint --no-ignore packages/lab && pnpm -C core exec tsc -p packages/lab/tsconfig.json --noEmit
pnpm -C core exec rstest run --config scripts/rstest/rstest.config.mjs --include "packages/lab/**/*.test.ts"
```

The core pins an older `@a11ign/toolchain` than this manifest names, so CI also installs the named one and links it into the laid package's `node_modules`. The one thing that runs
here without the core is the layout check: `npm install --prefix <dir> @a11ign/toolchain@<version>`, then `node <dir>/node_modules/@a11ign/toolchain/dist/layout-check.mjs .`.
Bumping `CORE_REF` is a pull request: the only way the core's changes reach this repository.

`main` takes pull requests only, each with one approving review, through the merge queue.

## Releasing

A change that should be released carries a changeset (`pnpm exec changeset`); **merging it is the release**. `.github/workflows/release.yml` cuts the tag
`v<version>` and a GitHub Release carrying the CHANGELOG entry: no registry, no token. A consumer pins a tag. With no lockfile the shared release workflow runs `pnpm dlx @changesets/cli`.
