Closes a11ign/a11ign#4569

Moves `CORE_REF` in `.github/workflows/ci.yml` from `a7d6a4158` to `f3b5c5f595428bdfd970bd8ab6cf55edc770cf88` (a11ign#4393's last rename commit; `a7d6a4158` is not its ancestor, `f3b5c5f59` is the oldest core commit carrying the renames), with a patch changeset.

Acceptance: `bash -c 'sha=$(grep -E "^  CORE_REF: [0-9a-f]{40}$" .github/workflows/ci.yml | grep -oE "[0-9a-f]{40}") && test -n "$sha" && git -C /home/agent/repos/role-product-manager merge-base --is-ancestor f3b5c5f59 "$sha"'`

Measurement (lab `checks` run id, [36]/[37] pass count, whole-suite red count here vs. at `a7d6a4158`): pending the first CI run on this head; will be filled in below before this leaves draft.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
