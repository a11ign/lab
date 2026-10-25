Refs A11-263 (https://linear.app/a11ign/issue/A11-263/the-fleet-job-service-supports-labs-captures-per-case-bodies-same-box), step 3 of 4. The lab's corpus clients submit fleet jobs and collect from the manifest.

What the change does: `src/fleet/fleet-job.ts` is the lab's one client of the `fleet` command, and `src/fleet/capture-flow.ts` is the flow every moved client follows (submit, record the ID, wait once or exit 75, collect, re-capture). `training:capture` (and `-acceptance`), `capture-real-pages.mjs` and `evidence:check` submit cases to the service and write their outputs, in the same names and shapes, from the job's manifest. A dataset case is a good and a bad service case in ONE group (one box, in order); a variant the evidence check rejects, or whose capture the worker lost, is a `fleet job recapture` on that box, up to three attempts; the cache is the service's `skipWhen`; real pages are grouped by publisher. `training:status` and `training:wait` name the job and send nothing to a box; `training:wait` waits on nothing. A run that names no fleet input still drives a person's own local UTM worker VM(s), in `capture-local-vm.ts` (the plan's "the local UTM VM pool … stay").

Acceptance: lay this repository over the author's a11y-witness checkout the way CI does (packages and `node_modules` linked, the lab copied from `git ls-files`), then run the tests of the moved clients, their flow and the guards that read them. The clients are driven against a STUBBED `fleet` (a script the tests write and point `FLEET` at): a pair on one box, per-case bodies, a re-capture after a rejected variant, a third rejection failing the case, a lost capture re-captured, a box that left submitted again once, a cached group, a stale-worker refusal, the local VM route (which runs take it, the evidence check's three attempts, a pair on one VM), exit 75 with no wait and `--collect`, one wait budget, and the real-page records and the evidence-check report.

```bash
bash -c 'set -euo pipefail; T=$(mktemp -d); mkdir "$T/packages"; for p in "$HOME"/repos/a11y-witness/packages/*; do [ "$(basename "$p")" = lab ] || ln -s "$p" "$T/packages/"; done
  ln -s "$HOME/repos/a11y-witness/node_modules" "$T/node_modules"; mkdir "$T/packages/lab"; git ls-files -z | xargs -0 cp --parents -t "$T/packages/lab"
  cd "$T" && node --test packages/lab/src/fleet/fleet-job.test.ts packages/lab/src/fleet/no-wait-in-moved-clients.test.ts packages/lab/src/training/capture-fleet-job.test.ts \
    packages/lab/src/training/capture-progress.test.ts packages/lab/src/training/wait-for-capture.test.ts packages/lab/src/training/capture-status.test.ts \
    packages/lab/src/training/capture-cache.test.ts packages/lab/src/training/capture-fleet-guard.test.ts packages/lab/src/training/evidence-check-aim.test.ts \
    packages/lab/src/training/pool-invariants.test.ts packages/lab/src/training/capture-local-vm.test.ts'
```

Measured on this branch's head: `tests 135, pass 135, fail 0`.

**What the block shows:** the client asks the service for exactly what the plan says (a group of good and bad per case, each with its own body, `--boxes`, `--label`, one `job wait` per job from one budget), writes the corpus files and provenance from the manifest, and re-captures only the rejected variant through `job recapture`; no moved file contains a wait, a poll, a `pgrep`, a `/capture` POST, `captureTolerantly` or a pool.

**Before merge, the real capture** (done from the author's session, quoted in the pull request body): one case through the live service, `--boxes=1`, collected with `--collect`.
