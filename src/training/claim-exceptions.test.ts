/**
 * A publisher's declared exceptions, and the two places they have to survive.
 *
 * These exist because the mask they feed was INERT for its whole life. `build-realism-tier.mjs` read
 * `claimExcludes` off the CAPTURED file, which carries six keys and not that one, so every page got `[]` and
 * every masked head trained the page as conformant. Nothing reported it, because a failed join and a
 * publisher with nothing to disclose produce identical output. Hence: test the join, and test the rule.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { unevaluableFor } from "../../scripts/build-realism-tier.mjs";
import { contradictedFindings } from "../../scripts/calibrate-abstention.mjs";
import { REAL_PAGES, normaliseUrl, realPageFor } from "./real-page-corpus.mjs";

/** The criteria the shipped model actually has heads for. Read, never hardcoded — a retrain can move them. */
const SCORED = (() => {
  const report = JSON.parse(readFileSync(
    new URL("../../../scorer/models/screenreader-scorer/training-report.json", import.meta.url), "utf8"));
  const criteria = Object.keys(report.criteria);
  const subtypes = criteria.flatMap((c) => Object.keys(report.criteria[c].subtypes ?? {}));
  return { criteria: new Set(criteria), subtypes: new Set(subtypes) };
})();

test("every declared exception names a criterion the model actually scores", () => {
  // A typo masks NOTHING, silently: `known_indices` and `contradictedFindings` both match on equality, so
  // "4.12" excludes no head and the page trains as fully conformant. That is the failure this catches.
  for (const page of REAL_PAGES) {
    for (const entry of page.claimExcludes ?? []) {
      const valid = SCORED.criteria.has(entry) || SCORED.subtypes.has(entry);
      assert.ok(valid, `${page.url} declares claimExcludes "${entry}", which is neither a scored criterion `
        + `(${[...SCORED.criteria].join(", ")}) nor a known subtype. A typo here masks nothing at all.`);
    }
  }
});

test("a partially-claimed calibration page declares what it claims, so the rate stays comparable", () => {
  // This used to require `role: "training"` for any page with exceptions, because
  // `calibrate-abstention.mjs` counted false positives PER PAGE: a publisher disclosing six of our eight
  // criteria has a quarter of the chances to be counted wrong that a fully-claiming one has, so mixing them
  // made the headline mean two things at once. Correct, and it cost the calibration set its diversity —
  // 19 pages from 5 publishers, 12 of them one design system, and that was the sample EVERY real-page
  // number in this project rested on. Every false accusation found on 2026-08-24 was a page from it.
  //
  // The sweep now also reports a per-CELL rate, where a cell is one (page, criterion) the publisher
  // actually claims. That makes a masked page and an unmasked one contribute on the same terms, so the bar
  // is lifted and what remains is the thing that has to be true: a calibration page's exceptions must be
  // DECLARED, or its cells cannot be counted correctly either way.
  for (const page of REAL_PAGES) {
    if (page.role !== "calibration") continue;
    for (const entry of page.claimExcludes ?? []) {
      assert.ok(typeof entry === "string" && entry.length > 0,
        `${page.url} has a malformed exception, so its tested-cell count would be wrong`);
    }
  }
});

test("the url join survives a trailing slash, a fragment and case", () => {
  // The join is by url, and a drifted url returning `undefined` is treated as an ERROR by both callers.
  // These are the shapes that would otherwise silently miss.
  const page = REAL_PAGES.find((p) => (p.claimExcludes ?? []).length > 0);
  assert.ok(page, "no page declares exceptions — this test would prove nothing");
  assert.equal(realPageFor(page.url)?.url, page.url);
  assert.equal(realPageFor(`${page.url}/`)?.url, page.url);
  assert.equal(realPageFor(`${page.url}#main`)?.url, page.url);
  assert.equal(realPageFor(page.url.toUpperCase().replace("HTTPS", "https"))?.url, page.url);
});

