Both nightly release scripts imported `@a11ign/screenreader-fleet/cli-flags`, which does not resolve where the unit runs them (no `node_modules`). They now use a local `scripts/refuse-unknown-flags.ts`; a test refuses a package import in either.

Closes a11ign/a11ign#5501

Acceptance: `node -e "import('/home/agent/repos/wt-5501-lab/scripts/corpus-release-nightly.ts').then(() => console.log('LOADS'))"` printed `LOADS` from a worktree with no node_modules; `corpus-release.ts` also LOADS; `--bogus` exits 2. Not run: the lab's CI leg. Two pre-existing tests in `corpus-release-nightly.test.ts` fail in this standalone layout (they path `packages/lab/...`), unrelated; the two new ones pass.

Not fixed, to be filed: the script still runs ansible at `packages/control/ansible/lab-fetch.yml` relative to the cwd, which the core no longer holds, so a full firing is not shown here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
