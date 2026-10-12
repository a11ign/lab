Closes a11ign/a11ign#5167

Acceptance: `bash -c 'grep -q "^export function toolGateSource" scripts/tool-source.ts && grep -q "const gate = toolGateSource();" src/packaging/update-primary.test.ts && ! grep -q "toolPath(\"src/work-gate.mjs\")" src/packaging/update-primary.test.ts'` (run from the lab root, no token and no core layout needed): exits 0 at this head. It is a STATIC reading of the two files; at `origin/main` `9d60f25e` the third clause is false, so the command exits 1 there.

Hand-run: the row's own command, `gh run view` over the newest lab `main` push run's `checks (cross-repo)` conclusion, needs a GitHub credential the acceptance job does not hold, so the host runs it AFTER the merge and pastes the conclusion on the row (`success` is the pass).

## What changes

`src/packaging/update-primary.test.ts` test `#2781 done-when 3` read the tool's gate as `src/work-gate.mjs` alone. The tool moved the `primary-stale` cause into `src/work-gate/causes/org-health-host-drift.ts` (a11ign/a11ign#5152), so the pin failed on the newest tool tag. It now reads the gate's module set through `toolGateSource()`.

`scripts/tool-source.ts` gains `toolGateSource()`: the entry (`toolPath("src/work-gate.mjs")`) followed by every non-test `.ts` file under `src/work-gate/` of the tool at `toolRoot()`, sorted and joined with a newline. This is the text agent-org's own `workGateSource()` (agent-org#1066) gives its tests. The tool exports no declaration for it, so it lives beside `toolPath`. `AGENT_ORG_TOOL` is NOT pinned at a pre-split tag: that would blind the cross-repo leg to tool releases.

## Evidence (measured)

- Before: `update-primary.test.ts` 22 pass, 1 fail, `AssertionError ... did not match /cause: "primary-stale"/` over the entry alone. Run against the newest tool tag `v0.175.7` (agent-org HEAD), on a CI-shaped scratch copy of the core at `wt-5167` with this lab laid into `packages/lab` as CI does.
- After: the same file, 23 pass, 0 fail.
- Mutation: `toolGateSource()` returning the entry alone -> 22 pass, 1 fail (`primary-stale` again). Restored, `diff` identical.
- `pnpm exec eslint --no-ignore` on both changed files: exit 0.
- `tsc -p packages/lab/tsconfig.json --noEmit` in the scratch layout: 236 errors, none in the two changed files; the rest are the workspace packages (`@a11ign/evidence`, `@a11ign/judge`, `control`) this scratch layout does not assemble.
- The 33 other lab test files that import `tool-source.ts`: 23 pass, 10 fail in the scratch layout. The same 10 fail with the original two files restored (identical counts), so they are not caused by this change.
- Not verified: the post-merge `checks (cross-repo)` read; it is the row's Acceptance and the host's hand-run.

Outside-Region: none
Fleet: No.
