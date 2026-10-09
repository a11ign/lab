---
"@a11ign/lab": patch
---

`agent-org-wiring.test.ts` [36] no longer pins unreadable originals: agent-org#501 corrected the two it named (`product-home`, `fixture-symbols`) and the third, `cli-flags`, is read from the fleet layer the core lays, so under the newest agent-org tag every original is readable and the copies reading is `clear`. The list and `withoutKnownUnreadable` are deleted, and [36] asserts that none is unreadable and keeps its `unknown` positive control (a11ign/a11ign#4525).
