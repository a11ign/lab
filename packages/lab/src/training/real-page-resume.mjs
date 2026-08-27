// @ts-check
/**
 * Which real pages a `--resume` may SKIP, and how old the evidence it is reusing is.
 *
 * ## Why real-page resume is a different question from dataset resume
 *
 * The dataset capture resumes against a page hash: the fixture is ours, so "has this page changed" has an
 * exact answer. A real page has no such answer. `capture-real-pages.mjs` says why it never caches:
 *
 * > A cache hit here would silently pair today's claim against yesterday's page.
 *
 * So resume here cannot mean "this URL was captured once". It has to mean **captured recently enough that
 * the run is still one measurement** — otherwise a corpus scored as a unit is half from Tuesday, and the
 * conformance claim it is compared against was made about neither moment.
 *
 * ## Why it needs to exist anyway
 *
 * 50 calibration pages at ~191 s each is ~32 minutes across five workers, and a kill loses all of it. The
 * SRE Workbook names checkpointing as the pattern for exactly this: *"pipelines that are terminated early
 * will lose their state, requiring the entire pipeline to be executed again."*
 *
 * ## The shape of the answer
 *
 * A window, not a flag. Inside it, a capture is part of this measurement and is reused; outside it, the
 * page is captured again — and the run SAYS how much it skipped and how old the oldest reuse was, because
 * "resumed 47 pages" and "resumed 47 pages, oldest 4 minutes" are different claims and only the second
 * can be judged.
 */

/**
 * How recent a capture must be to count as part of the same measurement.
 *
 * Six hours: long enough to survive a kill, a fleet repair, and a re-dispatch — the real sequence that
 * loses a run — and short enough that a publisher's overnight deploy lands outside it. A day would let a
 * corpus straddle a release; a minute would make resume useless for the case it exists for.
 */
export const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * @typedef {{url: string, capturedAt?: string|null}} ExistingCapture
 * @typedef {{skip: Set<string>, reused: number, oldestMs: number|null, staleUrls: string[]}} ResumePlan
 */

/**
 * Decide what to skip. PURE — `now` and the existing captures are arguments, never read here.
 *
 * @param {{urls: string[], existing: ExistingCapture[], now: number, windowMs?: number, resume: boolean}} input
 * @returns {ResumePlan}
 */
export function resumePlan({ urls, existing, now, windowMs = RESUME_WINDOW_MS, resume }) {
  /** @type {ResumePlan} */
  const plan = { skip: new Set(), reused: 0, oldestMs: null, staleUrls: [] };
  // WITHOUT --resume, nothing is skipped. The default must be a full capture: a resume that happened by
  // accident is how a corpus comes to be half from another day with nobody having chosen that.
  if (!resume) return plan;

  const wanted = new Set(urls);
  for (const capture of existing) {
    if (!wanted.has(capture.url)) continue;
    const at = capture.capturedAt ? Date.parse(capture.capturedAt) : Number.NaN;
    // An unparseable or absent timestamp is NOT a reason to reuse. Evidence that cannot say when it was
    // taken cannot be shown to belong to this measurement, and "probably fine" is the assumption this
    // whole module exists to refuse.
    if (!Number.isFinite(at)) { plan.staleUrls.push(capture.url); continue; }
    const age = now - at;
    if (age < 0 || age > windowMs) { plan.staleUrls.push(capture.url); continue; }
    plan.skip.add(capture.url);
    plan.reused += 1;
    plan.oldestMs = plan.oldestMs === null ? age : Math.max(plan.oldestMs, age);
  }
  return plan;
}

/**
 * One line an operator can act on. Named counts, never a bare "resumed".
 *
 * @param {ResumePlan} plan
 * @param {number} total
 * @returns {string}
 */
export function describeResume(plan, total) {
  if (!plan.reused) {
    return plan.staleUrls.length
      ? `  --resume: nothing reusable — ${plan.staleUrls.length} existing capture(s) are older than the `
        + "window or carry no timestamp, so they are being taken again\n"
      : "  --resume: no existing captures to reuse; this is a full run\n";
  }
  const minutes = plan.oldestMs === null ? 0 : Math.round(plan.oldestMs / 60_000);
  return `  --resume: reusing ${plan.reused} of ${total} capture(s), oldest ${minutes} minute(s) old`
    + (plan.staleUrls.length ? `; ${plan.staleUrls.length} too old to reuse and will be recaptured` : "")
    + "\n";
}
