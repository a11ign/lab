---
"@a11ign/lab": patch
---

The lab's `agent-org-wiring` test no longer reads another repository's tree: copy-drift tests [36] and [37] are deleted, with `KNOWN_UNREADABLE_ORIGINALS`, `declaredCopies`, `withConstLinesBroken` and the `copyDriftReading` / `readDeclaredCopies` import from the tool. They compared the 19 `// COPIED FROM` files in the tool's `src/lib` against the core's CURRENT tree, so their verdict changed with no change to the lab (lab#48's same head passed at 13:47Z and failed at 15:08Z). The copies are deleted in agent-org (row 5 of a11ign/a11ign#4425 phase 3), and agent-org's own tests own its tree (a11ign/a11ign#4588).
