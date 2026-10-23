# @a11ign/lab

## 0.1.53

### Patch Changes

- 9a72b5b: Add batch 2 of the real-page corpus (A11-170): `BATCH_2_PAGES`, 120 addresses drawn by ADR 0010's selection rule (seed `A11-170`, round-robin over the conformant publishers the corpus already cites, from their own sitemaps snapshotted in `src/training/real-page-batch-2/`), for the announcement emulator's final Gate (A11-166). Deliberately outside `REAL_PAGES` and with no `role`, so no lab reader can capture or score one before that freeze.
- b04cf75: Retire the `gate:core-held` refusal (A11-170, A11-127). It named a11ign/a11ign#4425 as the open row that owns whether a release may proceed without the core-held gates; #4425 closed at the ticket-mode cutover, rows now live in Linear and the old org gate that used these refusals is stopped, so no open GitHub row owns it and `refusalOwners` failed every pull request. `gate:core-held` is removed from `package.json` and from the end of `release:gate` and `candidate:gate`; their other stages are unchanged. `refusalOwners` stays: it still fails a future `REFUSED` string that names a closed row, and its live step now prints `LIVE PASS` with the count of owners it read, which may be zero.

## 0.1.52

### Patch Changes

- 3a53995: The lab's refusal-owner check reads the reader from `@a11ign/toolchain/refusal-owners-are-open` instead of its own trimmed copy, `scripts/refusal-owners-are-open.ts`, which is deleted (a11ign/agent-org#1415, decision (a) of #5361, ADR 0045 rule 2: the consumer bumps and deletes). `devDependencies["@a11ign/toolchain"]` moves `0.9.0` to `0.10.2`, the first release that exports `./refusal-owners-are-open`. The package names no project, so the live read is asked of `a11ign/lab` explicitly. `src/packaging/refusal-owners-are-open.test.ts` imports the package, and the lab's entry in `baselines/layer-edges.baseline.json` for the deleted file is removed.

## 0.1.51

### Patch Changes

- 4159a89: The nightly corpus-release scripts load from the lab's own checkout (a11ign/a11ign#5501). `corpus-release-nightly.ts` and `corpus-release.ts` imported `refuseUnknownFlags` from `@a11ign/screenreader-fleet/cli-flags`, which does not resolve where the unit runs them (no `node_modules`, no `pnpm install`), so the unit's `ExecStartPre` load check failed on every firing. They use `scripts/refuse-unknown-flags.ts`, which carries the one behaviour they need, and a test refuses a package import in either.

## 0.1.50

### Patch Changes

- 845e022: `refuse_to_stamp_source_tree` in `scripts/evaluate-screenreader-acceptance.py` now refuses a report inside `node_modules/` as well as `packages/`. The shipped model's training report lives in the installed `@a11ign/scorer` package since lab#96, so the guard that was written for `packages/` let a stamp into it through (a11ign/a11ign#5200). The refusal's hint now names the `node_modules/@a11ign/scorer` path to copy from. Nothing a consumer runs changes: a run that writes under `runs/` is still allowed.

## 0.1.49

### Patch Changes

- 6cd3255: `gate:core-held` names an open row, and a refusal that names a closed one fails the lab's CI. The text said "whether a release may proceed without them is a11ign/a11ign#5179", and #5179 closed on 2026-10-12 after fixing a different gate; it now says "the open row that owns whether a release may proceed without them is a11ign/a11ign#4425", the row the core's `gate:lab-held` names for the same question. `scripts/refusal-owners-are-open.ts` (the core's reader from a11ign/a11ign#5333, copied: it is not published and ADR 0045 forbids a reach into the core's tree) reads every owner a `REFUSED` string in `package.json` names, a qualified `a11ign/a11ign#n` in its own repository, and `ci.yml`'s new `refusalOwners` job asks GitHub whether each is open; `gate` needs it, so it blocks (a11ign/a11ign#5351).

## 0.1.48

### Patch Changes

