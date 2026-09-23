/**
 * #1926: `with-realism.jsonl` HAS TWO WRITERS, AND ONLY ONE OF THEM WAS GIVEN THE PROTOCOL STAMP.
 *
 * `build-realism-tier.mjs` writes the corpus export's records through verbatim and appends the realism
 * tier from its own `recordFor`. #1989 measured that every exported record carried no `captureProtocol`,
 * and #2064 fixed `export-screenreader-dataset.mjs` — the first writer. The second was never in that
 * diff, so its `provenance` literal carried no `environment` key at all and
 * `grep -c environment build-realism-tier.mjs` returned `0`.
 *
 * What that cost is not abstract. #1926's clause 3 — "every record in `with-realism.jsonl` carries
 * `captureProtocol: 21`" — would have read `null` on up to 41 records (`REAL_PAGES` `role: training`)
 * however perfectly the recapture ran, and `[null, 21]` reads as *some records are unstamped*. Measured
 * on the lab 2026-09-23T18:44Z, what it was hiding is that **all 121 real-page captures are protocol
 * 18**, three versions behind the fleet. The absent stamp is what made a three-version gap invisible,
 * which is #1989's own thesis arriving one file to the left.
 *
 * These tests drive `recordFor` rather than reading a corpus, deliberately: `runs/` is gitignored and a
 * checkout's copy is only ever as fresh as its last sync, so a test that read one would pass by absence.
 * `claim-exceptions.test.ts` is the precedent — same file, same reason, `unevaluableFor` exported to be
 * reachable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { recordFor } from "../../scripts/build-realism-tier.mjs";
import { captureEnvironment } from "./export-screenreader-dataset.mjs";

/** A real-page corpus entry, in the six-key shape `capture-real-pages.mjs` actually writes. */
function entryWith(environment: Record<string, unknown>) {
  return {
    role: "training",
    publishedClaim: "clean",
    claimSource: "https://www.w3.org/WAI/",
    demonstrates: "images",
    capturedAt: "2026-09-14T00:00:10.389Z",
    capture: {
      url: "https://www.w3.org/WAI/tutorials/images/decorative/",
      transcript: [],
      diagnostics: [],
      environment,
    },
  };
}

test("#1926: a realism record carries the protocol its OWN capture was taken under", () => {
  // 18 and not 21, on purpose: this is the value the live corpus actually holds, so the test fails if
  // the stamp is ever hardcoded to the protocol of the day rather than read from the capture.
  const record = recordFor(entryWith({ captureProtocol: 18, nodeVersion: "v24.19.0" }));
  assert.equal(record.provenance.environment.captureProtocol, 18);
});

test("#1926: an UNSTAMPED capture stays null — the stamp is read, never defaulted", () => {
  // The positive control for the test above: without this, a stamp hardcoded to any constant would pass
  // that one. "Captured under protocol N" and "protocol not recorded" are the two populations this field
  // exists to separate, and a default would merge them — the exact failure #1989 was filed for.
  const record = recordFor(entryWith({}));
  assert.equal(record.provenance.environment.captureProtocol, null);
});

test("#1926: a RECORDED protocol 0 survives, so `||` cannot creep back in on this writer either", () => {
  // #2064's reasoning, applied to the second writer: `knownOr` is `||`, which exports a recorded `0` as
  // `null`. The repo may never mint a protocol 0; the point is that the one operator that can confuse
  // these two populations must not be the one in use, and only a falsy value can show which is.
  const record = recordFor(entryWith({ captureProtocol: 0 }));
  assert.equal(record.provenance.environment.captureProtocol, 0);
});

test("#1926: both writers stamp the SAME shape, so clause 3's single jq path reads both tiers", () => {
  // THE DELETE-A-COPY CONTROL. The remedy here was to call the export's own `captureEnvironment` rather
  // than to write a second stamping implementation beside it. A re-implementation would satisfy every
  // assertion above and still drift — a different key set, or the same fields one level up — and then
  // `.provenance.environment.captureProtocol` would answer on one tier and not the other, which is the
  // state this row found the file in.
  const environment = { captureProtocol: 21, nodeVersion: "v24.20.0", browserVersion: "152.0.4191.66" };
  const entry = entryWith(environment);
  assert.deepEqual(
    Object.keys(recordFor(entry).provenance.environment).sort(),
    Object.keys(captureEnvironment(entry.capture)).sort());
});
