Closes: none -- throwaway proof that a change touching none of package.json, pnpm-lock.yaml, .npmrc or .github/workflows/ shows release-dry-run `success` and gate green (a11ign/a11ign#5063, done-when 3); closed unmerged

Acceptance: `test -f .acceptance/agent~a11ign-lab-throwaway-untouched-5063.md`
