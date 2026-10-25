Refs A11-253

Step 2 of 2 (lab): `.github/dependabot.yml` is now the output of `dependabot-config --write` from `@a11ign/toolchain` 0.11.0 (0.10.2 before), not a hand-written file. Every ecosystem runs weekly on Monday at 05:23 UTC, patch and minor updates share one `<ecosystem>-minor-and-patch` group so a major is its own pull request, and the packages frozen by policy are ignored in the npm entry. The drift check is a step of `.github/workflows/ci.yml` on this checkout, not a test (the tests run laid inside a11ign), and `src/packaging/dependency-updates-configured.test.ts`, which pinned the old file, is deleted with its two layer-edge baseline rows. `@a11ign/control` and `@a11ign/nvda-speech` stay ignored through `.github/dependabot-extra.json`.

Acceptance:

```bash
d=$(mktemp -d) && npm install --no-save --no-package-lock --no-audit --no-fund --prefix "$d" "@a11ign/toolchain@$(jq -r ".devDependencies[\"@a11ign/toolchain\"]" package.json)"
# the committed file is exactly the template's output (exit 1 and a diff on drift)
node "$d/node_modules/@a11ign/toolchain/dist/dependabot-config.mjs" --check --root .
# weekly at one fixed time, one group per ecosystem
test "$(grep -c 'interval: weekly' .github/dependabot.yml)" = 2
test "$(grep -c 'time: "05:23"' .github/dependabot.yml)" = 2
grep -q 'npm-minor-and-patch:' .github/dependabot.yml
grep -q 'github-actions-minor-and-patch:' .github/dependabot.yml
# every package frozen by policy is ignored
for name in @a11ign/screenreader-worker @a11ign/screenreader-fleet @guidepup/guidepup @guidepup/setup; do grep -qF "dependency-name: \"$name\"" .github/dependabot.yml; done
rm -rf "${d:?}"
```
