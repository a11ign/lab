Closes a11ign/a11ign#5182

Acceptance: `node --test src/packaging/no-relative-core-imports.test.ts`

Run from this worktree of lab (`/home/agent/repos/lab-wt-5182`), with `@a11ign/toolchain` resolvable: `node_modules/@a11ign/toolchain` is a link to the core's `node_modules/@a11ign/toolchain` (0.9.0, which carries `dist/lib/git-env.mjs` and `dist/lib/source-text.mjs`). The lab's own pinned 0.7.0 exports `./lib/git-env` too. Exit 0: 3 pass, 0 fail.

Mutation: the test's last assertion is `assert.deepEqual(offenders, [])`, with the positive control (`labSources` includes `scripts/tool-source.ts` and three other files) unchanged. Restoring `../../guards/src/git-env.ts` in `scripts/evidence-check.ts` fails it (`actual: [ 'scripts/evidence-check.ts: ../../guards/src/git-env.ts' ]`, 2 pass, 1 fail); the file was restored from a copy and `cmp` reports it identical to the swapped version. Before the change the same assertion lists the four reaches, so it fails on the unswapped tree for the same reason.

Module resolution: `node -e "import('@a11ign/toolchain/lib/git-env')"` from this worktree gives `sandboxGitEnv` as a function. The four scripts' code lines are unchanged; the only diff in each is the import specifier (the core's `packages/guards/src/git-env.ts` and the toolchain's `src/lib/git-env.ts` differ only in comments).

Not run here: the four scripts were not imported, since their top-level code runs the gates. `pnpm run verify` and the lab's CI legs were not run; this checkout holds no installed lab dependencies beyond the link above, and CI is the run that decides.
