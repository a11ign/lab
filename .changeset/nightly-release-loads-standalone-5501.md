---
"@a11ign/lab": patch
---

The nightly corpus-release scripts load from the lab's own checkout (a11ign/a11ign#5501). `corpus-release-nightly.ts` and `corpus-release.ts` imported `refuseUnknownFlags` from `@a11ign/screenreader-fleet/cli-flags`, which does not resolve where the unit runs them (no `node_modules`, no `pnpm install`), so the unit's `ExecStartPre` load check failed on every firing. They use `scripts/refuse-unknown-flags.ts`, which carries the one behaviour they need, and a test refuses a package import in either.
