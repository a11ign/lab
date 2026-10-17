Closes a11ign/a11ign#5696

Acceptance: `cd ~/repos/lab && pnpm exec rstest run --config scripts/rstest/rstest.config.ts src/packaging/row-claim.test.ts`

Run against the tool at `v0.229.1` (`AGENT_ORG_TOOL` at an agent-org checkout at that tag, which is at or above the row's `v0.229.0` floor). Before this change: `VERDICT fail: 2 of 152 tests failed in 1 file`, the two named tests. After: `VERDICT pass: 152 tests in 1 file`.
