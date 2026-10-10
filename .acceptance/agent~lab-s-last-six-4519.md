Closes: none — step 1 of 5 for a11ign/a11ign#4519 (the landing order is on that row; the row closes with lab step 5, when the six shims are deleted)

Acceptance: `bash -c 'cd src && for n in gates/qualification-status harnesses/assert-action-report harnesses/capture-check harnesses/capture-fixtures harnesses/occurrence-verdict-stability harnesses/page-identity-rate; do test -f $n.ts && test -f $n.mjs && grep -q "a11ign/a11ign#4519" $n.mjs || { echo "MISSING $n"; exit 1; }; done; echo "six .ts, six marked shims"' && test "$(git ls-files src/gates src/harnesses | grep -cE "[.]mjs$")" -eq 6 && test -z "$(git grep -nE "(assert-action-report|capture-check|capture-fixtures|occurrence-verdict-stability|page-identity-rate|qualification-status)[.]mjs" -- src baselines | grep -vE "^src/(gates|harnesses)/[a-z-]+[.]mjs:")"` (hand-run from the lab root; the typecheck and tests below are run from a core worktree with this tree laid at `packages/lab`)

## What changes
- The six files are renamed to `.ts` by `js-to-ts` (TypeScript 6.0.3, every other `.mjs` excluded), then the residue is fixed by hand: JSDoc `@typedef`s become exported `type`s (`Outcome`, `StatusPayload`: control's `post-qualification-status.ts` reads both by `import("…").Outcome`), JSDoc casts become `as`, and the JSDoc `any` the conversion kept becomes the `Loose` alias of `src/capture/loose.ts` (sweep 2's convention: one disable and its reason).
- Every place that spells a renamed path now spells the `.ts`: `src/packaging/post-qualification-status.test.ts`, `src/training/wake-by-hand.test.ts`, `src/gates/exit-code-contract.test.ts`, `src/gates/gate-partial-corpus-contract.test.ts`, `baselines/layer-edges.baseline.json` and seven comments.
- **Each old name stays as a one-release shim, and that is the whole reason this is step 1 of 5.** `qualification-status.mjs` re-exports the `.ts`. The five harness `.mjs` THROW: each `.ts` runs only when it is the entry file (`import.meta.url === pathToFileURL(process.argv[1])`), so a re-export would exit 0 having measured nothing.

## Why the shims (measured, not inferred)
Run as lab CI's REQUIRED `own` leg (`scripts/cross-repo-tests.ts --scope=own`) over the core at `fbb0d0b82` with control `v0.3.2` laid, lab `origin/main` with the six renamed and NO shim added `packages/lab/src/referenced-scripts.test.ts` (reads the core's `package.json` at `CORE_REF`, which names four of the six) and `packages/lab/src/packaging/post-qualification-status.test.ts` (control `v0.3.2` imports `qualification-status.mjs`) to the 2 failing files `origin/main` has in that environment. With the shims: the failing set is identical to `origin/main`'s, name by name. The order and the other four steps are on a11ign/a11ign#4519.

## Evidence
- `own` leg, lab `origin/main` vs this head (same environment): **0 new failing tests** (`comm -13` of the two failing sets: empty; 2 failing files at both, 1571 tests).
- `cross-repo` leg (`--scope=cross-repo`): 58 failing at `origin/main`, 57 here, **0 new** (`comm -13` empty; the one test that differs, `no-worker-refusal.test.ts`, is a wall-clock test that passed here).
- `tsc -p packages/lab/tsconfig.json --noEmit` in a core worktree with this tree laid: the same 9 errors in 8 test files as `origin/main`, **0 in the six, 0 in `packages/control/src/post-qualification-status.ts`** (it was 35 before the hand fixes).
- `eslint --no-ignore packages/lab`: 0 errors.
- Every new `.ts` and every shim imports under Node 24 (type stripping): the five harness shims throw on import by design.

Host-install: none. No file here is named by a deployed unit, an Ansible task or a `bin` (lab has no `bin`).
Outside-Region: `src/packaging/post-qualification-status.test.ts`, `src/training/wake-by-hand.test.ts`, `src/gates/exit-code-contract.test.ts`, `src/gates/gate-partial-corpus-contract.test.ts`, `baselines/layer-edges.baseline.json`, `src/harnesses/captured-text.ts`, `src/packaging/checkout-dash-safety.test.ts`, `src/packaging/fetch-wrapper-coverage.test.ts`, `src/training/budget-ladder.test.ts`, `src/training/capture-screenreader-dataset.mjs`, `src/training/repeat-capture.mjs`, `.acceptance/agent~lab-s-last-six-4519.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
