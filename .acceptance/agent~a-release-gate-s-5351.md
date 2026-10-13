Closes a11ign/a11ign#5351

`gate:core-held` no longer names the closed a11ign/a11ign#5179, and the lab's CI fails when a `REFUSED` line in `package.json` names a closed issue (the same class the core closed in a11ign/a11ign#5333).

**What changed.**
- `package.json`: the text now reads "the open row that owns whether a release may proceed without them is a11ign/a11ign#4425". That is the row the core's own `gate:lab-held` names for the symmetric question and it is open, but **the owner is `product-manager`'s to name** (the row says so): the string is one token, and the new check keeps whatever is named open.
- `scripts/refusal-owners-are-open.ts` and its test: **COPIED from the core's branch `agent/a-release-gate-s-5333` (PR a11ign/a11ign#5352, not yet merged when copied)**, not imported: the core does not publish it and ADR 0045 forbids a reach into another repository's tree. Trimmed to what the lab has: `package.json` only (no lab workflow carries a `REFUSED` line, measured with `git grep REFUSED -- .github/workflows`), default repository `a11ign/lab`. The rules in the two files must move together; the header says so.
- `.github/workflows/ci.yml`: a `refusalOwners` job runs the test with `A11Y_CHECK_REFUSAL_OWNERS=1` and `github.token`, asserts the `LIVE PASS` line, and is in `gate`'s `needs` with a success-only check, so it blocks. The test pins that wiring and runs the step's own `run:` block under `bash -e` with a stub `node`.

**Measured at this head** (`node --test src/packaging/refusal-owners-are-open.test.ts`): 15 tests, 14 pass, 1 skipped (the live read, opt-in, with its reason printed). With `A11Y_CHECK_REFUSAL_OWNERS=1`: 15 pass, and it prints `LIVE PASS: package.json script "gate:core-held" names a11ign/a11ign#4425: a11ign/a11ign#4425 is open`.

**Done-when 3, measured:** with `package.json` put back to the 2026-10-13 string and the live flag set, the test fails with `package.json script "gate:core-held": REFUSED names a11ign/a11ign#5179 as its owner, and a11ign/a11ign#5179 is CLOSED`. The fixture half pins the same string with the owner closed (fails), open (passes) and unreadable (`CANNOT_TELL`, fails).

**Lint and typecheck:** the two files were copied into a core checkout's `packages/lab` and run with the core's config: `eslint --no-ignore` 0 errors (one `no-magic-numbers` warning, then named), `tsc` over a program holding the two files exit 0. The full `checks` legs need the lab laid at `CORE_REF` and are CI's first run (not run locally).

Acceptance: `node --test src/packaging/refusal-owners-are-open.test.ts` exits 0, with 14 tests passing and the live read skipped with its reason.

The test declares `// no-token: gh`: the fixture half spawns nothing (`readIssueState` takes an injected runner), and the one read of GitHub is the opt-in live test, which `ci.yml`'s `refusalOwners` job runs with `github.token`.

Mutation: ten, each restored byte-identical from a copy (`diff -q` after each). Reader: (A) `failures` never fires: fails 4 (closed, unreadable, citation, reworded). (B) `failures` always fires: fails only the owner-open twin. (C) qualifier not read, so `a11ign/a11ign#5179` is read as a bare `#n`: fails 7, the real-tree control included. (D) citations count as owners: fails the citation and the reworded tests. (E) an unreadable issue read as open: fails the path-fragment and the live-reader-mapping tests. (F) a `REFUSED` string with no owner passes: fails only the reworded test. `ci.yml`: (G) the `LIVE PASS` grep removed, (J) the step piped through `tee`: each fails only the step test. (H) `gate` no longer needs `refusalOwners`, (I) `gate` accepting anything but `success`: each fails only the blocking test. (K) `package.json` put back to `#5179`, live flag set: fails naming the script and the number.

Outside-Region: src/packaging/refusal-owners-are-open.test.ts — the row's Region and Acceptance name `scripts/refusal-owners-are-open.test.ts`, but `every-test-file-is-run.test.ts` fails a `*.test.*` under `packages/lab/scripts/` that no runner glob reaches (the first run's `checks (cross-repo)` leg, run 38337592409), and the globs are the core's `package.json`, not this repository's. The reader stays at `scripts/refusal-owners-are-open.ts`; the test is under `src/`, which `packages/*/src/**/*.test.ts` reaches. **The row's Acceptance command, as written, therefore names a file that does not exist; the command that runs is the one below.**
Outside-Region: baselines/layer-edges.baseline.json — `layer-edges.test.ts` reported `NEW EDGE out: packages/lab/scripts/refusal-owners-are-open.ts -> package.json` (the same run). The literal is this repository's own manifest, which the scanner reads as the core's; one `by-name` entry with that reason, the shape of `tool-source.ts`'s.
Outside-Region: src/packaging/cross-repo-tests.test.ts — it pins `gate`'s `needs` to `[changeset, checks, release-dry-run]`; the `checks (own)` leg of the first run failed on exactly that assertion (206 files passed, 1 failed), so the pin moves to include `refusalOwners` and gains the matching result-read assertion.
Fleet: No.

platform: checked `gh api repos/<repo>/issues/<n>` for the state read, and whether GitHub or the toolchain offers a check that a refusal message names an open issue (none); the reader is the core's, copied.
