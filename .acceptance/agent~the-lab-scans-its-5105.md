Closes a11ign/a11ign#5105

Acceptance: `node --test src/product-checks/wire-type-declarations.test.ts`

Mutation: appending `stateChanges?: { control: string; after: string }[]` to `src/harnesses/judge-file.ts` makes the scan test fail and name that file (`src/harnesses/judge-file.ts: stateChanges: { control: string; after: string }[]`), 2 pass and 1 fail; the file restored byte-identical from a copy (`cp` and `diff`). Emptying the population (`labSources(/\.nothing$/)`) fails the positive control (`0 files`, `src/harnesses/judge-file.ts is not in the scanned population`), restored byte-identical the same way.

Outside-Region: src/packaging/acceptance-check-at-filing.test.ts — the core's `scripts/acceptance-check-at-filing.ts` gained `checkout !== null && existsSync(checkout)` (a third, named use of `existsSync`); the helper allows that one more shape and keeps the control that a hand-written token loop is still seen.
Outside-Region: src/packaging/auth-flow-parity.test.ts — the CLI's `flows.ts` parses `dismiss-if-shown` and `auto` (core #4994) ahead of the worker the core pins (0.9.0); the verb-list equality becomes shared-verbs-in-the-CLI's-order plus a `CLI_ONLY_VERBS` table that names each CLI-only verb with its reason, so a new unexplained one still fails.
Outside-Region: src/packaging/ci-changed.test.ts — core #4920 dropped the `ansible` category from `scripts/ci-changed.ts`; every `ansible` expectation and the whole PIN test go, as they did in the core's own copy (2751d81b3).
Outside-Region: src/packaging/gate-needs.test.ts — core #4920 removed the `ansible` job from ci.yml, so `KEPT` drops it.
Outside-Region: src/packaging/no-npm-spawn.test.ts — core #4988 removed the `// STAYS npm` marker from `scripts/agent-org-newest-tag.ts`; its reason is now the doc comment, so the entry names the sentence the file must still contain (`SAYS_WHY_IN_ITS_OWN_WORDS`), under the same two obligations.
Outside-Region: src/packaging/npm-cli-windows-spawn.test.ts — that script's spawns go through an injected `npmCli = npmCliInvocation` parameter; an identifier the file itself binds to `npmCliInvocation` is the helper, and one with no such binding is still refused.
Outside-Region: src/packaging/push-trigger-allowlist.test.ts — core #4969 added the `relay` and `arm-approved` jobs and the `pull_request_review` trigger to `auto-arm.yml`; the job and trigger lists say so.
Outside-Region: src/packaging/roles-readme.test.ts — the engineer brief's blocked clause is now `declare \`blocked <row> <reason>\` ... never stop and wait on a human`; the pattern follows the words (one copy, one section, mutation per clause all kept).
Outside-Region: src/packaging/row-claim.test.ts — the tool reads `git worktree list --porcelain` before `git worktree add`; the test finds the `add` call and not the first `worktree` call.

Mutation (each restored byte-identical from a copy, checked with `diff`; run against the core at 2b8489a8d, nine files, 310 tests, all green unmutated):
- `npm-cli-windows-spawn`: blinding the alias binding, removing the alias allowance, or treating every call as safe each fail it (2, 2 and 3 of 8 tests), and the unbound-`npmCli` control is the other direction.
- `no-npm-spawn`: naming a sentence the file never contains, or letting every file say why, each fail it (1 of 12).
- `auth-flow-parity`: renaming the `dismiss-if-shown` entry fails it (1 of 2); deleting the `auto` entry fails it naming `auto` (1 of 2).
- `roles-readme`: a pattern that no longer matches the brief fails the three tests that read it (3 of 42).
