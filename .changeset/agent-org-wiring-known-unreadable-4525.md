---
"@a11ign/lab": patch
---

`agent-org-wiring.test.ts` [36] pins the one unreadable original agent-org still has (`src/lib/cli-flags.mjs`, a11ign/agent-org#505) instead of the two a11ign/agent-org#501 corrected, so the lab's CI stops failing on the newest agent-org tag (a11ign/a11ign#4525).
