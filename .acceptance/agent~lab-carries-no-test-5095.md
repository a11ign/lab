Closes a11ign/a11ign#5095

Acceptance: `bash -c 'test ! -e src/packaging/codeowners-lane-sync.test.ts && ! grep -q codeowners-lane-sync baselines/layer-edges.baseline.json'`

Mutation: run from this worktree, each restore a byte-identical copy of HEAD (`cmp` empty). Restoring `src/packaging/codeowners-lane-sync.test.ts` alone makes the Acceptance exit 1; restoring its two entries in `baselines/layer-edges.baseline.json` alone also exits 1; the deletion as shipped exits 0.

Outside-Region: baselines/layer-edges.baseline.json -- the two entries that name the deleted test (`packages/lab/src/packaging/codeowners-lane-sync.test.ts` -> `CODEOWNERS` and `-> docs/lane-ownership.json`), removed. `layer-edges.test.ts` asserts "no stale entry" over the real tree, so deleting the test alone would fail it; the row's premise that only the core's baseline names the file was wrong for lab's own baseline.

Replaced by: agent-org `src/packaging/owned-path-signoff.test.ts` at agent-org 6e74cfba, run with `node --test`: 12 tests, 12 pass, 0 fail. This is the guard that stays for workflow owned-path sign-off; it needs no account.

Not run here: `pnpm run verify` and the layer-edges test itself. The lab checkout on this host has no lockfile and no installed dependencies (`@a11ign/toolchain` and `guards` are needed), so CI's `checks` job is the verification of the real test run.
