Closes a11ign/a11ign#5347

Acceptance: `git ls-tree -r --name-only HEAD | grep -x "src/packaging/capture-body-owner.test.ts"`

The row's own Acceptance (`cd ~/repos/lab && git fetch -q origin && git ls-tree -r --name-only origin/main | grep -qx "src/packaging/capture-body-owner.test.ts"`) reads `origin/main` and is true once this merges; the form above is the same sentence read at this branch's HEAD. Run from this worktree it prints `src/packaging/capture-body-owner.test.ts` (nothing at origin/main cfbc75b8, the row's Open-check).

**What moved** (copied from a11ign/control `origin/main` `src/fleet-layer/`, which a11ign#5345 deletes after this merges; control is not edited here):

| control test | lab file | what it holds |
|---|---|---|
| `capture-body-owner.test.ts` | `src/packaging/capture-body-owner.test.ts` | whole file, 7 clients under lab `src/training` and `src/harnesses` |
| `worker-code-check.test.ts` | `src/packaging/worker-code-check-clients.test.ts` | the capture-client discovery trio (+ one positive control) |
| `worker-url.test.ts` | `src/packaging/worker-url-clients.test.ts` | the `--worker=` discovery, now walking the lab |
| `worker-http-client-owner.test.ts` | `src/packaging/worker-http-client-owner-lab.test.ts` | the two lab functions and the `EXEMPT` read-back |
| `no-win32-imports.test.ts` | `src/packaging/no-win32-imports-lab.test.ts` | the lab's two trees, `VOICEOVER_SPIKE` allowlist, dynamic-import control |

Also: `declared-walk-scope.test.ts` names the new path (row cross-reference); `baselines/layer-edges.baseline.json` gains 7 entries (the new files' imports of `guards` and `worker-fleet`, shaped like their siblings').

**Two things that are not a byte-for-byte move, because moving them as they were would have kept a defect:**
- `captureClients()` in the code-check trio matched `.mjs` alone, so the five harness clients (`.ts` since lab v0.1.27) were never discovered and `DIAGNOSTICS` was classified by hand and never checked. It matches `.mjs|.ts` now, as `capture-body-owner` always did, and its floor is the number classified.
- Two floors printed the count they floor, which `reported-counts.test.ts` refuses as NEW; their messages name no count.

**Measured** (the lab laid as `packages/lab` over a core worktree, with the fleet and worker layers laid from their `origin/main`; `A11Y_ALLOW_FOREIGN_RESOLUTION=1` because the worktree's `@a11ign/*` are installed copies, which these string-scanning tests do not touch): the five new files + `declared-walk-scope` + `reported-counts` = `VERDICT pass: 72 tests in 7 files`. `eslint` on the five: 0 errors; `tsc -p packages/lab/tsconfig.json`: no error in them.

Mutation, each on the laid copy and restored from a copy with `diff` identical, each breaking exactly one test of its own file:
- a new unclassified `captureTolerantly(` client in `src/harnesses`: `capture-body-owner` and `worker-code-check-clients` each fail the classification test
- a `--worker=` reader with no `assertWorkerUrl`: `worker-url-clients` fails
- a lab module with a static `import "@guidepup/guidepup"`: `no-win32-imports-lab` fails
- a raw `fetch(` in `workerState`: `worker-http-client-owner-lab` fails
- a corpus writer without `assertFleetRunsThisCheckout(`: `worker-code-check-clients` fails
- unmutated: 4 of 4 pass

**Not run:** the lab's CI legs and the whole suite (the laid copy is not CI's: 200 of 3,193 `src/packaging` tests fail in it for want of the laid control and the rest of the layers, none in a file named here, read from the report's `testPath` list). `layer-edges.test.ts` was not green in my layout (24 fixture failures from `nvda-speech`/`nvda-worker` naming); I read the 7 edges with `findEdges` over the real tracked tree instead.

Outside-Region: baselines/layer-edges.baseline.json — a new test file's reach into `guards`/`worker-fleet` fails `layer-edges.test.ts` unless baselined (lab#104 did the same); the Region names `src/packaging` only.

**Left for the core, outside this Region:** `docs/guard-population-boundaries.md:139` (core) still lists `worker-fleet/src/capture-body-owner.test.ts`; it is a core row, named on a11ign#5347.
