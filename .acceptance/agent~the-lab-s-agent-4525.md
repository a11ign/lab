Closes a11ign/a11ign#4525

Acceptance: `cd /home/agent/repos/lab && node --test --test-name-pattern='\[3[67]\]' src/packaging/agent-org-wiring.test.ts`

Read first: the newest agent-org tag is `v0.102.1`; a11ign/agent-org#505 (corrects `src/lib/cli-flags.mjs`'s header) is still OPEN, so this is option 2 of the row. Measured with the tool at `v0.102.1` and a clean core at `791552a77` (no laid `packages/worker-fleet`): 19 pairs, one unreadable original, `src/lib/cli-flags.mjs`. Before the change [36] failed (`actual: ['src/lib/cli-flags.mjs']`, expected the two corrected ones); after, `[36]` and `[37]` pass. Incidentally, with a laid `packages/worker-fleet/src/cli-flags.mjs` present the same test fails the other way (`actual: []`), which is the "a corrected header fails until its entry is deleted" direction.

- `KNOWN_UNREADABLE_ORIGINALS` is now `["src/lib/cli-flags.mjs"]`, citing #505; the comment says to delete it and `withoutKnownUnreadable` when #505 is tagged.
- [36]'s `lib/` scan and the `unknown`-while-unreadable positive control are unchanged.
- Patch changeset added.

Done-when 2 (lab `main` CI green after merge against the newest tag) is read after the merge.

platform: nothing to build; a test constant only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