- eae3c09: The lab's four scripts that clean the git environment (`check-rehearsal-currency.ts`, `claim-excludes-recompute.ts`, `evidence-check.ts`, `promote-model.ts`) import `sandboxGitEnv` from `@a11ign/toolchain/lib/git-sandbox` (which re-exports `sandboxGitEnv`, and is the specifier the spawn guard reads) instead of `../../guards/src/git-env.ts`, a two-level reach out of the lab that resolved only while the core laid the lab under its `packages/` (a11ign/a11ign#5182, epic #4425 done-when 3). `src/packaging/no-relative-core-imports.test.ts` no longer keeps a list of known reaches: a new one fails, and none is listed.

## 0.1.47

### Patch Changes

- 870768a: Five lab files take the core's root by name, `coreRoot(...)` or `runsRoot()`, not by four `../` climbs out of the lab (a11ign/a11ign#5191, the follow-up to #5185). A standalone lab sets `A11Y_CORE_ROOT` (or the per-module variable), or these modules refuse at import, naming the variables. `core-root.test.ts` now scans for three or four climbs.

## 0.1.46

### Patch Changes

- e43a078: The lab now holds the 14 Python tests of the scorer's lab scripts that left the core (a11ign/a11ign#5187, after a11ign#5087). They run from the lab's own checkout: `scripts/evaluate-screenreader-acceptance.py`, `scripts/audit-scorer-shortcuts.py`, `scripts/train-screenreader-model.py` and `scripts/diagnose-false-positives.py` anchor on the lab root and read `@a11ign/scorer` from `node_modules`, and `scripts/fixtures/calibration-verdicts.json` comes with them. Nothing a consumer runs changes; the lab's Python tests are not yet a CI leg.

## 0.1.45

### Patch Changes

