Closes A11-170

Adds batch 2 of the real-page corpus: `BATCH_2_PAGES` in `src/training/real-page-corpus.mjs`, 120 addresses marked `batch: 2`, none a duplicate of a corpus entry, a moved-from address or an eval TEST fixture. They are drawn by `src/training/real-page-batch.ts` (seed `A11-170`, round-robin over the conformant publishers the corpus already cites) from each publisher's own sitemap, snapshotted in `src/training/real-page-batch-2/pool.json`, and accepted on a recorded plain GET (`probes.json`). They are outside `REAL_PAGES` and carry no `role`, so `capture-real-pages`, `realPageFor` and every scorer reader cannot reach them: no fleet capture exists or can be read before A11-166's freeze.

Acceptance: the batch's own tests (the draw reproduced from its seed over the committed pool and probes, with controls; the rule; the marking; no duplicates; sealed) and the corpus's unchanged tests, then the whole suite and the typecheck.

```bash
pnpm exec rstest run --config scripts/rstest/rstest.config.ts src/training/real-page-batch.test.ts src/training/real-page-corpus.test.ts
pnpm test
pnpm exec tsc -p tsconfig.json --noEmit
node scripts/build-real-page-batch.ts --print | diff - <(sed -n '/^export const BATCH_2_PAGES/,/^\]);/p' src/training/real-page-corpus.mjs | sed '1d;$d')
```

The last line prints the list again from the committed pool and probes, offline, and diffs it against the literal entries: no output means they are identical.
