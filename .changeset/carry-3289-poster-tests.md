---
"@a11ign/lab": patch
---

Carry a11ign/a11ign#3289's change (PR #3837) into the poster's tests: `post-qualification-status.test.ts` tests the poster that uses the host's `gh` (no token file; exit 3 on no usable credential), and `exit-code-contract.test.ts` drops "token file is absent". `CORE_REF` moves to `275635da6f45eae0cbd747ee1f9b2666935cde16` (the commit of #3837's branch that adds the poster, `275635da6`) because these tests import the poster by relative path from the core laid at that ref.
