Closes A11-263 (https://linear.app/a11ign/issue/A11-263/the-fleet-job-service-supports-labs-captures-per-case-bodies-same-box), step 4 of 4. The lab's gates and one-box harnesses submit fleet jobs.

What the change does: `gate:stability` submits ONE job with a group per canary (a canary's repeats are cases of the same page and body, held to one box in order); `gate:probe-order` a group of three per page (A1, B with `probeOrder: "focus-first"`, A2) and submits a page whose captures failed once more, whole, then reports INCONCLUSIVE; `capture:check` (worker mode) six cases with their own bodies and a `fleet job recapture` for an unconfirmed identity, up to four attempts; `training:repeat` one group with a re-capture of a transient fault; `eval:capture`, `identity:rate`, `verdict:stability` and `bench:capture` one group each, in the order the measurement needs. All go through `src/fleet/harness-flow.ts` (`runFleetClient`) on step 3's flow: `--label`, `--boxes`/`--box`, `--wait`, `--collect`, exit 75 with no wait. A box is named, never addressed. `worker-pool.mjs`, `wake-by-hand.mjs` and the gates' `gateWorkers`/`acrossFleet` are removed with their last callers.

Acceptance: lay this repository over the author's a11y-witness checkout the way CI does (packages and `node_modules` linked, the lab copied from `git ls-files`), then run the tests of the clients, their flow and the guards that read them. The clients are driven against a STUBBED `fleet` (a script the tests write and point `FLEET` at): a canary's repeats on one box and the verdict read from the records, a transient repeat captured again alone, a page of three submitted again once then INCONCLUSIVE, an identity re-capture up to four attempts, each one-box harness's group in its order, an address refused naming `--box=`, exit 75 with no wait.

```bash
bash -c 'set -euo pipefail; T=$(mktemp -d); mkdir "$T/packages"; for p in "$HOME"/repos/a11y-witness/packages/*; do [ "$(basename "$p")" = lab ] || ln -s "$p" "$T/packages/"; done
  ln -s "$HOME/repos/a11y-witness/node_modules" "$T/node_modules"; mkdir "$T/packages/lab"; git ls-files -z | xargs -0 cp --parents -t "$T/packages/lab"
  cd "$T" && node --test packages/lab/src/harnesses/fleet-harnesses.test.ts packages/lab/src/gates/fleet.test.ts packages/lab/src/gates/stability-gate-keeps-variants.test.ts \
    packages/lab/src/gates/probe-order-control.test.ts packages/lab/src/gates/probe-order-movers.test.ts packages/lab/src/fleet/fleet-job.test.ts packages/lab/src/fleet/no-wait-in-moved-clients.test.ts \
    packages/lab/src/packaging/worker-url-clients.test.ts packages/lab/src/packaging/worker-code-check-clients.test.ts packages/lab/src/packaging/capture-body-owner.test.ts \
    packages/lab/src/training/budget-ladder.test.ts packages/lab/src/training/pool-invariants.test.ts packages/lab/src/training/stability-fields.test.ts packages/lab/src/training/capture-fleet-job.test.ts'
```

What the block shows: the gates and harnesses ask the service for exactly what the plan says (a group per canary, three bodies in order per page, per-page bodies, `--boxes`/`--label`, one `job wait` per job from one budget), judge from the records the job took, and re-capture only what failed; no moved file contains a wait, a poll, a `pgrep`, a `/capture` POST, `captureTolerantly` or a pool.

**Before merge, the real capture** (quoted in the pull request body): one `training:repeat` group of three on one box through the service, collected with `--collect`.
