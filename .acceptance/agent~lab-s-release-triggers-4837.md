Closes a11ign/a11ign#4837

Acceptance: `bash -c 'id=$(gh run list --repo a11ign/lab --workflow ci --branch agent/lab-s-release-triggers-4837 --limit 1 --json databaseId --jq ".[0].databaseId") && gh run view "$id" --repo a11ign/lab --log | grep -aE "(✓|✗).*packaging/.*release-triggers-itself[.]test[.]ts.*\([0-9]+\)" | awk "/✗/{f++} /✓/{p++} END{print p+0, \"pass\", f+0, \"fail\"; exit !(p==1 && f==0)}"'` (hand-run once the pull request's own `checks (cross-repo)` job has finished: it reads that job's log for the one Region file and exits 0 when it reports `✓`. The row's own command, which reads the newest `main` run, is hand-run after the merge, as the row says.)

Mutation: the `gate-scope-statement` predicate made to never match, then to always match, then the loader pattern narrowed to the old spelling only, then to the bare spelling only -- each went red in its own tests (19, 2, 19 and 1 failing; the 19 are the original 18 plus the new control), and the file was restored by `cp` and `diff`ed identical.

## What changes
**Fixed forward** (the row's third option; neither of the first two applies). What the file guards is the SHAPE of the core's `release.yml` and the guard steps it names, and no `@a11ign/*` package carries that, so there is no version to move the read to. Retiring it would drop the 9 guard steps and the 3 called-workflow guards it pins, and the core's own `release-publishes-to-next.test.ts`, `release-promotes-by-evidence.test.ts` and `release-publishes-only-what-stays.test.ts` pin other properties of that file, not which steps `guards` holds (checked by reading the three: none names `manifest-repository-check`, `release-gate-scope` or `generate-consumer-gate`).

One cause for all 18: core `472f05695` (#4597) wrote `node scripts/manifest-repository-check.ts`, `node scripts/release-gate-scope.ts` and `node scripts/generate-consumer-gate.ts --check` in `release.yml` (lines 275, 257, 253), and three predicates in `GUARDS` matched `node --import tsx scripts/…` only. Every `refusals()` call listed `guard-manifest-repository-check`, `guard-gate-scope-statement` and `guard-consumer-gate-current`, which is why each control failed alongside its own property. The predicates now read `node (?:--import tsx )?scripts/…`; the guard they name is unchanged.

A new control rewrites the live `guards` steps each way (with and without the loader) and expects no refusal, and swaps `release-gate-scope.ts` for another script and expects `guard-gate-scope-statement` and nothing else.

## Evidence (measured)
Lab at this head laid at `packages/lab` of a core worktree at `c18c2dab7` (`CORE_REF` at lab `origin/main` `b23ac008`), `pnpm install --offline` and `pnpm run build`, toolchain 0.7.0 linked beside it, the tool at v0.134.0 (the newest stable resolved, CI's run used 0.133.15), Node 24.21.0 (CI runs 22: not measured here). `pnpm exec rstest run --config scripts/rstest/rstest.config.ts packages/lab/src/packaging/release-triggers-itself.test.ts`:

| | before (`b23ac008`) | after (this head) |
|---|---|---|
| `release-triggers-itself.test.ts` | 32 tests, **18 failing**, 14 passing | 33 tests, **0 failing**, 33 passing |
| `eslint --no-ignore` on the file | | 0 errors |
| `tsc -p packages/lab/tsconfig.json --noEmit` | | no output (0 errors) |

CI's own count at `9643e5d2` is 18 failing for this file (run 38056110285, from the row), which the local run reproduces.

## Not done
- The rest of the `cross-repo` leg stays as lab#65 and the other residue rows leave it; `continue-on-error` is still on the leg and `own` is untouched: no workflow changes.
- Not run here: the rest of the lab's suite (this edits one test file; CI's `checks` runs it). Resource ban respected: no `fleet:*`, `lab:*`, `worker:*` or gate run.

Fleet: No.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
