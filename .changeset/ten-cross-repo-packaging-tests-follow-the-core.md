---
"@a11ign/lab": patch
---

Nine packaging tests that read the core's workflows, units and hooks follow the core as it stands at `c18c2dab7` and the tool's newest tag, and one is retired. `ci-health`, `weekly-review`, `manifest-repository-check` and `consumer-gate` accept the core's steps as bare `node scripts/<name>.ts` (they were pinned to `node --import tsx`); `workflow-commands` and `workflow-filters` scan `.ts` programs as well as `.mjs`; `test-memory-cap` accepts the toolchain's `test-memory-cap.mjs` in the pre-push hook; `agent-org-wiring` picks the watcher unit's `ExecStart` by its npm script rather than its `ExecStartPre`; `regression-board-unit` follows the unit to `%h/.local/bin/node` and `src/bin.ts`. `work-gate.test.ts` is deleted: it was a stale copy of the tool's own `src/packaging/work-gate.test.ts`, which already classifies `ready-rows-untiered`, and its three edges are removed from `baselines/layer-edges.baseline.json`.
