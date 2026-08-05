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

The current matrix contains 1,061 pairs across image, link, heading, landmark,
form, control, dynamic-feedback, and table families: 45 seed pairs, 128
initial independent variants, 627 bulk variants, 36 targeted follow-ups, and
225 targeted calibration variants. The exporter deliberately excludes the
observable `1.3.1:missing-landmark` pairs from the local scorer: the expected
landmark is a structural expectation, not a reliably inferable screen-reader
announcement. Those cases remain available to the signal/static layer.
Family metadata is preserved in the manifest and provenance so train/test
splits can keep near-duplicate mutations together.

## Run the pipeline

Generate the pages and manifest on the control machine:

~~~sh
npm run training:generate
~~~

Run the worker-free instrument and manifest audit:

~~~sh
npm run training:preflight
~~~

The capture command leases the generated page server for the duration of the
run. Do not start `npx serve` by hand; this avoids leaked servers and a stray
server serving the wrong directory.

In the interactive Windows session that owns NVDA, start the existing worker:

~~~powershell
$env:A11Y_PORT = "8765"
npm run worker
~~~

Then run the capture step from the control machine, with the worker reachable
over the network:

~~~sh
A11Y_WORKER=http://windows-host:8765 \
DATASET_BASE_URL=http://control-host:5050 \
npm run training:capture
~~~

On a Mac with the local UTM worker VM, set neither. The capture step starts the
VM on demand, works out the address the guest can use to reach this host, and
puts the VM back in the state it found it (see docs/local-worker-vm.md):

~~~sh
npm run training:capture
~~~

DATASET_BASE_URL still wins if you set it, but a `localhost` value is rewritten
to the host's address on the VM's subnet, because `localhost` inside the guest
is the guest.

A full matrix run is ~2122 NVDA captures, so it publishes its state instead
of expecting you to watch a log:

~~~sh
npm run training:status
~~~

~~~
run:      started 2026-07-26T08:20:19.822Z
progress: 1,061/1,061 cases  (1,061 captured, 0 failed, 0 skipped)
worker:   http://REDACTED-INTERNAL-ADDRESS:8765
pages:    http://REDACTED-INTERNAL-ADDRESS:5050
current:  finished
last update: recently
worker now: idle
~~~

Run across several workers to cut wall-clock, and **set nothing to get it**: with neither
`A11Y_WORKER` nor `A11Y_WORKERS` set, the run discovers every local worker VM, starts what is
stopped, spreads cases across them, and puts each back as it found it afterwards -- so an
overnight run does not leave three Windows guests burning resources. A VM you had already
started is left running, and one busy with another capture is never stopped underneath it.

Measured on 10 mixed cases: 318s on one
worker, 167s on two -- **1.90x**, with only 5% per-case degradation and byte-identical
evidence:

~~~sh
# every a11y-worker* VM, started and reported as JSON
./scripts/local-worker/worker-ctl.sh pool-up

A11Y_WORKERS=http://REDACTED-INTERNAL-ADDRESS:8765,http://REDACTED-INTERNAL-ADDRESS:8765 npm run training:capture
~~~

Add a worker with `./scripts/local-worker/clone-worker.sh` (it handles the duplicate-MAC
trap that `utmctl clone` leaves behind), and release them by hand with
`./scripts/local-worker/worker-ctl.sh pool-stop` if you ever need to. A pair's good and bad variants always run on the
SAME worker: the comparison is only meaningful if both came from one screen reader on one
machine.

Do not poll it in a loop. To block until a run finishes:

~~~sh
npm run training:wait              # exits 0 clean, 1 failures, 2 no run, 3 wedged
npm run training:wait -- --json    # plus next_command
~~~

It reads `runs/screenreader-dataset/capture-progress.json`, which the run rewrites
atomically after every step, and separately asks the worker whether it is still
capturing -- so "finished", "working" and "wedged" are distinguishable rather than
inferred from silence. Exit codes: 0 healthy or finished clean, 1 finished with
failures, 2 no run recorded, 3 wedged (no update within one capture timeout plus
slack). A wedged or interrupted run does not have to start over:

~~~sh
npm run training:capture -- --resume --no-cache
~~~

Resume skips a case only when the previous run recorded it captured, both files are
still on disk, and their recorded page identity matches the current bytes. Legacy
captures without `pageHash` are checked by recomputing their stored cache key; captures
without sufficient provenance are recaptured. This keeps `--resume --no-cache` safe
after a fixture edit rather than silently trusting old evidence.

Before exporting, prove the labels can actually tell the pairs apart:

~~~sh
npm run training:check-signals
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
DATASET_REUSE_NVDA=0 npm run training:capture -- --only=one-case-id
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
npm run training:export
~~~

Export also verifies that both captures still match the current page bytes and
capture provenance. A fixture edit, worker/protocol change, or missing identity
skips the pair instead of turning stale evidence into a training label; recapture
first when the export reports stale pairs.

The trained artifact is consumed through a verified score-only boundary. It
checks the safetensors metadata and the frozen encoder hash before inference:

~~~sh
npm run training:score -- --data runs/screenreader-dataset/screenreader-evidence.jsonl
npm run training:shadow -- --data runs/screenreader-acceptance/screenreader-evidence.jsonl
npm run training:hardening
~~~

For a live witness capture, `A11Y_SHADOW_MODEL=1 npm run witness -- <url>
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
npm run training:generate-acceptance
npm run training:preflight-acceptance
npm run training:evaluate-acceptance -- \
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

Use npm run training:capture -- --only=filter-status to recapture a subset.
The generated run directory is ignored by Git; source cases and the pipeline
remain reviewable in this directory.

## What cannot run on this Mac

The generator and exporter run locally, but NVDA capture requires the
interactive Windows desktop documented in src/capture/nvda/README.md -- either
a remote worker or the local UTM VM (docs/local-worker-vm.md), which this Mac
can host. With neither available, the capture command stops instead of
fabricating transcripts. Once the worker is reachable, the complete collection and label
validation process is unattended.
