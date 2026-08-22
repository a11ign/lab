# `@a11y-witness/lab`

**Private, and it stays private.** This is the workshop: the corpus generator, the training pipeline, the
evaluation harnesses and the gates. Nothing here ships to a consumer — what ships is the *output*, which is
the weights in `@a11y-witness/scorer` and the rules in `@a11y-witness/judge`.

It is the only package with no public API, and that is the point. A consumer needs the trained model; they
do not need the machinery that produced it, and coupling them would make every corpus experiment a
breaking change.

## What lives here

| directory | what it is |
|---|---|
| `src/training/` | the corpus. Case definitions, page generation, capture orchestration across the worker pool, the export to training records, and the signal checker |
| `src/eval/` | judge quality against labelled fixtures — the held-out measurement |
| `src/capture/` | host-side capture verification, including the predicates that gate a capture |
| `src/harnesses/` | experiment rigs that are not gates |
| `scripts/` | the long jobs and the audits — training, calibration, benchmarks, and the two shortcut audits |

## The five things you will actually run

```bash
npm run training:generate         # write the corpus pages from the case definitions
npm run training:capture          # drive them through the worker fleet (cached; a full run is ~1,100 pairs)
npm run training:check-signals    # does every case still discriminate its good page from its bad one?
npm run corpus:starvation         # which features will the corpus starve — asked BEFORE a capture run
npm run scorer:shortcuts          # which features did a head penalise for free — asked AFTER training
```

Long jobs do **not** run from a shell. They are named jobs dispatched through Ansible and supervised by
systemd (`npm run lab:job -- -e job=train`), for the reasons in
[ADR 0013](../../docs/adr/0013-lab-job-control.md) — chiefly that the way this project's most expensive
operations were started used to exist nowhere in the source tree.

## The two audits, and why there are two

They ask the same question at different times, and both are needed.

`corpus:starvation` reads the **case definitions**. `scorer:shortcuts` reads the **trained weights**. The
question in both cases is: *is there a feature that no positive of a subtype carries?* If so, a head may
penalise it at no training cost — and no accuracy metric can see that, because every held-out split shares
the corpus's structure.

That is not hypothetical. Measured on the shipped weights: **225 such free vetoes across all 13 heads**, one
of which meant the scorer reported an unnamed control only on pages where *nothing* was correctly named.
[ADR 0015](../../docs/adr/0015-one-defect-per-page-taught-the-scorer-to-veto.md) has the measurement.

The corpus-side audit exists because the weights-side one arrives after a capture run, an export and a
train — too late to be a design tool.

## Rules that cost something to learn

**A check must never reject evidence whose absence is the finding.** Some bad pages announce *nothing*, and
that absence is the failure. Gating on "the probe produced something" threw away exactly those captures.

**Append cases; do not worry about position.** Page furniture used to be keyed on array index, so inserting a
case re-sized every case after it and invalidated their captures silently. It is now keyed on the case ID —
adding 60 cases changed zero existing pages, which is how that fix was verified.

**Acceptance and repeatability runs never cache.** `DATASET_KIND=acceptance` refuses it outright, because
those runs exist to test whether NVDA's output is still stable.

**`npm run eval` cannot run in CI** — it needs the Python venv. Neither can the corpus-dependent tests, which
need `runs/`. Both skip *honestly* rather than passing quietly, because a check that reports success having
examined nothing is how "verified" comes to mean "unexamined".