test("a url not in the corpus returns undefined, so a caller can refuse it", () => {
  assert.equal(realPageFor("https://example.com/not-in-the-corpus"), undefined);
  assert.equal(normaliseUrl("https://Example.com/a/#frag"), "https://example.com/a");
});

test("a finding the publisher CLAIMS conforms is a false positive", () => {
  assert.deepEqual(contradictedFindings({ predicted: ["4.1.2"], claimExcludes: [] }), ["4.1.2"]);
});

test("a finding the publisher DISCLOSES as failing is not an error", () => {
  // The whole point. `predicted.length > 0` counted this, penalising the model for being right about a
  // criterion its publisher states in writing that it fails.
  assert.deepEqual(contradictedFindings({ predicted: ["4.1.2"], claimExcludes: ["4.1.2"] }), []);
});

test("a criterion-level exception covers its subtypes, because statements are written that way", () => {
  // An accessibility statement says "WCAG 4.1.2 (Level A) — Name, Role, Value", never "4.1.2:unnamed-control".
  assert.deepEqual(contradictedFindings({ predicted: ["1.1.1"], claimExcludes: ["1.1.1:missing-alt"] }), []);
  assert.deepEqual(contradictedFindings({ predicted: ["1.1.1", "4.1.2"], claimExcludes: ["4.1.2"] }), ["1.1.1"]);
});

test("a fully-excluded page can never produce a false positive", () => {
  // Correct rather than convenient: a publisher who tells us nothing checkable contributes structure to the
  // corpus and no verdict. Five publishers are in this state because their claims contradict themselves or
  // name no criteria at all.
  const all = [...SCORED.criteria];
  assert.deepEqual(contradictedFindings({ predicted: all, claimExcludes: all }), []);
});

test("absent claimExcludes means the publisher claims everything", () => {
  // W3C's statement is a site-wide AA conformance claim, so `clean` there really is the source's assertion.
  assert.deepEqual(contradictedFindings({ predicted: ["3.3.1"] }), ["3.3.1"]);
});

/**
 * The structural mask: criteria whose evidence a real-page capture cannot contain.
 *
 * Measured before writing these: 0 of 77 real captures carry `formChanges` or `postSubmitFields`, because
 * `probeForms` is off for pages we do not own. So 3.3.1 and 4.1.3 were being trained as clean on 41 and 39
 * real pages from evidence that was never gathered. These assert the mask fires on absence and — the half
 * that matters — that it does NOT fire when the evidence is present, so enabling the probe one day
 * un-masks them without anyone having to remember.
 */
test("a capture with no form-interaction evidence masks the two criteria that read it", () => {
  const masked = unevaluableFor({ interaction: { controls: ["Search, button"], stateChanges: [{}] } });
  assert.deepEqual(masked.sort(), ["3.3.1", "4.1.3"]);
});

test("formChanges present un-masks 3.3.1, and only 3.3.1", () => {
  const masked = unevaluableFor({ interaction: { formChanges: [{ control: "Email", after: "" }] } });
  assert.deepEqual(masked, ["4.1.3"]);
});

test("postSubmitFields present un-masks 4.1.3, and only 4.1.3", () => {
  const masked = unevaluableFor({ interaction: { postSubmitFields: ["Email, edit, invalid entry"] } });
  assert.deepEqual(masked, ["3.3.1"]);
});

test("both channels present masks nothing — the probe was run, so the labels are real", () => {
  assert.deepEqual(unevaluableFor({
    interaction: { formChanges: [{ control: "Email" }], postSubmitFields: ["Error summary"] },
  }), []);
});

test("a capture with no interaction at all is masked, not treated as evidence of conformance", () => {
  assert.deepEqual(unevaluableFor({}).sort(), ["3.3.1", "4.1.3"]);
  assert.deepEqual(unevaluableFor(undefined).sort(), ["3.3.1", "4.1.3"]);
});
