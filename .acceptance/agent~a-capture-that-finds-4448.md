Closes a11ign/a11ign#4448

Acceptance: `bash -c '/home/agent/repos/screenreader-fleet/node_modules/.bin/tsx --test src/training/capture-fleet-guard.test.ts'` (run from the lab root, with `@a11ign/screenreader-fleet` resolved from a sibling checkout because a bare lab checkout installs nothing). The row's own `pnpm exec rstest run` form cannot run on this host (no rstest installed in `~/repos/lab`) and is the hand-run. Printed `tests 27 / pass 27 / fail 0`.

## What changes
`assertOneBrowserAcross` takes an injected `converge` (`reassertDisplay`, `patch`). On a split it plans per odd box (a `displayMode` odd box is re-asserted to the fleet's modal value; a `windowsVersion`/`windowsBuild` box BEHIND the modal build and `busy === false` is patched; AHEAD, busy, unknown-busy, tied-modal and every other field are left alone and named), runs the plan, RE-READS the fleet, and only then refuses. The refusal prints each box, field, value, fleet value and what was tried. `fleetConvergeCommands` is the production binding: `npm run fleet:patch -- --apply --limit=<name>` and `npm run fleet:provision -- --display-mode=<WxH> --limit=<name>`, pinned by argv.

## Evidence (measured)
- 7 new tests; the 20 existing #2018/#2047/#2063/#2170 cases pass unchanged.
- Mutations (`cp` before, `cp` after, `diff` identical): busy check off -> busy test fails (1); ahead branch off -> ahead test fails (1); converge never fires -> 4 fail; re-read dropped -> 2 fail.

## Not done / open
- The caller (`capture-real-pages.mjs`) does not yet pass `converge`: outside this Region, so behaviour is unchanged until it does, and it must supply `nameOf` (URL -> inventory name).
- Row A's `windowsBuild` field is not yet in `MUST_MATCH`; the guard reads `windowsVersion` today and `windowsBuild` once it lands.
- The display re-assert uses `fleet:provision --display-mode` (the one-worker command that exists); starting row D's logon task on demand has no command yet.
- Not run: lint, the typecheck, rstest.

Mutation: busy check off -> busy test fails (1); ahead branch off -> ahead test fails (1); converge never fires -> 4 fail; re-read dropped -> 2 fail. Restored with `cp`, `diff` identical.

Outside-Region: none
Fleet: No.
