Closes a11ign/a11ign#5696

Hand-run: the command reads the author's own a11y-witness checkout (`$HOME/repos/a11y-witness`: `packages/`, `node_modules`, `.agent-org/host.json`) and the agent-org tool at `$HOME/repos/agent-org`. The CI runner has none of these, so the acceptance job cannot run it; a human with that layout runs it and the output is pasted under `## Hand-run output` in the PR body.

Acceptance:
```bash
T=/tmp/row-5696-$$ && mkdir -p "$T/packages" && for p in "$HOME"/repos/a11y-witness/packages/*; do [ "$(basename "$p")" = lab ] || ln -s "$p" "$T/packages/"; done \
  && ln -s "$HOME/repos/a11y-witness/node_modules" "$T/node_modules" && mkdir "$T/packages/lab" \
  && git ls-files -z | xargs -0 cp --parents -t "$T/packages/lab" \
  && cd "$T/packages/lab" && AGENT_ORG_HOST="$HOME/repos/a11y-witness/.agent-org/host.json" AGENT_ORG_TOOL="$HOME/repos/agent-org" node --test src/packaging/row-claim.test.ts
```

Measured with the tool at `v0.229.2` (`~/repos/agent-org`). Before the change (origin/main `d05b7521`), `tests 152, pass 150, fail 2`: the two named tests. After (this branch), `tests 152, pass 152, fail 0`.

Measured with the command above exactly as written, the file aborts after 97 tests with `ENOENT ... $T/.agent-org/roles/sessions.json`: `row-claim.test.ts:1390` reads `../../../../.agent-org/roles/sessions.json`, and the copy lays no `.agent-org` at the core root. The 152 figures above come from the same command with `ln -s "$HOME/repos/a11y-witness/.agent-org" "$T/.agent-org"` added. The row's Acceptance needs that link to read `fail 0`; see the row for the ruling.
