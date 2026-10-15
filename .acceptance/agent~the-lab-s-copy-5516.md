Closes a11ign/a11ign#5516

Acceptance: `pnpm exec rstest run --config scripts/rstest/rstest.config.ts --include 'src/gates/refuse-unknown-flags-copy.test.ts'` (run from the lab root; the row's `cd ~/repos/lab` is the checkout it was written against). Printed `tests 9 / passed 9 / failed 0`.

## What changes

`src/gates/refuse-unknown-flags-copy.test.ts` (new) pins the lab's `scripts/refuse-unknown-flags.ts` against the shared `refuseUnknownFlags` from `@a11ign/screenreader-fleet/cli-flags`. Nine argv vectors each run in a child process for both implementations; the exit code and stderr of the copy are compared with the shared function's. Neither implementation is edited.

The vectors: no flags; a known flag; `--name=value`; an unknown long flag; an unknown short flag; `--` alone; an unknown flag after `--`; a script that takes no flags; an unknown flag when `entry` is not the invoked file.

## The divergence (pinned, not fixed)

The shared function prints a did-you-mean hint on an unknown flag that is near a known one (`unknown flag --nope — did you mean --json?`); the copy does not. The test strips exactly that hint from the shared stderr and compares the rest, so the known difference is named in the test and any other difference fails. `scripts/refuse-unknown-flags.ts` and the shared package are unchanged, as the row asks.

Also differing, not pinned, and not hit by the vectors: the shared function throws a TypeError on a falsy `entry`, and sorts the accepted-flag list.

## Evidence

- Acceptance above: `tests 9 / passed 9 / failed 0`.
- Mutation (positive control): one word in the copy's refusal line, `ignoring` to `skipping` (`scripts/refuse-unknown-flags.ts:27`). The same command failed 4 of 9 with `the copy diverges from the shared refuseUnknownFlags on argv ["--nope"]`, and on `["-x"]`, `["--","--nope"]`, and the no-flags `["--nope"]` case, quoting the mutated line. Restored from a `cp` backup; `diff` identical; the Acceptance then passed again.
- The hint is live on the vectors: the shared function on `--nope`, `-x`, and `--jsn` prints the hint, so the pin is exercised and not dead.

Not run: `pnpm run lint` and `pnpm run typecheck` (this package has neither script). `pnpm test` (the full rstest suite) gives `388 of 1488 tests failed in 394 files`, none of them in this file. Its causes are absolute paths to checkouts this worktree lacks (`/home/agent/packages/lab`, `/home/agent/repos/guards`) and a missing git repository; the failing set was not compared against a clean `origin/main`.

Outside-Region: none
Fleet: No.
