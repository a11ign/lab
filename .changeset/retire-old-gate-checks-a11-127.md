---
"@a11ign/lab": patch
---

Retire the old gate's checks that kept `gate` red (A11-127). `refusalOwners` is removed from `ci.yml`, from `gate`'s `needs` and from `gate`'s result checks, and its test `refusal-owners-are-open.test.ts` is deleted: it asked GitHub whether the row a `REFUSED` string names is open, rows now live in Linear and every GitHub copy is closed, so it could only fail. The arm bot's exit from the cross-repo refusal changes with it: a `Cross-repo-red:` line now names the ticket that greens the leg (`A11-123`), read by its shape with no tracker read, where it named an open GitHub row (`#n`, `owner/repo#n`), which no longer exist. The refusal itself stays: a pull request that newly reds `checks (cross-repo)` is still not armed without the line.
