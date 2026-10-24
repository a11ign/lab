Closes A11-180

Retires lab's `checks (cross-repo)` leg and what read it. `ci.yml` has one `checks` job (no matrix, no `continue-on-error`, no agent-org clone), and `gate` still needs it. The tests that loaded agent-org's internal modules are deleted, not ported: 22 whole files, and the cases in 9 more that read agent-org (the pull request body lists each). `scripts/cross-repo-tests.ts` and its test are deleted. `auto-arm.yml` is kept, because it still arms lab pull requests (lab#141, armed by `octo-sts[bot]` on 2026-10-23), and loses the cross-repo refusal and the `Cross-repo-red:` exit, so a pull request is armed with no row and no ticket key. `auto-arm.sts.yaml` drops `actions: read`.

Acceptance: the removed leg, selector, refusal and grant are gone from the tree, no test loads the tool, and the composition tests that pin this pass.

```bash
set -e
# each `[ -z "$(grep ...)" ]` fails when grep finds anything; a bare `! grep` would not stop `set -e`
[ -z "$(grep -nE 'matrix\.scope|cross-repo|agent-org-newest-tag|AGENT_ORG_TOOL' .github/workflows/ci.yml)" ]
[ -z "$(grep -nE 'CROSS_REPO|cross_repo|Cross-repo-red' .github/workflows/auto-arm.yml)" ]
[ -z "$(grep -n 'actions: read' .github/chainguard/auto-arm.sts.yaml)" ]
test ! -e scripts/cross-repo-tests.ts
[ -z "$(grep -rlE '\b(toolModule|toolPath|toolUrl|toolRoot|toolExportPath)\(' --include='*.test.ts' src scripts tests)" ]
test "$(grep -l tool-source scripts/*.ts | sort | tr '\n' ' ')" = "scripts/collect-promotion.ts scripts/tool-source.ts "
```
