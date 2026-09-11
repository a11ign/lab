/**
 * #955: the `field` role -- pages a stranger is likely to point this tool at, with no conformance claim.
 *
 * `ceo` decided it on 2026-09-11 because the real-page corpus held no commercial marketing page, so it could
 * not express a defect only marketing-site furniture produces -- #951's chat widget was the first measured,
 * on a page the corpus did not have. The role's whole contract is what it must NOT reach:
 *
 *   - the CONFORMANCE LINE (`rules:real-pages`), which scores pages whose publisher declares them conformant;
 *   - the ASSERTED-WRONGLY and REFERRED figures (`calibrate-abstention.mjs`), fitted on `calibration`;
 *   - TRAINING (`build-realism-tier.mjs`), built from `training`.
 *
 * Each is asserted THROUGH THE READER'S OWN SELECTION FUNCTION, which the reader imports from
 * `real-page-selection.mjs` -- never through a list here of which roles count, because that list is the one
 * that goes stale when the next role arrives. A pin beside each assertion names the reader and fails if it
 * stops calling the function this test drives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { REAL_PAGES, capturablePages, isRecordedRefusal, pagesFor } from "./real-page-corpus.mjs";
import {
  calibrationEntries, conformanceLineAnswer, fieldPopulationLines, trainingEntries,
} from "./real-page-selection.mjs";
import { discoverRoles } from "./real-page-role-coverage.mjs";
import { gateVerdicts, worstVerdict } from "../../../../scripts/board-gates.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(REPO, path), "utf8");

/** `ceo`'s first set, 04:28Z on 2026-09-11, as written into #955's acceptance. */
const CAPTURED = ["https://www.hubspot.com/", "https://www.notion.com/", "https://www.dropbox.com/",
  "https://www.adobe.com/", "https://www.atlassian.com/", "https://mailchimp.com/"];
/** The four recorded refusals: the global address, and where it landed, as recorded on #955 from round 5. */
const REFUSED: Record<string, string> = {
  "https://stripe.com/": "stripe.com/gb",
  "https://www.shopify.com/": "shopify.com/uk",
  "https://www.canva.com/": "canva.com/en_gb/",
  "https://www.zendesk.com/": "zendesk.co.uk/#georedirect",
};

const FIELD = pagesFor("field");
/**
 * The ruled URLs, not `FIELD`: the exclusion tests below iterate what `ceo` RULED into the role, so a field
 * page quietly given another role (the acceptance's mutation) is still checked -- and caught -- by them.
 */
const RULED = [...CAPTURED, ...Object.keys(REFUSED)];
/** Every declared page as the captures a reader would load, so a selection is driven over the WHOLE corpus. */
const asEntries = (pages: readonly { url: string }[]) => pages.map((page) => ({ capture: { url: page.url } }));
const urlsOf = (entries: readonly { capture: { url: string } }[]) => entries.map((entry) => entry.capture.url);

test("`field` holds ceo's first set: six captured pages and four recorded refusals, at the global address", () => {
  assert.deepEqual(FIELD.map((page) => page.url).sort(), [...CAPTURED, ...Object.keys(REFUSED)].sort());
  assert.deepEqual(capturablePages(FIELD).map((page) => page.url).sort(), [...CAPTURED].sort());
  for (const page of FIELD.filter(isRecordedRefusal)) {
    assert.deepEqual(page.refused, { fault: "wrong-page", reason: "geo-redirect", observed: REFUSED[page.url] },
      `${page.url} must record the outcome a stranger here meets, as recorded on #955`);
  }
});

test("no field page carries a conformance claim -- and no page OUTSIDE field lacks one", () => {
  // Both directions, because each catches a different edit. A field page given a claim would be admitted by
  // the conformance line; a field page moved to another role keeps no claim, and is caught by the second.
  const claimed = FIELD.filter((page) => page.publishedClaim !== undefined).map((page) => page.url);
  assert.deepEqual(claimed, [], "a conformance claim is exactly what this role does not have");
  const unclaimed = REAL_PAGES.filter((page) => page.publishedClaim === undefined && page.role !== "field")
    .map((page) => `${page.url} (${page.role})`);
  assert.deepEqual(unclaimed, [], "only a field page may lack a published claim");
});

test("THE CONFORMANCE LINE admits no field page -- through `rules:real-pages`' own selection", () => {
  for (const url of RULED) {
    assert.deepEqual(conformanceLineAnswer(url), { page: null, why: "field" },
      `${url} is not answered as a field page by the conformance line`);
  }
  // The control: the same function still admits a page whose publisher declares it conformant.
  const conformant = REAL_PAGES.find((page) => page.role === "calibration" && page.publishedClaim === "conformant");
  assert.equal(conformanceLineAnswer(conformant?.url).page?.url, conformant?.url);
  assert.match(read("packages/lab/scripts/check-real-page-findings.ts"),
    /import \{[^}]*\bconformanceLineAnswer\b[^}]*\} from "\.\.\/src\/training\/real-page-selection\.mjs"/,
    "rules:real-pages must select through the function this test drives");
});

