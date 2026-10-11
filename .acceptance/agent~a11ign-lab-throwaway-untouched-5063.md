Closes: none -- throwaway proof that a change touching none of package.json, pnpm-lock.yaml, .npmrc or .github/workflows/ shows release-dry-run `success` and gate green (a11ign/a11ign#5063, done-when 3); closed unmerged

Acceptance: `grep -q "touches none of the four paths" README.md`
