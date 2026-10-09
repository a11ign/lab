Closes a11ign/a11ign#4525

Acceptance: `node --test --test-name-pattern='\[3[67]\]' src/packaging/agent-org-wiring.test.ts`

Option 1 of the row, reached by correcting my first push (`012a6e00` pinned `["src/lib/cli-flags.mjs"]` and failed CI: `actual: []`). Under the newest agent-org tag (`v0.102.1`, what CI resolves) with the core laid as CI lays it (the fleet layer's `packages/worker-fleet/src` present, from `lay-layer.mjs`), 19 pairs and NO unreadable original: agent-org#501 corrected `product-home` and `fixture-symbols`, and `cli-flags`'s original is read from the laid fleet layer. The row's open-check read a core WITHOUT the layer laid, which is why it saw `cli-flags` unreadable; that reading is not CI's tree.

- `KNOWN_UNREADABLE_ORIGINALS` and `withoutKnownUnreadable` are deleted; [36] asserts no pair has a `null` original and the reading is `clear`; [37]'s use is dropped.
- [36]'s `lib/` scan is kept, and the positive control that the reading is `unknown` while an unreadable pair is in is kept (now built by nulling one original of the real pairs).
- Patch changeset updated.

Mutation: with the fleet layer removed from the core (one unreadable original) [36] and [37] both go red; with it laid they pass (2 pass, 0 fail). Measured locally, tool at `v0.102.1`, `AGENT_ORG_HOST` set.

Done-when 2 (lab `main` CI green after the merge) is read after the merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
