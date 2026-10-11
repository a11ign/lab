Row a11ign/a11ign#5137. Region is `lab:src/packaging/ready-label-audit.test.ts`; the diff is that file plus this record and a changeset. No `fleet:*`, `lab:*`, `worker:*`, capture or `runs/`-reading command was run (resource ban).

Acceptance:

```bash
bash -c 'grep -q "rows-by-label-fixtures" src/packaging/ready-label-audit.test.ts && grep -q "connectionOf(rows)" src/packaging/ready-label-audit.test.ts && ! grep -q "return JSON.stringify(\[{ number: 7" src/packaging/ready-label-audit.test.ts'
```

A structural check over this branch's file (run from the lab root), because the row's own command reads `main`'s newest run and cannot pass before the merge. **The row's own command is run by the host after the merge**, and its exit code goes on the row:

```bash
bash -c 'for id in $(gh run list --repo a11ign/lab --branch main --limit 3 --json databaseId --jq ".[].databaseId"); do gh run view "$id" --repo a11ign/lab --json jobs --jq ".jobs[]|select(.name==\"checks (cross-repo)\")|.conclusion"; done | head -n 1 | grep -qx success && echo OK'
```

## What changed

`src/packaging/ready-label-audit.test.ts`, the two `#2190` tests of `fetchReadyRowsWithBodies`. They stubbed `run` with a bare JSON list, the shape of `gh issue list --label ready --json ...`. Since agent-org commit `5376a23f` (agent-org#5076, in `v0.169.2`) the reader lists open rows through `readRowsByLabel`, a GraphQL connection read over `gh api graphql`, and refuses a list with "did not come back as a connection: no `data`". The stub now answers through the tool's own fixture (`connectionOf`, `readsRowsByLabel`, `selectedFieldsOf` from `src/packaging/rows-by-label-fixtures.ts`), and the old assertions on `--label`/`--state`/`--json` become their connection equivalents: the read is `{ label: "ready", state: "OPEN" }`, no `--label` or `--search` is in the argv, and `body` is in the selection. The negative test keeps its three refusals and gains a control: no ready row is the empty list, not a refusal.

## Evidence (measured 2026-10-11, in a CI-shaped layout: this lab laid at `packages/lab` of a core worktree, `rstest run --config scripts/rstest/rstest.config.ts`)

| Run | Tool | Test file | Result |
| --- | --- | --- | --- |
| before | `v0.170.0` (host checkout) | `origin/main`'s | `VERDICT fail: 2 of 182`, the two `#2190` tests, message `did not come back as a connection: no data` (the CI log's message) |
| after | `v0.170.0` | this branch's | `VERDICT pass: 182 tests in 1 file` |
| after | `v0.169.2` (`git archive` of the tag, the tag the red run printed) | this branch's | `VERDICT pass: 182 tests in 1 file` |

`eslint --no-ignore` on the file: 0 errors (warnings are `no-magic-numbers`, as before). `tsc -p packages/lab/tsconfig.json --noEmit`: no line naming the file.

## Mutation (each restored from a `cp` copy and `diff`ed byte-identical)

| Mutation | Tests that fail |
| --- | --- |
| the tool's `select` loses `body` (v0.169.2 copy) | exactly 1: the first `#2190` test, on "the body is in the selection" |
| the test's fake answers the bare list again (`JSON.stringify(rows)`) | exactly 2: both `#2190` tests, with the refusal this row names |

## Not established

- **No live reading of `checks (cross-repo)`.** That leg's verdict on this pull request's merge is the row's done-when 2, read by the host's command above.
- **The previous green run's tag (`db158d8d`) was not read**; the row calls that inference. The before/after above does not depend on it.
- Other lab tests that stub a list for a reader the tool moved to connections (agent-org#5076 says twelve readers moved) are not covered by this diff; the cross-repo leg read `2 failed | 2936 passed`, so none is red today.

Closes a11ign/a11ign#5137
