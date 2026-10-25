Closes A11-271

Supersedes Dependabot's #148: `.github/workflows/ci.yml` calls `a11ign/toolchain/.github/workflows/changeset-required.yml` at `eb23973525fd24c019abd8e424f11d4db7310ef1` (was `745b552ed550f44cc15c9d797718d350730540ce`), and nothing else changes. Branched from `main`, so it carries the retirement of `gate:core-held` (A11-170) and `refusalOwners` (A11-127) that #148's stale branch lacked.

Acceptance:

```bash
# the ref is the new one and the old one is gone
grep -qF 'changeset-required.yml@eb23973525fd24c019abd8e424f11d4db7310ef1' .github/workflows/ci.yml
! grep -qF '745b552ed550f44cc15c9d797718d350730540ce' .github/workflows/ci.yml
# the retired refusal and job are not back
! grep -q 'gate:core-held' package.json
! grep -qE '^  refusalOwners:' .github/workflows/ci.yml
# the diff against main is that one line in that one file
test "$(git diff --name-only origin/main...HEAD -- . ':!.acceptance' | tr '\n' ' ')" = ".github/workflows/ci.yml "
test "$(git diff --numstat origin/main...HEAD -- .github/workflows/ci.yml | cut -f1,2)" = "$(printf '1\t1')"
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"
```
