Closes a11ign/a11ign#5696

Hand-run: the command reads the author's own a11y-witness checkout (`$HOME/repos/a11y-witness`: `packages/`, `node_modules`, `.agent-org/host.json`) and the agent-org tool at `$HOME/repos/agent-org`. The CI runner has none of these, so the acceptance job cannot run it; a human with that layout runs it and the output is pasted under `## Hand-run output` in the PR body.

Acceptance:
```bash
bash -c 'T=$(mktemp -d) && mkdir "$T/packages" && for p in "$HOME"/repos/a11y-witness/packages/*; do [ "$(basename "$p")" = lab ] || ln -s "$p" "$T/packages/"; done \
  && ln -s "$HOME/repos/a11y-witness/node_modules" "$T/node_modules" && ln -s "$HOME/repos/a11y-witness/.agent-org" "$T/.agent-org" && mkdir "$T/packages/lab" \
  && git ls-files -z | xargs -0 cp --parents -t "$T/packages/lab" \
  && cd "$T/packages/lab" && AGENT_ORG_HOST="$HOME/repos/a11y-witness/.agent-org/host.json" AGENT_ORG_TOOL="$HOME/repos/agent-org" node --test src/packaging/row-claim.test.ts'
```

Measured with the tool at `v0.230.0` (`~/repos/agent-org`) on this branch's head: `tests 152, pass 152, fail 0`. Before the change (origin/main `d05b7521`), the nightly `checks (cross-repo)` leg read `tests 152, pass 150, fail 2`: the two named tests.

The command above includes `ln -s "$HOME/repos/a11y-witness/.agent-org" "$T/.agent-org"`. Without that link the file aborts after 97 tests with `ENOENT ... $T/.agent-org/roles/sessions.json`: `row-claim.test.ts:1390` reads `../../../../.agent-org/roles/sessions.json`, and the copy lays no `.agent-org` at the core root. The row's Acceptance carries the same link.