- 98282d2: The lab holds the release and promotion chains, and four of its files no longer assume the core stands three directories above them (a11ign/a11ign#5185, a11ign#5175 follow-up). `package.json` gains `release:gate`, `candidate:gate` and `promote:gated`, the lab-held stages in the order the core ran them before a11ign#5087; each ends in `gate:core-held`, which exits 1 naming `scorer:migration`, `scorer:retired-heads` and `gate:isolation` rather than claiming they passed (whether the publish path runs them at all is a11ign/a11ign#5179). `check-shipped-provenance.ts`, `check-rehearsal-currency.ts` and `promote-model.ts` take the core's root from `coreRoot()` in `src/dataset-paths.ts`: their own variable, else `A11Y_CORE_ROOT`, else the core above a lab laid at `<core>/packages/lab`, otherwise a refusal naming both variables. From a standalone checkout the old default read `/home/<user>/.changeset` and reported on a tree that is not the core's. `promote-model.ts` resolves its root lazily, so importing its pure functions never refuses, and its candidate default is the lab's own `runs/` rather than the core's, so the model `candidate:gate` gates is the one promoted. `src/packaging/package-scripts-resolve.test.ts` refuses a `run` link in the manifest or a workflow that names a script the manifest lacks.

## 0.1.44

### Patch Changes

- ebc0fe8: The lab's scripts and sources no longer import the core by a relative path (a11ign/a11ign#5176, epic #4425 done-when 3). Twelve files reached `../../../scripts/…` and `../../../control/src/…`, which resolved only while the core laid the lab under its `packages/`; nothing lays it since a11ign/a11ign#5087, so each failed with `ERR_MODULE_NOT_FOUND` from the lab's own checkout. `pnpmCliInvocation` is imported from `@a11ign/toolchain/lib/npm-cli-executable` (seven files), `probeWorker`, `wakeFleet` and `layerRoot` from `@a11ign/control/fleet-wake` and `/layer-checkouts` (four files), and `scripts/tool-source.ts` resolves the tool itself (`$AGENT_ORG_TOOL`, else a host file) instead of importing the core's `agent-org-newest-tag.ts`. `corpus-release-nightly.ts` runs `corpus-release.ts` by the path of its own directory rather than `pnpm run corpus:release` in whatever directory the unit started in. `src/packaging/no-relative-core-imports.test.ts` refuses a non-test file whose relative specifier resolves outside the lab, with a negative control for each direction.

## 0.1.43

### Patch Changes

- ee88c57: The lab's #2781 done-when 3 pin reads the tool's gate as its entry plus the `src/work-gate/` modules it moved the causes into (a11ign/a11ign#5167, a11ign#5152).

## 0.1.42

### Patch Changes

- 61c9196: The lab scans its own `src` and `scripts` for a restated capture wire type through `@a11ign/evidence`'s `restatesWireType`, and declares the release that exports it (a11ign/a11ign#5105).

## 0.1.41

### Patch Changes

- 31aa5e5: `ready-label-audit.test.ts` answers `fetchReadyRowsWithBodies` with the by-label connection the tool reads since agent-org#5076 (its own `connectionOf` / `readsRowsByLabel` fixture, the one `row-claim.test.ts` takes), not a bare `gh issue list` array, so the two `#2190` tests that went red on `main` at tool `v0.169.2` pass again (a11ign/a11ign#5137).

## 0.1.40

### Patch Changes

- 9c350be: The lab runs its own programs from its own root (ADR 0045 cut 1, a11ign/a11ign#5078). `scripts/generate-coverage-doc.ts` takes its root from its own location and reads `rule-ownership.json` there, writing `docs/coverage.md` under it or to `--out=<file>`, and refuses an ownership file that is empty or declares no subtypes. `package.json` gains the 70 scripts the core's `package.json` ran against the lab, with targets relative to this root, and `tsx` as a dev dependency they name. The product checks that read lab files arrive in `src/product-checks/` and `tests/`, reading `@a11ign/judge`, `@a11ign/scorer` and `@a11ign/evidence` by their published exports. The core keeps its copies until row 2.

## 0.1.39

### Patch Changes

- dc56034: Six packaging tests follow the tool at its newest tag instead of reading an older one, so the `cross-repo` leg is green again: `row-claim.test.ts`'s `issue view` mocks answer by whether the requested `--json` fields include `body` (the claim reads `body,labels` in one call since agent-org#732, so the template-fields check had been skipped silently, and lists the rows that hold files over a GraphQL label connection since agent-org 209a56cb, a11ign#5039, which its fakes now answer); `agent-org-wiring.test.ts` reads the App-identity template values from `github.identity` (a11ign/a11ign#4900); `layer-repository-access.test.ts` no longer counts an issue citation in the `gh` wrapper as a repository table; `homepage-agreement.test.ts` accepts `productHome(<checkout>)` imported from the toolchain (agent-org#522); `acceptance-check-at-filing.test.ts` allows the `existsSync` default of the #855 Region check and still refuses a loop over acceptance tokens (a11ign/a11ign#5034); `pr-open.test.ts` gives every body it drives with `--draft` a `Draft-because:` line, which `pr:open` has refused `--draft` without since agent-org 586f9c2f (a11ign#5036), and pins that refusal.

## 0.1.38

### Patch Changes

- 625d0db: `acceptance-reads-the-live-body.test.ts` runs the live-body step as an exempt author (`PR_AUTHOR=dependabot[bot]`), the only author for whom the tool hands the whole body on since ADR 0044, so the two tests that read it back are green again (a11ign/a11ign#4854).

## 0.1.37

### Patch Changes

- 873db7a: `pr-open.test.ts` and `dependency-pr-body.test.ts` present agent-org's reader the `.acceptance/` file it reads (agent-org v0.138, a11ign/a11ign#4850).

## 0.1.36

### Patch Changes

- 7ba7ece: `acceptance-reads-the-live-body.test.ts` pins the core's command step to `PR_BODY`, `PR_AUTHOR` and `ACCEPTANCE_ROW_LABELS`, and pins `PR_AUTHOR` to the event's author login, so a value taken from the body or the token is still refused (a11ign/a11ign#4849).

## 0.1.35

### Patch Changes

- 08ed465: `git-population-vacuity.test.ts` classifies `ansible-yaml-parses.test.ts` by the floor lab#67 turned its equality into, and its note says what the floor still holds and no longer holds (a11ign/a11ign#4845).

## 0.1.34

### Patch Changes

- 5208658: Ten test files of the cross-repo leg read the core and its laid layers as they stand at `c18c2dab7` again: the `.mjs` to `.ts` renames, the `--import tsx` the core dropped, the roster's new role keys and the `@ts-check` floor that fell with the shims. One exemption is retired, its guard having moved to `@a11ign/toolchain` (a11ign/a11ign#4839).

## 0.1.33

### Patch Changes

- a4cff46: The 35 one-release `scripts/*.mjs` shims are deleted (a11ign/a11ign#4798, step 5 of a11ign/a11ign#4551), with `src/transitional-shims.ts` and its test. `scripts/` holds no `.mjs`, `.js` or `.cjs`, and `mjs-ratchet.baseline.json` is lowered by the 35 names (79 to 44; the 44 left are `src/training/*.mjs`). Anything still running a lab script by its `.mjs` path now fails to find it: the core from `81c6680ad` and control v0.3.6 name the `.ts`. `CORE_REF` moves to `da027c092`, past the core's last `packages/lab/scripts/*.mjs` reference.

## 0.1.32

### Patch Changes

- d2a7fd3: Nine packaging tests that read the core's workflows, units and hooks follow the core as it stands at `c18c2dab7` and the tool's newest tag, and one is retired. `ci-health`, `weekly-review`, `manifest-repository-check` and `consumer-gate` accept the core's steps as bare `node scripts/<name>.ts` (they were pinned to `node --import tsx`); `workflow-commands` and `workflow-filters` scan `.ts` programs as well as `.mjs`; `test-memory-cap` accepts the toolchain's `test-memory-cap.mjs` in the pre-push hook; `agent-org-wiring` picks the watcher unit's `ExecStart` by its npm script rather than its `ExecStartPre`; `regression-board-unit` follows the unit to `%h/.local/bin/node` and `src/bin.ts`. `work-gate.test.ts` is deleted: it was a stale copy of the tool's own `src/packaging/work-gate.test.ts`, which already classifies `ready-rows-untiered`, and its three edges are removed from `baselines/layer-edges.baseline.json`.

## 0.1.31

### Patch Changes

- 941f780: Seven of the lab's cross-repo tests are green at core `c18c2dab7` and the tool's newest tag, each read against what it was meant to guard (a11ign/a11ign#4829). `changed-files-renames` knows an add-only `--diff-filter=A` listing has no rename source side to lose; `control-plane-checkout-is-one-fact` treats an `.acceptance/` file as the record of a command somebody ran once, so a pull request's own worktree path is not a second literal of the checkout; `layer-edges` has its baseline's two stale entries removed and the one missing edge added; `local-import-closure` pins the tool's `arm-pr` imports as a floor, not an exact list; `row-claim` reads the three fields it is about, not every field the tool adds; `verify-affected-set` names the one trigger the core owes and re-points its sighted control at a file still in the closure; and `close-rows-on-merge`'s regex over the tool's `main()` source is retired, the decision it wired being pinned in the tool. No behaviour of the lab's own code changes.
- b01e1ea: `release-triggers-itself.test.ts` finds the core's three `node scripts/…` guard steps again (a11ign/a11ign#4837). The core dropped the `--import tsx` loader from its workflows' `node` calls (#4597) and the test's predicates for `manifest-repository-check`, `release-gate-scope` and `generate-consumer-gate --check` named only the old spelling, so every property read the three guards as missing and 18 of its 32 tests were red at core `c18c2dab7`. Both spellings are the one guard now, with a control that rewrites the live steps each way and one that a step running another script is still refused. No behaviour of the lab's own code changes.

## 0.1.30

### Patch Changes

- fab6f71: The six one-release shims are deleted (a11ign/a11ign#4519, step 5 of 5): `src/gates/qualification-status.mjs` and `src/harnesses/{assert-action-report,capture-check,capture-fixtures,occurrence-verdict-stability,page-identity-rate}.mjs`. `src/gates` and `src/harnesses` hold no `.mjs`, and `mjs-ratchet.baseline.json` is lowered by the six. Anything still importing `qualification-status.mjs` (`@a11ign/control` v0.3.4 and earlier) or running a harness by its `.mjs` path now fails to resolve it; control v0.3.5 imports the `.ts`.

## 0.1.29

### Patch Changes

- 8687c1d: The lab's tests import `@a11ign/toolchain/lib/*` (`tree-wide-guard`, `local-import-closure`, `sandbox-exhaustion`, `walk-scope-discovery`, `test-memory-cap`, `git-sandbox`, `product-home`, `fixture-symbols`) and no longer name the core's deleted copies, and `CORE_REF` moves to core `c18c2dab7` (a11ign/a11ign#4822). The tests that follow the core's moved contracts are updated with it: the tree-wide-guard discoverer (#4718), the `.mjs` to `.ts` of worker-fleet, the hook's toolchain cap. No behaviour of the lab's own code changes.

## 0.1.28

### Patch Changes

- 91af8c0: The 35 `.mjs` programs of `scripts/` are TypeScript (a11ign/a11ign#4551, step 1 of 5 of the landing order on that row): `audit-*`, `check-*`, `corpus-*`, `evidence-check`, `explain-*`, `promote-model`, `retrain-pipeline`, `stability-gate` and the rest, run as `node scripts/<name>.ts`. Each old `.mjs` name stays for ONE release as a shim, because the core's `package.json` and nightly unit and control's `lab-job.yml` still name it and a bare rename reds lab's required `own` leg. The shim re-exports the `.ts` for an importer and, as the entry file, runs the `.ts` with the same arguments and exits with its status (a bare re-export would exit 0 having measured nothing). A shim cannot run under the distro `/usr/bin/node` (v22.22.1 does not load `.ts`), so a caller that names it must move to Node 24 or `tsx` with the pin. The shims go in the release after the core and control name the `.ts`. One output changed: the header row of `explain:scorer`'s model comparison printed the literal text `$/** @type {any} */ {reports.map(...)}` where the model names belong.

## 0.1.27

### Patch Changes

- 94ea357: The six `.mjs` files lab sweep 2 left behind are TypeScript: `src/gates/qualification-status.ts` and `src/harnesses/{assert-action-report,capture-check,capture-fixtures,occurrence-verdict-stability,page-identity-rate}.ts` (a11ign/a11ign#4519, step 1 of 5). Each old `.mjs` name stays for ONE release as a shim, because the core's `package.json` and workflows at the `CORE_REF` this repository's CI pins name the harnesses by path, and `@a11ign/control` v0.3.2 imports `qualification-status.mjs`: the gate's shim re-exports, and each harness shim THROWS (a re-export would exit 0 having measured nothing). They go in the release after control's import and the core's callers name the `.ts`.

## 0.1.26

### Patch Changes

- 29a1a43: The lab's 40 source-reading tests import `stripComments` from `@a11ign/toolchain/lib/source-text` instead of `@a11ign/evidence/source-text`, which the core removes in its next evidence release (a11ign/a11ign#4712, #4425 phase 3). `devDependencies["@a11ign/toolchain"]` moves `0.1.5` to `0.7.0`, the first release that exports `./lib/source-text` in the 0.5 to 0.7 range (0.1.5, 0.2.0, 0.3.0 and 0.4.0 do not), and `ci.yml` reads that same field to install the layout check, so the layout check runs at 0.7.0 after this change. `stripComments` is byte-identical across the two on all 1,653 tracked text files of the lab and the core (a11ign/a11ign#4720).

## 0.1.25

### Patch Changes

- 5ea6e02: The capture fleet guard converges an odd `displayMode` or behind-build box (display re-assert, `fleet:patch --apply --limit`) and re-reads before exiting 3; a box ahead of the fleet is never patched (a11ign/a11ign#4448).

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
