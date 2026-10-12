Closes a11ign/a11ign#5191

Acceptance: `git grep -n 'new URL("../../../../"' -- scripts src ':!*.test.ts' | wc -l` (run from the lab root). Printed `0`.

## What changes
Five non-test files that climbed four directories out of the lab by position (`new URL("../../../../", import.meta.url)`) now take their root from `coreRoot(...)` in `src/dataset-paths.ts`, or from `runsRoot()` for the harness's pages directory:

- `src/packaging/laid-control.ts`: `coreRoot("A11Y_LAID_CONTROL_ROOT")`
- `src/packaging/laid-worker.ts`: `join(coreRoot("A11Y_LAID_WORKER_ROOT"), "packages/nvda-worker")`
- `src/packaging/prefix-pins.ts`: `coreRoot("A11Y_PREFIX_PINS_ROOT")`
- `src/packaging/rules-files.ts`: `coreRoot("A11Y_RULES_FILES_ROOT")`
- `src/harnesses/occurrence-verdict-stability.ts`: `join(runsRoot(), "screenreader-dataset/pages/")`

Each `coreRoot` call resolves through the gate's own variable, then `A11Y_CORE_ROOT`, then a lab laid at `<core>/packages/lab`. A standalone lab with none of them set refuses at import, naming the variables. CI is unaffected because it lays the lab under the core.

`src/core-root.test.ts`: the scan now matches three or four `../` climbs (`{3,4}`), with a positive control that a four-climb line is caught.

`scripts/cross-repo-tests.ts`: one comment line changed from a `new URL` climb to `resolve(import.meta.dirname, "../../..")`, because the Acceptance grep also matched that comment. This file is outside the row's Region.

Not moved to the core: the packaging tests still run in the lab. Their consumers read core content, and CI lays the core.

## Evidence (measured)
- Acceptance: `0` matches (see above).
- `node --test src/core-root.test.ts`: `tests 6 / pass 6 / fail 0`.
- Mutation: a four-climb line appended to `rules-files.ts` is caught by the scan. Restored with `cp`, `diff` identical.
- The 16 packaging test files that import the four `packaging` modules (`A11Y_CORE_ROOT=/home/agent/repos/wt-5191 node --test ...`) did NOT run to completion here. Every failure is a module-resolution or missing-layer error, with no assertion failure: `yaml`, `@a11ign/control`, `@a11ign/screenreader-worker` absent from this host; `/home/agent/repos/guards`, `/home/agent/scripts` and `/home/agent/docs` are not in this environment; the core checkout has no laid `packages/nvda-worker` (`laid-worker.ts` refuses with its own message).

## Not done / open
- Lint, typecheck and rstest were not run: the lab has no lockfile and its dependencies are not installed on this host.
- The harness file's import check was blocked by `Cannot find package '@a11ign/control'`, so it was verified by the Acceptance grep and by reading, not by importing it.

Outside-Region: scripts/cross-repo-tests.ts — line 9, a comment only, reworded so the Acceptance grep does not match its own comment.
Fleet: No.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
