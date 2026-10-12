Closes a11ign/a11ign#5189

Acceptance: `bash -c 'test "$(git grep -cE "no-relative-core-imports.test.ts\",\"to\":\"packages/(control/src/fleet-wake|scripts/npm-cli-executable).ts|scripts/tool-source.ts\",\"to\":\"package.json\"" -- baselines/layer-edges.baseline.json | cut -d: -f2)" = 4'`

Hand-run, the real verdict: `node --test --test-name-pattern="agree with its own baseline" packages/lab/src/packaging/layer-edges.test.ts` from a core worktree with this tree laid as `packages/lab` and control laid beside it (the test imports the core's guard, so it cannot run from this checkout alone). It named the four NEW EDGEs before this change and none after. CI's `checks (cross-repo)` leg on main is the run that decides.

Run from a core worktree (fb4425991) with this tree laid as `packages/lab` (files `git add -f`ed, as CI does) and control laid from `origin/main` at `packages/control`. Before the change the four NEW EDGEs of run 38218432835 are named; after it none is. The row's literal `node --test src/packaging/layer-edges.test.ts` cannot run from the lab checkout alone (the test imports `../../../guards/src/layer-edges.ts`, which exists only in the laid layout).

Not clean here, and not caused by this change: the same run reports two STALE ENTRYs on my laid tree, `gates-are-proven.test.ts -> packages/scorer/tests/test_grants_map_is_current.py` and `git-population-vacuity.test.ts -> packages/guards/src/doc-script-examples.test.ts`. Both targets are absent from the core at fb4425991 and origin/main (deleted by 7d1bb7b04 and edef50720). Run 38218432835 listed no STALE line, so CI's laid core differs from mine; left alone because the row's Region is the four edges and I could not reproduce CI's layout. If the post-merge run reads them, they are a second row.

Reasons written for each edge, read against the source: the three edges of `no-relative-core-imports.test.ts` are string samples handed to `reachesOutside`, never imports; the `tool-source.ts -> package.json` edge is `join(toolRoot(), "package.json")`, the TOOL's manifest and not the core's (the row's premise said the core's), so its disposition is `by-name`, not `checkout-path`. No edge was cut, so no Outside-Region.

Mutation: not applicable, the change is data; the guard's own both-direction tests live in `layer-edges.test.ts` and were not changed.

no-release: a baseline data file only, nothing shipped changes.

Not run: `pnpm run verify` and the lab's CI legs (no lockfile or installed dependencies in this checkout); post-merge `checks (cross-repo)` on main is the reading that decides Done-when 2.
