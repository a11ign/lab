---
"@a11ign/lab": patch
---

`gate:core-held` names an open row, and a refusal that names a closed one fails the lab's CI. The text said "whether a release may proceed without them is a11ign/a11ign#5179", and #5179 closed on 2026-10-12 after fixing a different gate; it now says "the open row that owns whether a release may proceed without them is a11ign/a11ign#4425", the row the core's `gate:lab-held` names for the same question. `scripts/refusal-owners-are-open.ts` (the core's reader from a11ign/a11ign#5333, copied: it is not published and ADR 0045 forbids a reach into the core's tree) reads every owner a `REFUSED` string in `package.json` names, a qualified `a11ign/a11ign#n` in its own repository, and `ci.yml`'s new `refusalOwners` job asks GitHub whether each is open; `gate` needs it, so it blocks (a11ign/a11ign#5351).
