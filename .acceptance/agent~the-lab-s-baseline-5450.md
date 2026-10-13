Closes a11ign/a11ign#5450

Parent: a11ign/a11ign#5436

Acceptance: `bash -c 'head -40 src/packaging/layer-edges-baseline.ts | grep -q "own baseline of its reaches"'`

The header of the lab's baseline cites ADR 0045's addendum by section name: the ruling is KEEP (ceo, a11ign/a11ign#5436). The change is comment-only, so the grep above is its check. `layer-edges.test.ts` is not run here: it needs a laid core checkout, and the CI acceptance job has no corpus.
