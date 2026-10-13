Closes a11ign/a11ign#5403

Acceptance: `bash -c 'test -z "$(grep -n "evaluate-screenreader-acceptance.py\",\"to\":\"packages/scorer/models/screenreader-scorer\"," baselines/layer-edges.baseline.json)" && test "$(grep -c "packages/control/layers.json\"" baselines/layer-edges.baseline.json)" -ge 1 && test "$(grep -c "packages/control/src\"" baselines/layer-edges.baseline.json)" -ge 1'`

The CI acceptance job has no corpus, so `layer-edges.test.ts` cannot run there (its `laidControlFiles` reads the laid core through `dataset-paths.ts`). The command above is the part the job can run: it passes on this branch and fails on origin/main, where the removed entry is still present.

Hand-run: `node --test src/packaging/layer-edges.test.ts` in a laid lab checkout at origin/main, which is the row's own Acceptance. The laid checkout is the core at `CORE_REF` with `packages/lab` copied in and `@a11ign/toolchain` linked, as `.github/workflows/ci.yml` lays it. Result in the engineer's laid core, on this branch's baseline: 35 pass, 0 fail, exit 0. The same layout failed before the edit with the stale `evaluate-screenreader-acceptance.py -> packages/scorer/models/screenreader-scorer` entry reported as STALE, and with two `ci.yml` NEW EDGEs.

Premise dispute, read from the run: the row named only the STALE entry. The test also reported two NEW EDGEs from `packages/lab/.github/workflows/ci.yml` (a11ign/a11ign#5400 made lab's CI lay control over the core's `packages/control` and copy `layers.json` into it). Both are added here with `disposition: checkout-path`, the same disposition as the sibling entry on line 518: `ci.yml -> packages/control/layers.json` and `ci.yml -> packages/control/src`. Each target is named exactly, because the scanner resolves a workflow token to the longest existing prefix in the tree. The reviewer should confirm this disposition over cutting those tokens from `ci.yml`, which is outside this row's Region.

Change: one STALE line removed; two `checkout-path` lines added after the `ci.yml -> packages/control` entry. No other entry moves.

Checked for pins: `src/packaging/lab-extraction.test.ts` reads this baseline (`baselineOf`) and requires more than 400 `checkout-path` edges and more than 500 out-of-lab edges, both of which still hold. Run from the laid core's root, 14 of 14 pass. The row's own test file reads it at 35 of 35. No test or `.acceptance` file pins the removed entry or an exact entry count.

Not run here: lab CI (it lays the core itself), `pnpm run lint`, `pnpm run typecheck`, and the wider lab `pnpm test`. The Acceptance is the single file the row names.
