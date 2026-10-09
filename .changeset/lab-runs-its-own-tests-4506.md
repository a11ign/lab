---
"@a11ign/lab": patch
---

The lab runs its own tests: `package.json` gains `"test": "rstest run --config scripts/rstest/rstest.config.ts"`, and `scripts/rstest/rstest.config.ts` is a thin call into `@a11ign/toolchain/rstest-config` over `src/**/*.test.ts`, the same shape as `agent-org`'s. The settings table's `test-runner` cell for this repository no longer reads `DRIFT` on a missing `test` script, and `pnpm exec rstest` no longer prints `Command "rstest" not found` in a lab checkout (a11ign/a11ign#4506). The core's CI keeps running the lab through its own config.
