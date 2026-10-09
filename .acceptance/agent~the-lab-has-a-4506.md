Closes a11ign/a11ign#4506

Acceptance: `bash -c 'node -e '"'"'const p=require("./package.json"); const t=p.scripts?.test??""; const c=t.split("--config ")[1]?.split(" ")[0]; process.exit(/rstest run/.test(t) && c && require("node:fs").existsSync(c) ? 0 : 1)'"'"''` (run from the lab root). Exits 1 on `origin/main` (no `test` script) and 0 on this branch (measured).

## What changes
`package.json` gains `"test": "rstest run --config scripts/rstest/rstest.config.ts"`. New `scripts/rstest/rstest.config.ts` is a thin call into `@a11ign/toolchain/rstest-config` (the shape of `agent-org`'s), with `root` the repository root and `include: ["src/**/*.test.ts"]`: the lab's tests all sit under `src/` (`tests/` holds Python only). Patch changeset added. No test rewritten, no workflow edited, no baseline moved.

## Evidence
- `pnpm exec rstest run --config scripts/rstest/rstest.config.ts src/training/capture-run-record.test.ts` printed `VERDICT pass: 14 tests in 1 file` (measured; `node_modules` entries linked from a sibling lab worktree because `@a11ign/control` is not on the registry, so a bare install fails).
- Acceptance command exit codes (measured): branch 0; `package.json` from `origin/main` 1.
- Not run: the whole `src/` suite under the new config (CI runs it through the core's config), lint and the core-laid typecheck (they need the lab laid in a core checkout, which CI does).
- Done-when 2 (the `test-runner` cell reading `OK`) cannot be read before merge: the table reads the default branch. To be pasted on the row after merge.

Mutation: no `test` script (`origin/main`'s `package.json`) -> exits 1. Config file absent (moved aside) -> exits 1. Script names another runner (`jest run`) -> exits 1. Each restored with `cp`; `diff` byte-identical.

Outside-Region: none
Fleet: No.
