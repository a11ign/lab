---
"@a11ign/lab": patch
---

`acceptance-reads-the-live-body.test.ts` runs the live-body step as an exempt author (`PR_AUTHOR=dependabot[bot]`), the only author for whom the tool hands the whole body on since ADR 0044, so the two tests that read it back are green again (a11ign/a11ign#4854).
