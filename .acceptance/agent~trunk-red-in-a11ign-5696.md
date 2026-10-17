Closes: none -- the row lives in a11ign/a11ign and the PR in a11ign/lab

Acceptance:
```bash
T=$(mktemp -d) && mkdir "$T/packages" && for p in "$HOME"/repos/a11y-witness/packages/*; do [ "$(basename "$p")" = lab ] || ln -s "$p" "$T/packages/"; done \
  && ln -s "$HOME/repos/a11y-witness/node_modules" "$T/node_modules" && mkdir "$T/packages/lab" \
  && git ls-files -z | xargs -0 cp --parents -t "$T/packages/lab" \
  && cd "$T/packages/lab" && AGENT_ORG_HOST="$HOME/repos/a11y-witness/.agent-org/host.json" AGENT_ORG_TOOL="$HOME/repos/agent-org" node --test src/packaging/row-claim.test.ts
```

Measured with the tool at `v0.229.2` (`~/repos/agent-org`). Before the change (origin/main `d05b7521`), `tests 152, pass 150, fail 2`: the two named tests. After (this branch), `tests 152, pass 152, fail 0`.

Measured with the command above exactly as written, the file aborts after 97 tests with `ENOENT ... $T/.agent-org/roles/sessions.json`: `row-claim.test.ts:1390` reads `../../../../.agent-org/roles/sessions.json`, and the copy lays no `.agent-org` at the core root. The 152 figures above come from the same command with `ln -s "$HOME/repos/a11y-witness/.agent-org" "$T/.agent-org"` added. The row's Acceptance needs that link to read `fail 0`; see the row for the ruling.
