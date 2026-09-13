## Before any corpus run: `npm run gate:stability`

Five canary pages, captured repeatedly, compared by CONTENT — it fails closed, and a corpus run must not start until it passes. It exists because Edge's autofill suggestion icon (U+FFFC) once contaminated the corpus for weeks with every count-based check green; suppressed now with command-line flags rather than Edge policies, which had already drifted. [Full incident and the fix →](docs/capture-integrity-plan.md#five-canary-pages-and-the-ufffc-autofill-incident)

A canary that cannot express the fault it's meant to catch proves nothing. Reproduce the fault with your test before trusting its verdict. [Examples →](docs/capture-integrity-plan.md#a-canary-that-cannot-express-the-fault-is-worthless)

A metric computed on data that shares the flaw cannot see the flaw — a feature that's 0 on every positive of a subtype gets a free veto no held-out split can punish. `corpus:starvation` and `scorer:shortcuts` are the two audits. See ADR 0015, [detail](docs/operational-lessons.md#a-metric-computed-on-data-that-shares-the-flaw-cannot-see-the-flaw).

A day was spent chasing false accusations the tool never actually made — five compounding causes, none of them the model. [Postmortem →](docs/operational-lessons.md#the-things-2026-08-24-cost-and-none-of-them-were-the-model)

Eleven false positives on real pages, driven to zero, were all one defect: two things compared that describe different moments or alphabets. [Table →](docs/operational-lessons.md#2026-08-25-eleven-false-positives-on-real-pages-and-they-were-all-one-defect)

Six diagnostics in one evening misreported a working system as broken. When a diagnostic surprises you, suspect the diagnostic before the system. [Table →](docs/operational-lessons.md#a-diagnostic-that-cannot-report-itself-six-times-in-one-evening)

**A check must never reject evidence whose absence is the finding** — a guard once rejected empty probe results as malformed, failing 44 live cases whose absence WAS the finding. [Full incident →](docs/operational-lessons.md#the-rule-that-cost-the-most-to-learn)

`utmctl exec` is known-unreliable on Windows — do not build a diagnosis on it. Everything it would tell you is served over HTTP at `/diagnostics` instead. [Detail →](docs/nvda-worker-runbook.md#diagnosing-a-guest-without-utmctl-exec)

`lab:inventory` answers "what state is the corpus in" — homogeneity, export freshness, model schema, any open migration — and says whether it read a local copy or the authoritative one. [Detail →](docs/lab-cli.md#what-state-is-the-corpus-in-labinventory)
## A GATE THAT READS `runs/` IS NOT YOURS TO REPORT

**Ruled 2026-09-06.** `rules:gate`, `rules:coverage`, `check-signals`, `corpus:starvation`,
`scorer:shortcuts` and anything else reading `runs/` give a VERDICT only when the agent driving the fleet
and the lab runs them — against a corpus just fetched, or on the lab, which owns the authoritative one.

**Anyone else may run one as a PRE-CHECK**, to decide whether a change is worth handing on. **Never as a
reported result**, and never in an acceptance section as though it settled anything.

The reason is measured rather than procedural. `runs/` in any checkout is a copy only as fresh as its last
sync — one measured here was 89 hours old and carried neither `focusEvents` nor `baselineWaitedMs`, so a
sweep across it found zero of the two keys it was written to find. **A gate run there reports cleanly
having examined a corpus that no longer exists.** The pre-push hook does not run them since #911; it
names the lab job answering each, unconditionally.

**So an issue's acceptance may name a `runs/`-reading gate, and must say who runs it.**

> Moved here 2026-09-06 from `docs/backlog-ready.md`, which was retired when the tracker moved to GitHub
> Issues. That page was the only place this ruling existed, so deleting it would have deleted the rule —
> which is why the page was read for what it uniquely held before it was replaced.
