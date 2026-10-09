/**
 * #1497: a bad capture that holds no reading is classified as a HOLE -- `check-signals`' NO CAPTURES, printed
 * "uncaptured" -- never as a BLIND signal.
 *
 * The fixtures are the RECORDED shapes, verbatim, from orchestrator's lab reading on #1497 (comment
 * 5657549839, protocol 18, captures written by the #914 batch): the base pair of `skip-link-target-replaced`
 * and the bad capture of its `+with-status-region` variant. Only the two fields the signal reads are kept.
 *
 * `check-signals.mjs` itself is not imported: it reaches `dataset-paths.mjs` and would make this file
 * corpus-charged. Its wiring is read from source instead, the shape `pr-open.test.ts`'s WIRING tests take.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@a11ign/evidence/source-text";
import { unmeasuredEvidence, UNMEASURED_EVIDENCE } from "./signal-evidence-measured.mjs";
import { signalMatches } from "./case-matrix.mjs";
import { SIGNAL_TYPES } from "./signal-predicates.mjs";

const SIGNAL = { type: "skip-link-inert" };
const SKIP_LINK = "Skip to main content, same page, link";

const BASE_FOCUS_ORDER = [
  "Skip to main content, link, focused, linked, same page",
  "News and updates, link, focused, linked",
  "Events calendar, link, focused, linked",
  "Contact the team, link, focused, linked",
  "Search the archive, edit, focused, blank",
  "Opening times for the north entrance 01, link, focused, linked, same page",
  "Annual review 2019 02, link, focused, linked, same page",
  "Accessibility statement 03, link, focused, linked, same page",
  "Travel and parking 04, link, focused, linked, same page",
  "Volunteering enquiries 05, link, focused, linked, same page",
  "Room hire rates 06, link, focused, linked, same page",
  "Reference notes archive, button, focused, expanded",
  "Skip to main content, link, focused, linked, same page",
  "News and updates, link, focused, linked",
  "Events calendar, link, focused, linked",
];

/** A capture holding only what `skip-link-inert` reads. */
function capture(routeChange: Record<string, unknown> | undefined, focusOrder = BASE_FOCUS_ORDER) {
  return { interaction: { focusOrder, routeChange } };
}

const route = (nextFocusAfter: unknown, announced: string) => ({
  control: SKIP_LINK, titleBefore: "Archive", titleAfter: "Archive",
  headingBefore: "Reference note 01, heading, level 2", headingAfter: "Reference note 01, heading, level 2",
  nextFocusAfter, announced, navigated: true,
});

// skip-link-target-replaced.bad.json -- the capture stage 8 printed BLIND.
const BASE_BAD = capture(route(null, "visited"));
// skip-link-target-replaced.good.json
const BASE_GOOD = capture(route("Search the archive, edit, focused, blank", "Search the archive, Search the archive, edit,"));
// skip-link-target-replaced+with-status-region.bad.json -- the same page pair, measured, read OK.
const VARIANT_BAD = capture(route("News and updates, link, focused, linked", "visited"), [
  "Skip to main content, link, focused, linked, same page",
  "News and updates, link, focused, linked",
  "Events calendar, link, focused, linked",
  "Contact the team, link, focused, linked",
  "Search the archive, edit, focused, blank",
  "Show current records, button, focused",
  "Opening times for the north entrance 01, link, focused, linked, same page",
  "Annual review 2019 02, link, focused, linked, same page",
  "Accessibility statement 03, link, focused, linked, same page",
  "Travel and parking 04, link, focused, linked, same page",
  "Volunteering enquiries 05, link, focused, linked, same page",
  "Room hire rates 06, link, focused, linked, same page",
  "Skip to main content, link, focused, linked, same page",
  "News and updates, link, focused, linked",
  "Events calendar, link, focused, linked",
]);

test("#1497 ACCEPTANCE: the recorded base BAD capture -- skip link followed, no nextFocusAfter -- is UNMEASURED", () => {
  assert.equal(signalMatches(BASE_BAD, SIGNAL), false,
    "the premise: this is the capture the gate called BLIND -- the signal makes no claim on a null");
  const reason = unmeasuredEvidence(BASE_BAD, SIGNAL);
  assert.equal(typeof reason, "string", "a followed skip link with no reading is a hole, and it must say so");
  assert.match(String(reason), /followed "Skip to main content, same page, link" and recorded no nextFocusAfter/,
    "and the reason names the control the probe followed, so the report sends a reader to recapture it");
});

test("#1497 CONTROL: a MEASURED inert BAD fires and is measured; the GOOD page is silent and measured", () => {
  assert.equal(signalMatches(VARIANT_BAD, SIGNAL), true,
    "the variant that read OK: the signal sees this fault when there is a reading");
  assert.equal(unmeasuredEvidence(VARIANT_BAD, SIGNAL), null, "a reading is not a hole");
  assert.equal(signalMatches(BASE_GOOD, SIGNAL), false, "the good page's skip link works");
  assert.equal(unmeasuredEvidence(BASE_GOOD, SIGNAL), null, "and its reading is measured too");
});

test("#1497: an EMPTY reading is a reading -- focus that went somewhere silent is an observation", () => {
  assert.equal(unmeasuredEvidence(capture(route("", "visited")), SIGNAL), null);
});

test("#1497: NOT APPLICABLE is not UNMEASURED -- those stay the signal's own business", () => {
  const cases: Array<[string, ReturnType<typeof capture>]> = [
    ["no route probe", capture(undefined)],
    ["no link reached", capture({ ...route(null, ""), control: null, navigated: false })],
    ["the probe errored", capture({ ...route(null, ""), error: "timeout" })],
    ["the first link is not a skip link", capture({ ...route(null, "visited"), control: "Home, link" })],
  ];
  for (const [label, shape] of cases) assert.equal(unmeasuredEvidence(shape, SIGNAL), null, label);
  assert.equal(unmeasuredEvidence(BASE_BAD, { type: "route-title-stale" }), null,
    "a signal type this module does not answer for is never called unmeasured");
});

test("#1497: every signal type the module answers for is a real signal type", () => {
  const answered = Object.keys(UNMEASURED_EVIDENCE);
  assert.ok(answered.length > 0, "the module answers for nothing, so every assertion above examined nothing");
  for (const type of answered) assert.ok(SIGNAL_TYPES.includes(type), `${type} is not a signal check-signals knows`);
});

test("#1497 WIRING: checkCase asks before it says BLIND, and a hole keeps the NO CAPTURES verdict with its reason", () => {
  const source = stripComments(readFileSync(new URL("./check-signals.mjs", import.meta.url), "utf8"));
  assert.match(source, /import \{ unmeasuredEvidence \} from "\.\/signal-evidence-measured\.mjs";/);
  const start = source.indexOf("export function checkCase(");
  assert.ok(start >= 0, "checkCase is gone from check-signals.mjs");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const asked = body.indexOf("unmeasuredEvidence(bad, testCase.badSignal)");
  const blind = body.indexOf('verdict: "BLIND"');
  assert.ok(asked > 0 && blind > 0, "both the question and the BLIND verdict are in checkCase");
  assert.ok(asked < blind, "the bad capture is asked whether it holds a reading BEFORE the signal is called blind");
  assert.match(body, /verdict: "NO CAPTURES", unmeasured/, "a hole keeps the category --require-complete fails on");
});
