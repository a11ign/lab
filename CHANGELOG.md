# @a11ign/lab

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
