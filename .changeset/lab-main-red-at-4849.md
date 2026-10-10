---
"@a11ign/lab": patch
---

`acceptance-reads-the-live-body.test.ts` pins the core's command step to `PR_BODY`, `PR_AUTHOR` and `ACCEPTANCE_ROW_LABELS`, and pins `PR_AUTHOR` to the event's author login, so a value taken from the body or the token is still refused (a11ign/a11ign#4849).
