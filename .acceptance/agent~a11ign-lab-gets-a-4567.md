Closes a11ign/a11ign#4567

Adds `src/eval/pages/books/filter-status-checkbox-polite.html`: one `<input type="checkbox">` whose `change` handler synchronously rewrites a `<p role="status">` count (the §31 condition: checkbox, synchronous update, `polite`). No timer, no button. The "about 1 time in 3" figure in `docs/known-gaps.md` §31 can now be measured on a page in the tree.

The page is deliberately NOT added to `src/training/case-matrix.mjs`: an intermittent case teaches the model noise (`docs/not-working.md` §18), which is why its two predecessors were withdrawn. The test checks that.

`src/eval/filter-status-checkbox-polite.test.ts` pins the three properties that define the condition. Its positive control runs the same predicate on `filter-status-good.html` (a `<button>`, no checkbox) and requires it to refuse that page. A third test checks the case matrix does not name the page, with a positive control that the matrix is read.

The training capture on this page (`training:repeat --times=20`) is `orchestrator`'s and is filed after this merges. Not run here.

Acceptance: `bash -c 'node --test src/eval/filter-status-checkbox-polite.test.ts' && bash -c '! git grep -q "filter-status-checkbox-polite" -- src/training/case-matrix.mjs'`

Result at this head: `# tests 3`, `# pass 3`, `# fail 0`. Before the page existed the test failed with ENOENT on the page path.

Mutation checks, each restored byte-identical with cp and diff: `setTimeout` added to the script (tests 1 and 2 fail); `<button>` for the checkbox (tests 1 and 2 fail); `role="status"` removed (tests 1 and 2 fail); handler writing another element (tests 1 and 2 fail); page named in `case-matrix.mjs` (test 3 fails).

The changeset is required by CI because the change touches `src/`.

Not checked: the page was not run in a browser (the test reads the file, it does not execute the handler). `pnpm install` was not run in this checkout, so `tsc` and the wider suite were not run; the test imports only `node:test`, `node:fs`, `node:path` and `node:url`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
