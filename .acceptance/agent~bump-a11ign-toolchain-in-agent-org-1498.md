Closes a11ign/agent-org#1498

Acceptance: `node --test src/packaging/refusal-owners-are-open.test.ts` (run from the lab worktree, `/home/agent/repos/lab-wt-1498`, which is this branch; the row's `cd ~/repos/lab` form reads the primary checkout, which is not this branch). Exits 0 with 14 passing and the live read skipped with its reason.

## What changes
- `package.json`: `devDependencies["@a11ign/toolchain"]` `0.9.0` to `0.10.2`, the first release that exports `./refusal-owners-are-open` (`npm view @a11ign/toolchain@0.10.0` and `@0.10.1` export nothing of it; `@0.10.2` does).
- `scripts/refusal-owners-are-open.ts`: deleted (`git rm`). The copy it was trimmed from is the package's file, with the workflow half (`release.yml`'s `::error` lines) now also read by the package's `refusalsInTree`; neither scans a `::error` line that names no owner, so no finding comes from it.
- `src/packaging/refusal-owners-are-open.test.ts`: imports from `@a11ign/toolchain/refusal-owners-are-open`; the live read is `readIssueState("a11ign/lab")`, since the package has no default repository.
- `baselines/layer-edges.baseline.json`: the one entry for the deleted file removed (the row names it). The file parses as JSON with 428 entries.
- `.changeset/lab-reads-the-refusal-reader-from-the-toolchain.md`: `@a11ign/lab` patch.

## Evidence (measured)
- Acceptance command, from the worktree: `tests 15 / pass 14 / skipped 1`, the skip being the opt-in live read with its reason printed.
- With `A11Y_CHECK_REFUSAL_OWNERS=1` (asks GitHub, one read): `tests 15 / pass 15`, and `LIVE PASS: package.json script "gate:core-held" names a11ign/a11ign#4425: a11ign/a11ign#4425 is open`.
- Toolchain 0.10.2 installed the way CI installs the layout check (`npm install --no-save --prefix`, scratchpad), linked into the worktree's `node_modules/@a11ign/toolchain` only: `layout-check: ok (817 files read under .)`.

## Not done / open
- `pnpm install` cannot run here: the manifest names `@a11ign/control`, which the registry answers 404 for (`ERR_PNPM_FETCH_404`). The lab has no lockfile, so there is nothing to update; CI installs a narrowed set.
- `src/packaging/layer-edges.test.ts` was not run: it imports `../../../../guards/src/layer-edges.ts`, which is the core's checkout and is not laid on this host (`ERR_MODULE_NOT_FOUND`). CI lays the core and runs it.
- The full `pnpm test` was not run for the same reason: the rest of the suite reads the laid core.
- `.github/workflows/ci.yml` line 317 is a comment that still names `scripts/refusal-owners-are-open.ts` as a copy. It is outside this row's Region and was left alone.

Outside-Region: `baselines/layer-edges.baseline.json` (the row names it), `.changeset/` and this `.acceptance/` file (the convention every change here carries).
Mutation: n/a, a relocation with no guard added; the 15 tests in the file are the reader's own controls, and they pass against the package.
Fleet: No.
