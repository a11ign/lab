The header of `src/packaging/layer-edges-baseline.ts` now says where the question of keeping this repository's baseline is answered: ADR 0045's section "The lab's own baseline of its reaches" in a11ign/a11ign (proposed there as a ledger that only shrinks, for `ceo`'s ruling). The change is in a comment and nothing else.

**Measured:** `git diff -U0 origin/main -- src/packaging/layer-edges-baseline.ts` changes 3 lines, all of them comment lines (` * ...`); no code line is touched.

**Mutation:** not applicable, a comment.

**Not run here:** `layer-edges.test.ts` reads the core's guard from the laid layout, and this checkout has no core beside it, so it cannot run here; CI's cross-repo leg is the real run. The change cannot alter what the module exports, because it adds no code.

Acceptance: bash -c 'git grep -q "ADR 0045" -- src/packaging/layer-edges-baseline.ts && git grep -q "5436" -- src/packaging/layer-edges-baseline.ts'

Closes: none -- the companion to a11ign/a11ign#5436, which closes in the core where the ADR section lives.
