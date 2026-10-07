---
"@a11ign/lab": patch
---

`gate:stability` can start its page server on a host that holds the lab LAID, and a crash of its harness no longer posts as an unstable canary (a11ign/a11ign#3977). The page server ran `pnpm --filter @a11ign/lab exec serve`, which needs `packages/lab` to be a workspace project; on the lab host there is none, so nothing bound :5050 and the gate died after 90 s. It now runs `pnpm exec serve`, and `serve` is declared by the core's root manifest, which is where the lab host's install reads it. A throw out of the gate script is caught and exits 2 (INCONCLUSIVE, `NO VERDICT: gate:stability crashed ...`); Node's own exit 1 for an uncaught throw is the code for "a canary was found UNSTABLE".
