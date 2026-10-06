---
"@a11ign/lab": patch
---

Carry a11ign/a11ign#3289's change (PR #3837) into the poster's tests: `post-qualification-status.test.ts` tests the poster that uses the host's `gh` (no token file; exit 3 on no usable credential), and `exit-code-contract.test.ts` drops "token file is absent". `CORE_REF` moves to `78a3fae48ab8f1aed3ae8c9266e9ddcfb789ea8b` (#3837's head, which holds the new poster) because these tests import the poster by relative path from the core laid at that ref.
