Closes a11ign/a11ign#4580

Acceptance: `bash -c 'node --test src/eval/referral-repeat-share-flags.test.ts'` (run from the lab root; `tsx` and `@a11ign/screenreader-fleet` resolved from a pnpm store, because a bare lab checkout installs nothing). Printed `tests 2 / pass 2 / fail 0`.

## What changes
`scripts/referral-repeat-share.ts` calls `refuseUnknownFlags([], { entry: import.meta.url, command: ... })` first in its entry block, so a typo'd `--flag` is refused (exit 2) instead of read as a file path. New `src/eval/referral-repeat-share-flags.test.ts` spawns the script through tsx with `--nonsense` (asserts exit 2 and `unknown flag --nonsense` on stderr, no `cannot read referrals`) and with no arguments (asserts the unchanged usage exit 2). Patch changeset added.

## Evidence
- `node scripts/referral-repeat-share.ts --nonsense` (through tsx) printed `npx tsx packages/lab/scripts/referral-repeat-share.ts: unknown flag --nonsense` / `It takes no flags at all.` / `Refusing rather than ignoring it: ...` and exited 2 (measured).
- Fails before the change: the test file did not exist; with the call neutralised (below) its first test fails.
- `src/gates/referral-repeat-share.test.ts` plus the new test: 11 pass, 0 fail (measured).
- Not run: lint, the core-laid typecheck, and control's `cli-flags` test (they need the lab laid in a core checkout, which CI does).

Mutation: call never fires (`argv: []` passed to `refuseUnknownFlags`) -> the `--nonsense` test fails and the no-arguments test passes. Call always fires (`argv: ["--x"]`) -> both tests fail (the first on the flag name, the second on the usage exit). Restored with `cp`; `diff` byte-identical.

Outside-Region: none
Fleet: No.
