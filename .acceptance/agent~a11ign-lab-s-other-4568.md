Acceptance:
```bash
bash -c '! grep -rnE "guards/src/git-env\.mjs|scripts/npm-cli-executable\.mjs" scripts src --include=*.mjs --include=*.ts --exclude=*.test.ts --exclude=page-server.mjs'
bash -c 'test "$(grep -rlE "guards/src/git-env\.ts|scripts/npm-cli-executable\.ts" scripts src --include=*.mjs --include=*.ts --exclude=*.test.ts | wc -l)" -ge 9'
```

Closes a11ign/a11ign#4568

## What changed

Ten specifiers, extension only: `guards/src/git-env.mjs` to `.ts` in `check-rehearsal-currency`, `claim-excludes-recompute`, `evidence-check`, `promote-model`; `scripts/npm-cli-executable.mjs` to `.ts` in `collect-promotion`, `compare-layers`, `corpus-release-nightly`, `retrain-pipeline`, `stability-gate` and `src/gates/dispatch.ts`. The product holds only the `.ts` names since its rename sweep, so `promote-model.mjs` (loaded by `check-shipped-provenance.mjs`) died with `ERR_MODULE_NOT_FOUND` in `release.yml`'s `guards` job. Plus a patch changeset. `src/training/page-server.mjs` is #50's and is untouched. a11ign/lab#49 is unmerged, so `claim-excludes-recompute.mjs` still has its `.mjs` name; whichever merges second rebases onto the other.

## Verification

Measured at this head, from the lab checkout: both Acceptance commands exit 0 (the first prints nothing, the second counts the files naming a `.ts`). Control: the first command's grep on `origin/main` (`c22c3d17`, extracted with `git archive`) prints 10 hits, as the row says.

**I did not run any of the ten scripts.** This host's Node (22.22.1) has no type stripping, so a script that imports a `.ts` cannot load here; CI's Node 22.23.3 strips. No `.mjs` shim was added to the product. The loading is for CI's `guards` job to show.

platform: Node's own type stripping loads the `.ts` import, so no loader is added.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
