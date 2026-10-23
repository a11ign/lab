---
"@a11ign/lab": patch
---

Retire the `gate:core-held` refusal (A11-170, A11-127). It named a11ign/a11ign#4425 as the open row that owns whether a release may proceed without the core-held gates; #4425 closed at the ticket-mode cutover, rows now live in Linear and the old org gate that used these refusals is stopped, so no open GitHub row owns it and `refusalOwners` failed every pull request. `gate:core-held` is removed from `package.json` and from the end of `release:gate` and `candidate:gate`; their other stages are unchanged. `refusalOwners` stays: it still fails a future `REFUSED` string that names a closed row, and its live step now prints `LIVE PASS` with the count of owners it read, which may be zero.
