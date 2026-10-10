Closes a11ign/a11ign#4865

`.github/workflows/ci.yml` only: `CORE_REF` moves from `da027c092` to `36c354839ac064126aa92874307558672a69940a` (core #4859), the earliest core commit that holds the core half of a11ign/a11ign#4854's fix (a11ign/a11ign#4857). No test was skipped, loosened or reverted; `src/packaging/ci-composition.test.ts` holds the pin to a 40-hex sha and not to a value, so it did not move.

Acceptance: `bash -c 'P=$(sed -n "s/^ *CORE_REF: \([0-9a-f]*\).*/\1/p" .github/workflows/ci.yml | head -1); gh api "repos/a11ign/a11ign/compare/36c354839ac064126aa92874307558672a69940a...$P" --jq .status | grep -qE "^(identical|ahead)$"'` (run from the lab root; the row's own command reads `main` over `gh api` and cannot pass before the merge).

Hand-run: the row's own command, over `main`'s file, after the merge; its exit code goes on the row.

Red set before: run 38068241483 at `1689b581`, `checks (cross-repo)`: `Test Files 1 failed | 221 passed (222)`, the two `acceptance-reads-the-live-body.test.ts` tests. Red set after: this pull request's own `checks (cross-repo)` log, read at its head (pasted as a comment).