test("THE FIGURES admit no field page -- through `calibrate-abstention.mjs`' own selection", () => {
  const admitted = urlsOf(calibrationEntries(asEntries(REAL_PAGES)));
  assert.deepEqual(admitted.filter((url) => RULED.includes(url)), []);
  assert.equal(admitted.length, pagesFor("calibration").length, "the control: every calibration page is admitted");
  assert.match(read("packages/lab/scripts/calibrate-abstention.mjs"),
    /import \{[^}]*\bcalibrationEntries\b[^}]*\} from "\.\.\/src\/training\/real-page-selection\.mjs"/);
});

test("TRAINING admits no field page -- through `build-realism-tier.mjs`, the reader that builds the training set", () => {
  const admitted = urlsOf(trainingEntries(asEntries(REAL_PAGES)));
  assert.deepEqual(admitted.filter((url) => RULED.includes(url)), []);
  assert.equal(admitted.length, pagesFor("training").length, "the control: every training page is admitted");
  assert.match(read("packages/lab/scripts/build-realism-tier.mjs"),
    /import \{[^}]*\btrainingEntries\b[^}]*\} from "\.\.\/src\/training\/real-page-selection\.mjs"/);
});

test("a RECORDED REFUSAL reaches no finding, no figure and no training record -- and is never visited", () => {
  const refusals = FIELD.filter(isRecordedRefusal);
  assert.equal(refusals.length, 4);
  for (const page of refusals) {
    assert.equal(conformanceLineAnswer(page.url).page, null, `${page.url}: a finding needs a scored page`);
  }
  const entries = asEntries(refusals);
  assert.deepEqual(calibrationEntries(entries), [], "no figure");
  assert.deepEqual(trainingEntries(entries), [], "no training record");
  assert.deepEqual(capturablePages(refusals), [], "never visited: its outcome is on record and costs fleet time");
  assert.match(read("packages/lab/src/training/capture-real-pages.mjs"), /capturablePages\(declared\)/,
    "the capture run must select through `capturablePages`");
});

test("rules:real-pages prints field APART from the conformance line, and the board's headline never reads it", () => {
  const lines = fieldPopulationLines(FIELD, new Set(["https://www.hubspot.com/"]));
  const printed = lines.join("\n");
  assert.match(lines[0], /^ {2}field: 10 page\(s\) .* no conformance claim, so not in the line above/);
  assert.match(printed, /1 of 6 captured/);
  for (const url of CAPTURED.slice(1)) assert.ok(printed.includes(`not captured: ${url}`), url);
  for (const [url, observed] of Object.entries(REFUSED)) {
    assert.ok(printed.includes(`${url} -> wrong-page (geo-redirect to ${observed})`), url);
  }
  // THE BOARD HALF (product-manager, on #955): `lastGate` pastes the gate's output verbatim, and the board's
  // conformance headline is `worstVerdict` over it -- the gate's own verdict line. So the field section must
  // carry no verdict, or the headline could read a population that includes field.
  assert.deepEqual(gateVerdicts(printed), []);
  const gate = ["  86 conformant real page(s) scored against the baseline.", ...lines,
    "  PASS — no conformant page gained a finding"].join("\n");
  assert.equal(worstVerdict(gate)?.line, "PASS — no conformant page gained a finding");
});

test("field is recaptured on the batch, next to calibration and training", () => {
  const pipeline = read("packages/control/src/lab-pipeline.mjs");
  const realPages = pipeline.slice(pipeline.indexOf('"real-pages": {'), pipeline.indexOf('"rules-real-pages"'));
  for (const role of ["calibration", "training", "field"]) {
    assert.match(realPages, new RegExp(`\\{ job: "capture-real-pages", vars: \\{ role: "${role}" \\} \\}`), role);
  }
});

test("the lab job admits exactly the roles the corpus declares -- `lab-job.yml` against `CorpusRole`", () => {
  // Found while building this row: the job's own assert listed three roles, so the pipeline entry above
  // would have been refused by ansible on the lab with every local test green. Discovered, never listed.
  const allowed = /role \| default\('training'\) in \[([^\]]*)\]/.exec(read("packages/control/ansible/lab-job.yml"));
  assert.ok(allowed, "lab-job.yml no longer asserts capture-real-pages' role -- this pin reads nothing");
  const roles = [...allowed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(roles, discoverRoles(REAL_PAGES));
});
