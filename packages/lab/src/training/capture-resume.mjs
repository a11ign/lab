import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cacheKey, hashPageDir } from "./capture-cache.mjs";

const hasTranscript = (capture) =>
  capture?.screenReader === "NVDA" && Array.isArray(capture.transcript) && capture.transcript.length > 0;

/**
 * A completed pair is eligible for --resume only while it still describes the current page bytes.
 * The fallback recomputes the old cache identity for captures made before pageHash was recorded.
 */
export function hasUsableCaptureFiles({ id, captureRoot, pageRoot }) {
  let pageHash;
  try {
    pageHash = hashPageDir(resolve(pageRoot, id));
  } catch {
    return false;
  }

  return ["good", "bad"].every((variant) => {
    try {
      const capture = JSON.parse(readFileSync(resolve(captureRoot, id + "." + variant + ".json"), "utf8"));
      if (!hasTranscript(capture)) return false;

      const provenance = capture.provenance ?? {};
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
