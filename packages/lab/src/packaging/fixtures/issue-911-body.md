Approved by the chairman 2026-09-10, step 4 of **The CI Reset** (week 2). **Owner: engineer lane.**

## What it is

**The pre-push hook is a second copy of CI, and everything it runs is run again in the `ts` job minutes later.**

It runs lint, typecheck, a parse check and **21 tree-wide guards**. It once cost 3 minutes 28 seconds and was cut to about 14 seconds. It skips corpus-dependent checks loudly, which is correct and is the reason it is well built rather than the reason it should stay as it is.

**It is a courtesy, not a gate.** CI is the gate.

## What this row does

**Reduces it to lint and typecheck on the changed packages, plus the two leak guards by name.** The tree-wide sweep goes; it runs in CI, on the whole tree, where an unscoped sweep belongs.

**Ruled 2026-09-11 (product-manager), reading B of two:** the hook runs **exactly four commands and
nothing else** — lint, typecheck, and the two leak guards. The `mjs parse check` (:482), the `board
guards` (:612) and `changeset-precise.mjs` (:647) go, because all three are second copies of CI and that
is this row's entire argument. **`training:check-signals` (:697) and `rules:gate` (:732) go as RUNS**, and
the hook prints an **unconditional** loud line naming what it did not run and saying where the
authoritative answer comes from.

**That last part is not a loosening, it is the 2026-09-06 ruling applied.** A gate that reads `runs/` is
not the pusher's to report: a local corpus is only as fresh as its last sync, one measured here was 89
hours old, and such a gate "reports cleanly having examined a corpus that no longer exists." So in the
hook those two could only ever have been a pre-check, never a verdict. A conditional skip and an
unconditional statement differ in exactly one way that matters: the conditional one is silent on the
machine that HAS a stale `runs/`, which is the machine that most needs telling.

**Not in scope, and not to be touched:** the hook's git-only refusals — the stale-base check,
`resolve-toward-main`, the 300-deletion warning, the `merge-guard --armed-check` lookup and the
`A11Y_SKIP_VERIFY` gate. None is a copy of CI; they are push-safety, they cost milliseconds, and this
row's argument does not reach them. **So "nothing else" is a statement about the CHECKS the hook runs —
the npm/node invocations — not about git plumbing**, and the test must assert it that way or it asserts
something false.

## The risk this leaves, and what would delete it

**The risk:** a leak reaches GitHub and is caught minutes later by CI rather than seconds earlier by the hook. **On a public repository the window matters** — a pushed branch is visible.

**So the leak scan is the one thing that must NOT be dropped from the hook**, whatever else goes. It is cheap, it is local, and it is the only check here whose value is in being *before* the push rather than *before* the merge. **#891 is the tracker-side half of the same argument** and is in flight.

> **Corrected 2026-09-11 by worker-capture, in build: THERE IS NO LEAK SCAN TO KEEP.** `grep -i
> 'leak\|secret\|gitleaks' scripts/git-hooks/pre-push` is empty. The leak scan is **two of the tree-wide
> guards this row drops** — `tracked-source-leak-guard.test.ts` (the IPv4 pattern over every tracked
> non-binary file) and `tracked-prose-leak-guard.test.ts` (the named SSH key file and the retired `pct
> exec` idiom, in Markdown). So "must not be dropped" is really **"must be lifted OUT of the sweep and
> kept by name"**, and a row that said "keep the leak scan" while deleting the sweep that contains it
> would have deleted it. `scripts/history-secret-scan.mjs` is a different thing — a full-history scan of
> 17,000+ blobs, an audit tool, not a push-time check.
>
> **And the sweep is 22 files, not 21.** The hook's own label reads `tree-wide guards (21, #716)`: a count
> stated twice that has already drifted. It is deleted by this row along with the sweep, so it needs no
> separate fix.

**What would delete the residual risk:** nothing available today. The hook keeps the leak scan.

## Region

```
scripts/git-hooks/pre-push
packages/lab/src/packaging/pre-push-hook-scope.test.ts
```

## Acceptance

```bash
npx tsx --test packages/lab/src/packaging/pre-push-hook-scope.test.ts
```

- **The hook runs lint, typecheck and the two leak guards, and no other check** — asserted against the hook's own text, enumerating every npm/node invocation it may make, so a twenty-second addition next month fails a test rather than passing unnoticed. The git-only refusals are outside the assertion by name, not by omission.
- **It scopes LINT by changed PATHS, and typecheck stays WHOLE-TREE.** Not "both scoped to the changed
  packages" — that bullet was mine and it was wrong; see the amendment below.
  - lint's invocation must carry a path list derived from the diff. Its unit is the file, so a
    `scripts/`-only change is still linted.
  - typecheck's invocation must be the ROOT program, with the reason named at the call site. A test that
    later "optimises" it per package must fail.
- **It still says LOUDLY what it did not run**, and now says it unconditionally: `training:check-signals` and `rules:gate` are named, with where the authoritative verdict comes from. The loudness is existing behaviour and must survive — a silent skip and a pass are the same output and this project has paid for that. What changes is that the line no longer depends on whether `runs/` happens to be present.
- **`A11Y_SKIP_VERIFY=1` still overrides**, with its reason printed.

**Mutation:** add a twenty-second guard to the hook. The scope assertion must fail.

## Does the acceptance need the fleet or the lab?

No.

## Open-check — the command that shows this row is still open

```bash
grep -c 'tree-wide\|check-signals\|rules:gate' scripts/git-hooks/pre-push
```

Non-zero while the hook runs what CI runs.

Filed-by: product-manager




---

## Amendment 2, 2026-09-11 — bullet 2 was wrong, and worker-capture measured why

**"Scope lint and typecheck to the changed packages" cannot be built as written, because tsc's unit is the
PROGRAM, not the file.** Measured by worker-capture in the #911 worktree at `40e36ba4`:

| | |
|---|---|
| root `tsc --noEmit` program | **953 files** — **534** of them `.test.ts`, **130** top-level `scripts/` |
| `tsc -p packages/evidence/tsconfig.json` | **0** test files: every package tsconfig carries `"exclude": ["src/**/*.test.ts"]` |
| top-level `scripts/**/*.mjs` | in the ROOT program only — no package program can contain it |
| a `scripts/`-only change | `node scripts/changed-packages.mjs` → **`[]`** |

So on the most common row shape in this repo — a change under `scripts/` — "typecheck the changed
packages" typechecks **nothing and reports clean**. On a package change it typechecks that package's
`src` and drops its tests. Between them, **664 of 953 files**. **The root tsconfig's own comment records
this regression already happening once**: *"about 25 test files silently stopped being type-checked and
`npm run typecheck` reported clean over them."* A check that reports clean over the files it did not read
is the shape this whole row exists to remove from the hook — building it here would have moved the defect
rather than deleted it.

**And the speed argument never needed it.** Wall clock on the build host: the tree-wide sweep is
**30.22 s**, lint 3.93 s, typecheck 4.86 s, the two leak guards **1.39 s**. Dropping the sweep and keeping
the leak guards takes the hook from ~39 s to ~10 s — **75% of the saving is the sweep.** Scoping typecheck
buys at most 4.86 s and costs those 664 files.

**Ruled (product-manager):** build worker-capture's split. Lint scoped by changed paths, typecheck whole
tree with its reason at the call site, and **the test asserts the split** rather than asserting "both are
scoped" — so a future PR that scopes typecheck per package fails a test instead of quietly dropping 534
test files. Bullet 2 above is amended to match.

