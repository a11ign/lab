// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cacheKey, hashPageDir } from "./capture-cache.mjs";
import { isUsableCapture } from "../capture/evidence-diff.mjs";

/**
 * A completed pair is eligible for --resume only while it still describes the current page bytes.
 * The fallback recomputes the old cache identity for captures made before pageHash was recorded.
 */
/**
 * TEST GRADE: accept a capture whose page has moved, for answering a question rather than shipping.
 *
 * `hasUsableCaptureFiles` compares `provenance.pageHash` to the page on disk and rejects a mismatch
 * wholesale. That is exactly right for a RELEASE — mixed evidence in a promoted model is the failure the
 * cache key exists to prevent — and it is the wrong rule for a TEST.
 *
 * The two are different questions. "May this evidence ship?" needs every capture to describe the page it
 * is labelled against. "Did my change move the number?" needs the cases I CHANGED to be current and the
 * rest to be present at all — because a veto, a starvation count or a signal check is computed per
 * subtype, so untouched subtypes contribute the same answer either way.
 *
 * Measured 2026-08-26, and it is why this exists: a corpus change left 1,082 of 1,401 pairs stale, so an
 * export dropped them and a retrain would have used 319 pairs — a worse model that every gate scores as
 * if it were whole. The only way to ask "did the fix work?" was to spend four hours first.
 *
 * **A test-grade dataset must never be promotable**, and that is enforced rather than promised: the
 * export stamps `grade: "test"`, the trainer refuses to mark such a model release-eligible, and
 * `promote-model.mjs` already refuses a model that is not eligible. Three independent gates, none of
 * which is this comment.
 */
export const TEST_GRADE = process.env.A11Y_DATASET_GRADE === "test";

/**
 * `acceptStalePages` is a PARAMETER, never read from the environment here — and that distinction is a
 * defect this nearly shipped with.
 *
 * `previouslyCaptured` below uses this function to decide what `--resume` may SKIP. Reading the grade
 * ambiently made a test-grade capture run treat a stale capture as already done and skip recapturing it,
 * which is the exact opposite of what a test run needs: the whole point is to refresh the cases that
 * moved. The EXPORT wants to accept stale evidence; the CAPTURE must still refuse it.
 *
 * So the caller says which question it is asking. The export passes `TEST_GRADE`; resume never does.
 */
/**
 * @param {{ id: string, captureRoot: string, pageRoot: string, acceptStalePages?: boolean }} request
 */
export function hasUsableCaptureFiles({ id, captureRoot, pageRoot, acceptStalePages = false }) {
  let pageHash;
  try {
    pageHash = hashPageDir(resolve(pageRoot, id));
  } catch {
    return false;
  }

  return ["good", "bad"].every((variant) => {
    try {
      const capture = JSON.parse(readFileSync(resolve(captureRoot, id + "." + variant + ".json"), "utf8"));
      if (!isUsableCapture(capture)) return false;

      const provenance = capture.provenance ?? {};
      // In test grade the capture must still be REAL — an NVDA transcript for this case — but it need not
      // describe the current page bytes. The check above (`isUsableCapture`) is what stays; only the
      // page-identity comparison relaxes.
      if (acceptStalePages) return true;
      if (provenance.pageHash) return provenance.pageHash === pageHash;

      // Legacy captures still have the complete worker environment on the capture and the exact
      // options in provenance. Recompute their old cache identity against the current page bytes
      // so --resume cannot silently skip a changed fixture.
      // A pair captured before the cache/provenance boundary is not safe to skip on a forced
      // resume. It must be recaptured rather than treated as current merely because its transcript
      // is non-empty.
      if (!provenance.cacheKey || !provenance.options || !capture.environment) return false;
      return cacheKey({
        caseId: id,
        pageHash,
        options: provenance.options,
        environment: capture.environment,
      }) === provenance.cacheKey;
    } catch {
      return false;
    }
  });
}

/**
 * @param {{ cases: { id: string }[],
 *           previous: { cases?: Record<string, { status?: string, reason?: string }> } | null,
 *           captureRoot: string, pageRoot: string, resume?: boolean, cache?: boolean }} request
 *   `previous.cases` is the progress file's map, whose entries carry a `status` and, when that
 *   status is `failed`, the `reason` the retry rule reads.
 * @returns {Set<string>}
 */
export function previouslyCaptured({ cases, previous, captureRoot, pageRoot, resume, cache }) {
  if (!resume || cache) return new Set();
  const allowed = new Set(cases.map(({ id }) => id));
  return new Set(Object.entries(previous?.cases ?? {})
    .filter(([id, entry]) =>
      allowed.has(id) &&
      (entry.status === "captured" || entry.status === "skipped" ||
        (entry.status === "failed" && /HTTP 429.*capture is already in progress/i.test(entry.reason || ""))) &&
      hasUsableCaptureFiles({ id, captureRoot, pageRoot }))
    .map(([id]) => id));
}
