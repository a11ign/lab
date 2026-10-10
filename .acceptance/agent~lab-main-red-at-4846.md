Closes a11ign/a11ign#4846

Acceptance: `bash -c 'grep -E "^  /\^packages" src/packaging/agent-org-standalone-adr.test.ts | grep -qE "[(|]work-gate[|)]"'` (run from the lab root, no token and no core layout needed): exits 0 at this head and 1 at `origin/main` `46eddbf7`, where no reservation line names `work-gate`. It is a STATIC reading of the file; the row's own command reads lab `main` over the API and is hand-run AFTER the merge.

## What changes

`RESERVED_BY_A_ROW` in `src/packaging/agent-org-standalone-adr.test.ts` gains one line reserving `packages/lab/src/packaging/work-gate.test.ts`, which lab#69 (a11ign#4838) deleted. Listed by name, so a misspelt path is still refused. The ADR is untouched, no test is skipped and the file is not restored.

## Evidence (measured)

- lab#69's diff deletes exactly one test file, `src/packaging/work-gate.test.ts` (`git diff --name-status`), so no other retired file needs a reservation. ADR 0040 names it once as a Region path (core `docs/adr/0040-*.md` line 1718).
- The new pattern matches that path (`grep -E` on the literal path prints it).
- NOT measured: the rstest run of this file in a core layout. It needs the core checkout with the lab laid at `packages/lab`, which the cross-repo leg of this PR's CI does; the Done-when's "no `✗` line" is read from that leg.
