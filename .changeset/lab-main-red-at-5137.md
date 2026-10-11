---
"@a11ign/lab": patch
---

`ready-label-audit.test.ts` answers `fetchReadyRowsWithBodies` with the by-label connection the tool reads since agent-org#5076 (its own `connectionOf` / `readsRowsByLabel` fixture, the one `row-claim.test.ts` takes), not a bare `gh issue list` array, so the two `#2190` tests that went red on `main` at tool `v0.169.2` pass again (a11ign/a11ign#5137).
