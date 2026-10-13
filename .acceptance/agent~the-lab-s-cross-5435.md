Closes a11ign/a11ign#5435

Acceptance: `bash -c 'gone=$(git diff --name-only --diff-filter=D origin/agent/the-lab-s-ci-5431 -- src); test "$(printf "%s\n" "$gone" | grep -c .)" -eq 48 && for f in $gone; do test ! -e "$f" || { echo "still present: $f"; exit 1; }; done && node -e "process.exit(require(\"./baselines/layer-edges.baseline.json\").length === 428 ? 0 : 1)"'` (the row's done-when 1, by its retirement branch: each unportable file is gone from the tree, and the layer-edges baseline is at its measured 428). The leg's own pass is NOT this line: it is the PR's `checks (cross-repo)` job at CORE_REF `87d89fdec`, read on the PR and posted on a11ign/a11ign#5435, because a PR cannot read its own CI result at the moment it is opened.

## Verification record

Done-when 2 is the count. CORE_REF is NOT moved by this PR, so the core-side count is unchanged; the leg's count is what moves, and it moves only down.

How: the CI reproduction is `/home/agent/repos/ci-wt-5435/core` with the lab laid over `packages/lab` (rsync of this tree, excluding `.git`, `node_modules`, `.acceptance`, `.changeset`), the same layout as PR #114's `ci.yml`: core at `87d89fdec`, `pnpm install`, build, control at v0.13.15, fleet v0.11.0, worker v0.13.0, then `cross-repo-tests.ts --scope=cross-repo` and `--scope=own` through rstest with `A11Y_RSTEST_FULL_REPORT=1`.

| | before (PR #114 head `d2d27ffc`) | after (this PR) |
|---|---|---|
| `cross-repo` leg | 2,975 tests in 228 files; **102 fail in 47 files** | **2,422 pass in 181 files (2 skipped), exit 0** |
| `own` leg | 1,662 pass, 11 skipped (PR #114's record) | **1,658 pass in 212 files (11 skipped), exit 0** |
| `tsc -p packages/lab/tsconfig.json --noEmit` | 0 errors | 0 errors |
| `eslint --no-ignore packages/lab` | 0 errors | 0 errors (1,935 warnings) |

Reconciliation: PR #114 recorded 101 failures in 46 files; the run here measured 102 in 47. The extra file is `workflow-filters.test.ts` (a real `ENOENT`, retired below). The count is the rstest run's, not the record's.

The own leg's first run after the retirements failed 5 of 1,662 in 213 files. Each was a retired file's sweep dependency or a copied-core guard that the retirement left referenced (`dataset-paths`, `corpus-readers-are-guarded`, `reported-counts`, `layer-edges` baseline entries). They are removed here, and the rerun is the 1,658 above.

### Retired (48 files, a11ign/a11ign#4425 phase 3)

Each file reads a core path that the lab's own tree does not hold: its `REPO` resolves to the core's root, or it reads the core's `layers.json`, `packages/control/**`, `packages/guards/**`, `scripts/**` or `.github/**`. The per-file reason (the core reference it reads) is on a11ign/a11ign#5435; the list is the 48 `git rm`'d paths in this PR.

### Edits beyond deletion (each is the same retirement, not a new check)

- `baselines/layer-edges.baseline.json`: 110 entries removed for the retired guards' cross-repo reaches, plus 2 for `derived-artifact-sweep.test.ts`. 540 → 428 entries; one entry per line, valid JSON.
- `src/packaging/npm-cli-windows-spawn.test.ts`: the `NPM_CLI_IS_DATA_NOT_A_SPAWN` entry for `gate-partial-corpus-contract.test.ts` removed.
- `src/packaging/agent-org-standalone-adr.test.ts`: `control-plane-checkout-is-one-fact` and `repo-identity-consolidated` added to `RESERVED_BY_A_ROW`. Their Regions still name them, and they are retired here.
- `src/packaging/lab-extraction.test.ts`: the count floors lowered with the reason in each comment (`> 500` → `> 400`, `> 400` → `> 300`).
- `src/dataset-paths.test.ts`, `src/gates/corpus-readers-are-guarded.test.ts`: entries for the retired files removed.
- `src/packaging/reported-counts.test.ts`: 11 `KNOWN_REPORTED_FLOORS` entries removed (stale or retired). The baseline shrinks; no entry is added.
- `src/packaging/cross-repo-tests.test.ts`: the positive control names two tests that still read the lab's own tree (`layer-edges`, `acceptance-reads-the-live-body`), not the four it named before. Both sides stay non-vacuous.

### Not changed, and why

- `.github/workflows/ci.yml` line 101: a comment still names `verify-affected-set.test.ts`, which is retired here. It is a comment only, so it is left for the workflow's owner; flagged, not fixed.
- No changeset. This PR deletes and narrows tests and ships no code change, and merging a changeset to `main` is a release (`.changeset/README.md`).
- The core's CI copy's git index is a local reproduction artifact; it is not part of this PR.
