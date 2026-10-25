# Autonomous screen-reader dataset pipeline

This pipeline creates controlled good/bad page pairs, captures both through
the real NVDA worker, and exports JSONL whose model input contains only
screen-reader evidence. It does not ask a person to write labels or copy HTML
into the dataset.

The cases are small, deterministic instruments based on the accessibility
topics in the repository's bookctx references and existing evaluation
fixtures. A pair is exported only when the expected bad signal is observable
in the bad NVDA capture and absent from the good capture. This prevents a
known HTML mutation from being treated as evidence when NVDA did not actually
announce it.

The matrix is **1,715 cases** (`screenreader-dataset/manifest.json` -> `cases`, read
2026-09-23T14:26Z on the lab `a11y-lab`, `/srv/a11y-runs`, which owns the authoritative
corpus), across image, link, heading, landmark, form, control, dynamic-feedback and
table families. The per-family breakdown that used to stand here is
gone rather than retyped: it was arithmetic over a total that has since doubled, and
the manifest it would have to be re-derived from is the single source anyway. Copy a
figure out of it and write the date you read it beside the number (#2155). The
exporter deliberately excludes the
observable `1.3.1:missing-landmark` pairs from the local scorer: the expected
landmark is a structural expectation, not a reliably inferable screen-reader
announcement. Those cases remain available to the signal/static layer.
Family metadata is preserved in the manifest and provenance so train/test
splits can keep near-duplicate mutations together.

## Run the pipeline

Generate the pages and manifest on the control machine:

~~~sh
pnpm run training:generate
~~~

Run the worker-free instrument and manifest audit:

~~~sh
pnpm run training:preflight
~~~

The capture command leases the generated page server for the duration of the
run. Do not start `pnpm dlx serve` by hand; this avoids leaked servers and a stray
server serving the wrong directory.

The boxes that take the captures are booked by the **fleet job service** on the control plane
(control `docs/fleet-jobs.md`), and `training:capture` is a client of it: it does not drive a
worker. It submits the cases as one job, records the job ID, and writes the corpus from the
job's manifest when the job is done. A box does one capture at a time, so two agents' jobs
never run on one box at once; a job that cannot get its boxes waits in the queue.

~~~sh
DATASET_BASE_URL=http://control-host:5050 \
pnpm run training:capture --label=A11-263 --boxes=3 --wait=4h
~~~

- `--label=<ticket key>` (or `A11Y_FLEET_LABEL`) books the job under the ticket it is for, and is
  required: a call without one is refused before anything is sent.
- `--boxes=<n|ready|name,name>` (or `A11Y_FLEET_BOXES`) is how many boxes, every ready one, or these by
  name. With none it is `ready`.
- `--wait=<duration>` (or `A11Y_FLEET_WAIT`) is the longest this process waits, as `fleet job wait`
  does, once: `90s`, `30m`, `2h`, at most 24h. The job outlives the wait. With a wait the run
  submits, waits, collects, and re-captures what the evidence check rejected, all inside that
  one budget.
- **With no wait the command prints the job ID and the command that collects it, and exits 75.** A
  pipeline that forgot to say how long to wait stops there and does not export a corpus it has
  not collected. An agent declares the wait instead (`waitingOn: [{ "fleetJob": "<id>" }]`), ends
  its turn, and is woken when the job ends; then:

~~~sh
pnpm run training:capture -- --collect            # the newest job not yet collected
pnpm run training:capture -- --collect=<job ID>   # a named one
~~~

A pair's good and bad variants are one **group** of the job, and the service holds a group to ONE
box and captures it in order: the comparison is only meaningful if both came from one screen
reader on one machine. That rule is the service's now, and it holds across a re-capture: a
variant the evidence check rejects is captured again by `fleet job recapture`, on the box its
group was captured on, up to three attempts, and a rejected attempt is kept under
`captures/rejected/`.

The pages are fetched by the boxes from **this host**, so it serves them for as long as the job
runs, and `DATASET_BASE_URL` (or `localhost` rewritten to this host's address on the control
plane's subnet) is the URL they use. A `training:capture` that exits 75 stops the page server
it started; run with a wait, or serve the pages from a server that stays up.

A job that FAILS or is cancelled still holds the captures that landed before it ended, and
`--collect` (or the run, if it was waiting) keeps them: each variant that landed is written, each
that never ran is a failure saying "the job ended before this was captured", and the command stops
with the job's own exit code. A box that leaves the fleet mid-job takes its unsent cases with it; a
dataset case is then submitted again whole, once, and a real page once, and a second loss fails it.
`DATASET_CAPTURE_TIMEOUT_MS`, `DATASET_WORKER_WAIT_MS` and `A11Y_VM_AFTER` do nothing on the fleet
route, and a run that sets one says so (the local VM route reads the first and the last).

A worker address (`--worker=`, `A11Y_WORKER`, `A11Y_WORKERS`) is not taken any more: it is
ignored with one line when `A11Y_FLEET_BOXES` is set, and refused, naming the new form, when it
is not.

**On a Mac with a local UTM worker VM, name no fleet input** (no `--label`, `--boxes`, `--wait`,
`--collect`, none of `A11Y_FLEET_*`) and the capture step drives your own VM(s) as it always did
(`capture-local-vm.ts`): it starts them on demand, works out the address the guest can use to reach
this host, shares the cases between them, and puts each VM back in the state it found it (see
docs/local-worker-vm.md). A local VM is not a fleet box and has nothing to book; the fleet route
never reaches it, and it never reaches a fleet box.

~~~sh
pnpm run training:capture
~~~

`DATASET_BASE_URL` still wins if you set it, and a `localhost` value is rewritten to the host's
address on the VM's subnet, because `localhost` inside the guest is the guest.

A full matrix run is two NVDA captures per case -- **3,430** at the manifest's
1,715 cases, read 2026-09-23T14:26Z. The disk carries more, **4,500 captures**, because
612 of its 2,327 page dirs are not in the manifest: a recapture prices off the manifest
and a cache invalidation prices off the disk, and they are not the same number. Either
way it publishes its state instead of expecting you to watch a log:

~~~sh
pnpm run training:status
~~~

~~~
run:      started 2026-10-25T08:20:19.822Z
progress: 1,061/1,061 cases  (1,061 captured, 0 failed, 0 skipped)
boxes:    a11y-worker-1, a11y-worker-2, a11y-worker-3
job:      fj-20261025T082019Z-3a9c1e (dataset, submitted 2026-10-25T08:20:19.822Z)  ->  fleet job status fj-20261025T082019Z-3a9c1e
pages:    http://control-host:5050
current:  finished
last update: recently
~~~

Those totals are an example of the SHAPE of the output, not today's corpus. Read the count off
`training:status` or the manifest, never off this page. The status reads the progress file once and
names the job ID; it sends nothing to a box, because the run names no worker, and a quiet file is
not a wedged run (`fleet job status <id>` is the authority).

The **cache** is the service's `skipWhen`: a case whose pair on disk still matches the page, the
options and the protocol is submitted with the environment that pair was taken under, and the
service leaves the group alone on a box that reads the same. Such a case is reported
`cached: unchanged`, as before, and no capture is spent on it. `--no-cache` sends no `skipWhen`.

Do not poll it in a loop, and do not hold a wait in a shell. `pnpm run training:wait` waits on
nothing: it prints the same status, and for a run still going it prints the line to declare:

~~~sh
pnpm run training:wait             # exits 0 finished clean or still going, 1 failures, 2 no run, 3 wedged
pnpm run training:wait --json      # plus next_command, and `declare` for a run still going
~~~

Exit codes: 0 healthy or finished clean, 1 finished with failures, 2 no run recorded, 3 wedged (a
progress file from before the service, quiet for longer than one capture timeout plus slack). The
retry for failed cases is a new submission of them (`--only=<ids> --no-cache --label=...`); a
case whose capture was merely rejected has already been re-captured up to its limit.

`--resume` still skips a case only when the previous run recorded it captured, both files are
still on disk, and their recorded page identity matches the current bytes. Legacy
captures without `pageHash` are checked by recomputing their stored cache key; captures
without sufficient provenance are recaptured, so `--resume --no-cache` stays safe
after a fixture edit rather than silently trusting old evidence.

Before exporting, prove the labels can actually tell the pairs apart:

~~~sh
pnpm run training:check-signals
~~~

It runs each case's `badSignal` against the captures on disk and asserts it fires on
the bad page and stays silent on the good one, reporting BLIND (never fired) and
CONTAMINATED (fired on good) separately, since they need different fixes. It needs no
worker, so it is cheap to run after any change to a probe's output shape -- a probe and
its signal are coupled, and the first full run lost 8 cases to signals that silently
stopped matching when a probe changed. Exit codes: 0 all discriminating, 1 otherwise.

Two further checks guard the data, both learned the hard way. Before capturing, the
pages must actually answer on the base URL; and each capture must mention a
significant word from the page's own `<title>` or it is rejected rather than
written. Without the second, a stray server holding port 5050 produced
`Capture complete: 3/3 cases` while every transcript read `Error code: 404` --
mislabelled training data that looks entirely plausible downstream.

The worker reuses NVDA by default and recycles it periodically for throughput. A request that
finishes with no verified document speech never preserves that NVDA instance, so one transient
blank capture cannot poison the next retry. For a deliberately fresh lifecycle on every
capture -- useful for a small repeatability probe, not the fast training path -- send the
setting to the worker through the capture client:

~~~sh
DATASET_REUSE_NVDA=0 pnpm run training:capture --only=one-case-id
~~~

`A11Y_REUSE_NVDA=0` on the host is not equivalent: NVDA runs in the Windows worker process,
so a host-only environment variable cannot change its lifecycle. The read anchor also falls
back to NVDA's explicit read-current-line command when the virtual cursor has named the
document but has not exposed its first item yet.

Each worker serializes its own NVDA resource; the local pool runs one case per
worker concurrently. The capture step writes raw captures under
runs/screenreader-dataset/captures/. A failed case does not discard completed
captures.

Finally export the model dataset:

~~~sh
pnpm run training:export
~~~

Export also verifies that both captures still match the current page bytes and
capture provenance. A fixture edit, worker/protocol change, or missing identity
skips the pair instead of turning stale evidence into a training label; recapture
first when the export reports stale pairs.

The trained artifact is consumed through a verified score-only boundary. It
checks the safetensors metadata and the frozen encoder hash before inference:

~~~sh
pnpm run training:score --data runs/screenreader-dataset/screenreader-evidence.jsonl
pnpm run training:shadow --data runs/screenreader-acceptance/screenreader-evidence.jsonl
pnpm run training:hardening
~~~

For a live witness capture, `A11Y_SHADOW_MODEL=1 pnpm run witness <url>
--task "..."` runs the local scorer beside the existing judge. The result is
logged only; it does not change findings or bypass deterministic rules.

The worker stamps capture provenance from its installed runtime into each row:
NVDA, Edge, guidepup, Node, Windows, and the deployed worker-code hash. These
fields are not model input. Version environment variables are deliberately not
used, because a manual declaration can silently become stale after a guest
update. The hardening report flags older captures without exact version
metadata so a candidate cannot be mistaken for cross-version validated.

The scorer gives explicit screen-reader relations extra representation strength:
vague link names (2x), unnamed form fields (3x), generic heading names (2x),
and named-field counterevidence (2x). Table cases also contribute the opt-in
table-cell-navigation announcements, with associated versus position-only
cells represented as screen-reader-derived features. These are still model
features derived only from NVDA evidence, not HTML or DOM facts.

Calibration failures are written alongside the normal held-out error report;
the report includes the exact NVDA-only evidence for every grouped out-of-fold
false positive and false negative. The new acceptance set is separate from the
training manifest and is evaluated only after capture:

~~~sh
pnpm run training:generate-acceptance
pnpm run training:preflight-acceptance
pnpm run training:evaluate-acceptance \
  --data runs/screenreader-acceptance/screenreader-evidence.jsonl \
  --data runs/screenreader-acceptance/repeat-1.jsonl \
  --data runs/screenreader-acceptance/repeat-2.jsonl
~~~

The acceptance evaluator requires disjoint case families, minimum per-criterion
coverage, zero acceptance false positives and false negatives, and repeated
capture stability for criteria owned by the learned scorer. Criteria owned by
the deterministic rule layer are reported but are not scored as model failures.
It never fits the model or thresholds.

The JSONL output is
runs/screenreader-dataset/screenreader-evidence.jsonl. Each row has an input
made from screenReader, transcript, structure, interaction, and derived
evidence units. URL, task, HTML, DOM, CSS, axe findings, and diagnostics are
deliberately excluded from input. The provenance object is for auditing and
reproducibility, not model features.

The preflight report is runs/screenreader-dataset/preflight.json. A successful
preflight means the instruments are ready for NVDA; it does not count as a
captured training example.

Use pnpm run training:capture --only=filter-status to recapture a subset.
The generated run directory is ignored by Git; source cases and the pipeline
remain reviewable in this directory.

## What cannot run on this Mac

The generator and exporter run locally, but NVDA capture requires the
interactive Windows desktop documented in src/capture/nvda/README.md -- either
a remote worker or the local UTM VM (docs/local-worker-vm.md), which this Mac
can host. With neither available, the capture command stops instead of
fabricating transcripts. Once the worker is reachable, the complete collection and label
validation process is unattended.
