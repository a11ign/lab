/**
 * A CONSENT BANNER MARKED UP AS A HEADING DEFEATED THE CONSENT-BANNER CHECK — #363.
 *
 * `furnitureCaptures()` asked "did this capture reach A heading" as a proxy for "did it reach the page".
 * A correctly built consent overlay announces `"heading, level 2, Manage your cookie preferences"`, which
 * satisfies the proxy — so the guard fails exactly on the accessible sites this project most wants to
 * measure, and it did: `www.historicenvironment.scot/visit/all/edinburgh-castle/` passed with a
 * seven-line transcript that never leaves the banner, and that capture is the sole evidence behind a 2.4.2
 * finding on a page whose publisher declares it conformant.
 *
 * **The three cases below are the whole argument, and the middle one is why the obvious fix is wrong.**
 * The row that raised this framed the signal as the DISAGREEMENT between the census and the DOM. That
 * cannot work: `census heading=0` against `DOM heading=55` is the largest disagreement available and it is
 * a finding about the PAGE — the Met Office warnings page rendered in full and exposed none of it, and
 * this function used to call that ours. A ratio classifies both the same way. Which headings were reached
 * separates them, and nothing else does.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { reachedOnlyFurnitureHeadings, headingsAnnouncedIn, partitionByExaminability }
  from "../../scripts/check-real-page-findings.ts";

/** The real transcript, verbatim from the capture that passed the old guard. */
const HISTORIC_ENVIRONMENT = [
  "heading, level 2, Manage your cookie preferences",
  "We use cookies to ensure our website functions properly, gather data to help improve your "
  + "experience on our site, and to show you personalised advertising.",
  "Find out what cookies are and how they are used on this website in our, visited, link, cookie policy",
  "Accept all cookies, button",
  "Reject non-essential cookies, button",
  "Manage preferences, button",
  "Close, button",
];

test("THE CASE THAT DEFEATED THE OLD GUARD: the only heading reached is the banner's own", () => {
  const headingNames = headingsAnnouncedIn(HISTORIC_ENVIRONMENT);
  assert.deepEqual(headingNames, ["Manage your cookie preferences"],
    "the grammar must read the heading's NAME out of the real announcement -- if this drifts, every "
    + "assertion below is examining an empty list and passing for that reason");
  assert.equal(reachedOnlyFurnitureHeadings({ headingNames, domHeadings: 5 }), true,
    "one heading reached, it is the overlay's, and the DOM says four more exist -- this capture never "
    + "left the consent banner and anything it says is about this tool");
});

test("THE MET OFFICE CASE, which a count-based or ratio-based fix would get wrong", () => {
  // census heading=0 against DOM heading=55: the page rendered in full and exposed none of it. That is a
  // finding about the PAGE, and `furnitureCaptures()` was fixed on 2026-08-27 to stop calling it ours.
  // The largest possible disagreement between the counts, and the answer is the opposite one.
  assert.equal(reachedOnlyFurnitureHeadings({ headingNames: [], domHeadings: 55 }), false,
    "reaching NO headings is a different case, decided by the DOM gate -- this predicate must not claim "
    + "it, or the remedy for one direction of blame cancels the remedy for the other");
});

test("a capture that reached the PAGE's headings is not furniture, whatever it opened on", () => {
  // networkrail opens on Cookiebot and still reaches 69 announcements and 11 headings. "Has a banner" and
  // "never got past the banner" are different facts.
  const headingNames = headingsAnnouncedIn([
    "heading, level 2, We use cookies",
    "main landmark, heading, level 1, Network Rail",
    "heading, level 2, Travelling by train",
  ]);
  assert.equal(headingNames.length, 3);
  assert.equal(reachedOnlyFurnitureHeadings({ headingNames, domHeadings: 11 }), false,
    "two of the three headings are the page's own, so the capture got past the banner");
});

test("A REAL COOKIE-POLICY PAGE IS NOT FURNITURE — the false positive that matters most", () => {
  // Its genuine headings are about cookies, so the vocabulary alone convicts it. What acquits it is that
  // the capture reached EVERY heading the DOM has: nothing was missed, so nothing was blocked.
  const headingNames = ["Cookie policy", "What cookies we use", "Managing your cookie preferences"];
  assert.equal(reachedOnlyFurnitureHeadings({ headingNames, domHeadings: 3 }), false,
    "the capture reached all three of the page's headings -- calling this furniture would withhold every "
    + "finding on a page the tool read perfectly well");
  assert.equal(reachedOnlyFurnitureHeadings({ headingNames, domHeadings: 2 }), false,
    "a DOM count BELOW the reached count cannot show anything was missed either");
});

test("an UNCOUNTED DOM never triggers this, in the conservative direction", () => {
  assert.equal(
    reachedOnlyFurnitureHeadings({ headingNames: ["Manage your cookie preferences"], domHeadings: undefined }),
    false,
    "an older capture carrying no DOM census cannot demonstrate a heading was missed. Claiming a capture "
    + "is ours on evidence we do not have is the mirror of claiming a finding on evidence we do not have");
});

test("headingsAnnouncedIn reads headings only, and survives a landmark prefix", () => {
  assert.deepEqual(headingsAnnouncedIn([
    "main landmark, heading, level 2, Opening times",   // a leading landmark is context, not the role
    "We use cookies to ensure our website functions properly",  // prose, no heading
    "Accept all cookies, button",                        // a control, not a heading
  ]), ["Opening times"]);
  assert.deepEqual(headingsAnnouncedIn(undefined), [],
    "an absent transcript is an empty list, never a throw -- this runs over every capture on disk");
});

/**
 * THE SECOND HALF: the report already SAID a furniture capture's findings are about this tool, and then
 * listed them among the NEW findings on conformant pages and counted them as failures. The headline and
 * the list contradicted each other — the same shape `furnitureCaptures()`'s own comment records from
 * 2026-08-27, where the report excused the page in one sentence and convicted it in the next.
 */
test("a finding from an unusable capture is WITHHELD from the NEW list, and NAMED", () => {
  const added = [
    { url: "https://www.historicenvironment.scot/visit/all/edinburgh-castle/", criterion: "2.4.2" },
    { url: "https://www.networkrail.co.uk/", criterion: "4.1.2" },
  ];
  const { reportable, withheld } = partitionByExaminability(
    added, new Set(["https://www.historicenvironment.scot/visit/all/edinburgh-castle/"]));
  assert.deepEqual(reportable.map((c) => c.criterion), ["4.1.2"],
    "a page the capture actually read keeps its finding -- withholding must be narrow or the gate goes "
    + "deaf, which is this repo's own warning about making a rule quieter");
  assert.deepEqual(withheld.map((c) => c.criterion), ["2.4.2"]);
});

test("WITHHELD IS NOT DROPPED — the partition returns both halves, never just the survivors", () => {
  // A finding that simply vanished is indistinguishable from one never produced, and the whole point of
  // this capture is that somebody has to go and fix it.
  const added = [{ url: "https://example.test/a", criterion: "2.4.2" }];
  const { reportable, withheld } = partitionByExaminability(added, new Set(["https://example.test/a"]));
  assert.equal(reportable.length, 0);
  assert.equal(withheld.length, 1, "the withheld finding must still be available to print by name");
});
