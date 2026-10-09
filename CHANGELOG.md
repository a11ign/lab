# @a11ign/lab

## 0.1.24

### Patch Changes

- b07c95b: The lab runs its own tests: `package.json` gains `"test": "rstest run --config scripts/rstest/rstest.config.ts"`, and `scripts/rstest/rstest.config.ts` is a thin call into `@a11ign/toolchain/rstest-config` over `src/**/*.test.ts`, the same shape as `agent-org`'s. The settings table's `test-runner` cell for this repository no longer reads `DRIFT` on a missing `test` script, and `pnpm exec rstest` no longer prints `Command "rstest" not found` in a lab checkout (a11ign/a11ign#4506). The core's CI keeps running the lab through its own config.

## 0.1.23

### Patch Changes

- 703e9c8: `capture-screenreader-dataset.mjs` appends the same per-run record to `runs/capture-runs.jsonl` that `capture-real-pages.mjs` does (`{ startedAt, readyCount, participants, excluded }`), including a run that finds nobody. It is not put behind the fleet guard, so it reads no ready count and writes `readyCount: null`. A record that cannot be written is said on stderr and never changes the run's exit (a11ign/a11ign#4462, #4459).

## 0.1.22

### Patch Changes

- 08ed8d9: `scripts/referral-repeat-share.ts` refuses an unknown flag (`refuseUnknownFlags`, exit 2, as every other lab CLI does) instead of reading it as a file path, so control's `cli-flags` test, which discovers CLIs by reading their source, stops flagging it (a11ign/a11ign#4580, blocks #4575).

## 0.1.21

### Patch Changes

- f6c759d: 3 of the 38 `.mjs` files in `scripts/` are TypeScript, converted by `js-to-ts` (a11ign/a11ign#4278): `bench-capture`, `claim-excludes-recompute` and `referral-repeat-share`; `mjs-ratchet.baseline.json` 88 -> 85. The other 35 stay `.mjs` because each is named by path in the core's `package.json`, a deployed unit, or `@a11ign/control`'s `lab-job.yml`, at refs this repository's CI pins; they move with their callers (a11ign/a11ign#4519). The three run through `npx tsx`, and their usage strings say so.

## 0.1.20

### Patch Changes

- 9a1ad27: `src/eval/pages/books/filter-status-checkbox-polite.html` is the §31 condition the calibration set lacked: one checkbox whose `change` handler synchronously rewrites a `role="status"` count, with no timer. It is kept out of `src/training/case-matrix.mjs` because an intermittent case teaches the model noise. `src/eval/filter-status-checkbox-polite.test.ts` pins the three properties that define the condition and runs the same predicate on `filter-status-good.html` as a positive control. a11ign/a11ign#4567.

## 0.1.19

### Patch Changes

- 8449543: `CORE_REF` in `.github/workflows/ci.yml` moves to `989c2bcc3c6a3d350cb5d0eb7e612771dfb8589a` (core #4599), a core after the last of a11ign/a11ign#4393's renames and after the `// STAYS npm` marker on `scripts/release-tags-complete.ts` (a11ign/a11ign#4594), which `no-npm-spawn.test.ts` now allowlists. The lab's CI laid a core older than those renames, so agent-org's two synced copies (`git-sandbox.ts`, `tree-wide-guard.mjs`) read as drifted there and `agent-org-wiring.test.ts` [36] and [37] failed at agent-org v0.102.3 (a11ign/a11ign#4569).
- 71d487c: `ci.yml` runs the lab's tests in two legs: `checks (own)`, required through `gate`, and `checks (cross-repo)`, which cannot block a pull request. `scripts/cross-repo-tests.ts` assigns each test file: one that resolves a path above the lab root, or uses the tool, is cross-repo (223 of 419 measured at this commit), because its verdict moves with another repository's tree. Lint and the typecheck run in `own` only. `ci.yml` also runs on `push` to `main` and nightly, so a red lab baseline shows the hour it happens (a11ign/a11ign#4588).
- 18cca87: Nine scripts and `src/gates/dispatch.ts` import the product's `git-env` and `npm-cli-executable` by their `.ts` names, the only files the product holds after its rename sweep, so `release:provenance` loads `promote-model.mjs` again. They need a Node that strips types (22.23 or later) (a11ign/a11ign#4568).
- ab55c4b: `src/training/page-server.mjs` imports the product's CLI helper as `scripts/npm-cli-executable.ts`, the name it has had since a11ign#4393 renamed it from `.mjs`. The old `.mjs` specifier made `capture-regression` fail at start in `release.yml` (`ERR_MODULE_NOT_FOUND`, before any capture), and nothing in lab saw it because the lab's own tests do not import that path through a loader. Only the import line changes.
- 40314fb: The lab's `agent-org-wiring` test no longer reads another repository's tree: copy-drift tests [36] and [37] are deleted, with `KNOWN_UNREADABLE_ORIGINALS`, `declaredCopies`, `withConstLinesBroken` and the `copyDriftReading` / `readDeclaredCopies` import from the tool. They compared the 19 `// COPIED FROM` files in the tool's `src/lib` against the core's CURRENT tree, so their verdict changed with no change to the lab (lab#48's same head passed at 13:47Z and failed at 15:08Z). The copies are deleted in agent-org (row 5 of a11ign/a11ign#4425 phase 3), and agent-org's own tests own its tree (a11ign/a11ign#4588).

## 0.1.18

### Patch Changes

- 803fcbf: 22 of the 28 `.mjs` files in `src/packaging`, `src/gates`, `src/harnesses`, `src/capture` and `src/dataset-paths` are TypeScript, converted by `js-to-ts` (a11ign/a11ign#4277); `mjs-ratchet.baseline.json` 110 -> 88. Six stay `.mjs` because another repository names them by path: `src/gates/qualification-status.mjs` (imported by `@a11ign/control`'s `post-qualification-status`) and the five `src/harnesses` files `assert-action-report`, `capture-check`, `capture-fixtures`, `occurrence-verdict-stability` and `page-identity-rate` (named by the core's workflows and `package.json` scripts, which CI reads at the pinned `CORE_REF`). The JSDoc `any` that the conversion kept is one alias, `Loose` in `src/capture/loose.ts`.

## 0.1.17

### Patch Changes

- 10fb892: lab follows the core past the js-to-ts renames (#4273, #4274) and the agent-org reach rules (#4408, #4409, #4411): `CORE_REF` moves to `a7d6a4158`, the pin on the tool's tag is gone (`ci.yml` resolves the newest tag again, and `ci-composition.test.ts` asserts the resolver), relative specifiers into the core name `.ts` where the core renamed, and `scripts/tool-source.ts` resolves the tool's sources through its declared exports because `scripts/agent-org-newest-tag.mjs` no longer exports `toolModule`, `toolPath` and `toolUrl`. The `layer-edges` baseline is regenerated with dispositions carried across the renames (a11ign/a11ign#4427).

## 0.1.16

### Patch Changes

- c8ddd91: A capture run's fleet is recorded: `capture-fleet-guard.mjs` takes a `runRecord` option and, before either of its refusals can exit 3, appends `{ startedAt, readyCount, participants, excluded: [{ worker, reason }] }` to `runs/capture-runs.jsonl` through the new `capture-run-record.mjs`, with `reason` one of `inconsistent`, `asleep`, `down`. `readyCount` is what the guard's own `/health` probe saw answer; a figure the run did not read is `null`. The new `.mjs` joins `mjs-ratchet.baseline.json` because the guard is a plain-`node` entry's import and the host's Node has no type stripping (ADR 0043). `capture-real-pages.mjs` passes it to the check before the run, with the boxes the wake step left out (`asleep` when one `/health` probe returned nothing, else `down`), and a run that found nobody still writes a record with `readyCount: null` (a11ign/a11ign#4459).

## 0.1.15

### Patch Changes

- d7b3922: `board-gates`, `power-guard` and `real-page-drift-summary` in `src/training` are TypeScript, converted by `js-to-ts` (a11ign/a11ign#4276). The other 43 `.mjs` of the directory stay: a plain `node` entry (`lab-job.yml`'s `argv`, the core's `training:*` scripts) runs them or imports them, and the host's Node has no type stripping (ADR 0043).

## 0.1.14

### Patch Changes

- de83f3a: The calibration set declares six filter and data-table pages it did not (a11ign/a11ign#4352, #4084 outcome 3): the MOJ Design System's `filter`, `filter-a-list`, `sortable-table` and `scrollable-pane` pages (its own statement: fully compliant with WCAG 2.2 AA, last reviewed 2 July 2026) and GOV.UK's `research-and-statistics` and `news-and-communications` finders (partially compliant with WCAG 2.2 AA, the statement the other GOV.UK entries cite). Calibration now holds four pages whose `demonstrates` says "filter" and six that say "table", where it held none and three, so the table-and-filter `cantTell` comparison no longer rests on n=3. None was moved from training. The captures and the sweep are not in this change.

## 0.1.13

### Patch Changes

- 70dde37: lab holds `@a11ign/lab` at its root (a11ign/a11ign#4215, ADR 0043): `packages/lab` is flattened into the repository root, the private `lab-workspace` manifest, `lerna.json` and the second README are gone, the one `package.json` carries the package's dependencies and the root's tooling, and `pnpm-lock.yaml` goes with it (the manifest names packages no registry holds, so no lockfile could be written). `ci.yml` lays the whole repository as the core's `packages/lab`, runs the shared layout check (`@a11ign/toolchain/layout-check`, pinned `0.1.5`) first, and `releasable-paths` is now `src/ scripts/ baselines/ rule-ownership.json CLAUDE.md`. `release.yml` drops `lone-package-dir`: the root package is the lone one, so the tag is still `v<version>`. This release is the first tag cut from the flat tree.

## 0.1.0

First release from its own repository. `packages/lab` moved out of `a11ign/a11ign` with its history (2,578 non-merge commits, internal addresses redacted from every file and commit message), and releases itself from here: a merge carrying a changeset is tagged `v<version>` with a GitHub Release. It is not self-contained: its CI lays it over a pinned checkout of `a11ign/a11ign`.
