/**
 * #1790: the pure comparison this row's measurement rests on. Fixtures below are small, hand-built
 * shapes of real corpus records (`runs/real-page-corpus`, gitignored, never embedded here) rather than
 * copies of the captures themselves — the files named in each test's own comment are where the shape was
 * measured, not where the assertion reads from.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  announcementIdentitySignal, censusIdentitySignal, classifyRouteChange, headingProxySignal,
} from "./route-change-identity.mjs";

test("headingProxySignal: a real heading change reads as navigated", () => {
  assert.equal(
    headingProxySignal({ headingBefore: "main landmark, Council tax, heading, level 1", headingAfter: "main landmark, Cookies, heading, level 1" }),
    true);
});

test("headingProxySignal: an unchanged heading reads as not navigated (the vacuity control)", () => {
  assert.equal(
    headingProxySignal({ headingBefore: "main landmark, Council tax, heading, level 1", headingAfter: "main landmark, Council tax, heading, level 1" }),
    false);
});

test("headingProxySignal: an empty string is excluded exactly like the shipped rule's falsy guard", () => {
  // `www-...-localhost-5050-focus-panel-undismissable-help-bad-html.json`'s own shape: `headingAfter: ""`.
  // `addStaleRouteTitle` bails on `!headingAfter` before ever comparing -- a plain `typeof` check would
  // have let this through as a comparable value and counted a probe failure as a real finding.
  assert.equal(headingProxySignal({ headingBefore: "no next heading", headingAfter: "" }), null);
});

test("headingProxySignal: a missing heading is not measured, never a false agreement", () => {
  assert.equal(headingProxySignal({}), null);
});

test("announcementIdentitySignal: NVDA's own new-document announcement reads as navigated", () => {
  // `www-mygov-scot-benefits.json`'s own shape.
  assert.equal(announcementIdentitySignal({ announced: "Cookies - mygov dot scot, document" }), true);
});

test("announcementIdentitySignal: a transitional 'Loading page' does not confirm a new document", () => {
  // `www-lbhf-gov-uk-council-tax.json`'s own shape.
  assert.equal(announcementIdentitySignal({ announced: "Loading page" }), false);
});

test("announcementIdentitySignal: an empty announcement is unmeasured, never read as silence", () => {
  assert.equal(announcementIdentitySignal({ announced: "" }), null);
});

test("censusIdentitySignal: the served path read before and after the probe, from marks already on disk", () => {
  const diagnostics = [
    { event: "pageState", targetUrl: "https://example.org/before" },
    { event: "routeChange", activating: "next, link" },
    { event: "routeChange", found: true },
    { event: "structureCensus", targetUrl: "https://example.org/after" },
  ];
  assert.equal(censusIdentitySignal(diagnostics), true);
});

test("censusIdentitySignal: the same served path both sides reads as no navigation", () => {
  const diagnostics = [
    { event: "pageState", targetUrl: "https://example.org/page" },
    { event: "routeChange", activating: "cookies, link" },
    { event: "routeChange", found: true },
    { event: "structureCensus", targetUrl: "https://example.org/page" },
  ];
  assert.equal(censusIdentitySignal(diagnostics), false);
});

test("censusIdentitySignal: no census mark on either side is unmeasured, not agreement", () => {
  assert.equal(censusIdentitySignal([{ event: "routeChange", found: true }]), null);
});

test("classifyRouteChange: agrees when the heading proxy and the announcement both say navigated", () => {
  const result = classifyRouteChange({
    file: "agrees.json",
    route: {
      headingBefore: "main landmark, Search results, heading, level 1",
      headingAfter: "main landmark, Cookies, heading, level 1",
      announced: "Cookies - Example, document",
    },
    diagnostics: [],
  });
  assert.equal(result.headingProxy, true);
  assert.equal(result.announcement, true);
  assert.equal(result.agree, true);
});

test("classifyRouteChange: DISAGREES on the consent-overlay shape -- heading moved, no document was confirmed", () => {
  // `www-lbhf-gov-uk-council-tax.json`, #142's own named example: two consent panels share a heading
  // prefix but differ in the panel name, so the proxy reads a change; the overlay never left the page, so
  // NVDA never announced a new document.
  const result = classifyRouteChange({
    file: "www-lbhf-gov-uk-council-tax.json",
    route: {
      headingBefore: "Consent, property page, Responsible use of your data, heading, level 2",
      headingAfter: "Consent, property page, This website uses cookies, heading, level 2",
      announced: "Loading page",
    },
    diagnostics: [],
  });
  assert.equal(result.headingProxy, true);
  assert.equal(result.announcement, false);
  assert.equal(result.agree, false);
});

test("classifyRouteChange: DISAGREES in the OPPOSITE direction -- a shared header heading masks a real navigation", () => {
  // `www-mygov-scot-benefits.json`'s own shape: the destination's first-from-top heading happens to read
  // identically to the source's (a shared site-chrome heading), so the proxy sees no change even though
  // the title differed and NVDA confirmed a new document -- the mirror image of #142's three named shapes,
  // found only because this row measured rather than assumed the proxy's only failure direction.
  const result = classifyRouteChange({
    file: "www-mygov-scot-benefits.json",
    route: {
      headingBefore: "clickable, Information, heading, level 2",
      headingAfter: "clickable, Information, heading, level 2",
      announced: "Cookies - mygov dot scot, document",
    },
    diagnostics: [],
  });
  assert.equal(result.headingProxy, false);
  assert.equal(result.announcement, true);
  assert.equal(result.agree, false);
});

test("classifyRouteChange: an unmeasured side is null, never folded into agreement or disagreement", () => {
  const result = classifyRouteChange({ file: "no-announcement.json", route: { headingBefore: "a", headingAfter: "b" }, diagnostics: [] });
  assert.equal(result.announcement, null);
  assert.equal(result.agree, null);
});
