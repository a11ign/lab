/**
 * The wrong-page classifier, driven by behaviour.
 *
 * This is the third stale-page detector this project has had. The first measured its own regex; the second
 * flagged a site template shared by every page and reported four of six pages stale, all false. Both were
 * believed because they were read while producing a clean-looking answer, so the rule this file enforces is
 * the one that would have caught them: **show the detector distinguishing a real stale read from a page
 * that merely looks similar.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyCapture } from "./page-identity-rate.mjs";

const cityLibrary = { page: "structure-good.html", signature: /City Library/i };
const faq = { page: "disclosure-good.html", signature: /FAQ|password/i };

test("hearing the page's own signature is correct, whatever came before", () => {
  assert.equal(classifyCapture({
    transcript: ["same page, link, Skip to main content", "banner landmark, City Library"],
    want: cityLibrary, previous: faq,
  }), "correct");
});

test("hearing the PREVIOUS page's signature instead is a wrong page, not a quiet capture", () => {
  assert.equal(classifyCapture({
    transcript: ["FAQ, heading, level 1", "How do I reset my password?, button, collapsed"],
    want: cityLibrary, previous: faq,
  }), "wrong-page");
});

test("an empty transcript is silent, never wrong-page", () => {
  // A mute screen reader on a loaded host produced exactly this, and calling it a stale buffer sent an
  // afternoon after the wrong fault. The repair differs: one restarts NVDA, the other rebuilds the buffer.
  assert.equal(classifyCapture({ transcript: [], want: cityLibrary, previous: faq }), "silent");
  assert.equal(classifyCapture({ transcript: [], want: cityLibrary, previous: null }), "silent");
});

test("browser chrome is unrecognised — it is neither this page nor the last one", () => {
  assert.equal(classifyCapture({
    transcript: ["Welcome to Microsoft Edge"], want: cityLibrary, previous: faq,
  }), "unrecognised");
});

test("the first capture has no predecessor, so a bad read cannot be blamed on one", () => {
  assert.equal(classifyCapture({
    transcript: ["Welcome to Microsoft Edge"], want: cityLibrary, previous: null,
  }), "unrecognised");
});

test("a wrong-page verdict requires the OTHER page's signature, not merely a missing own one", () => {
  // The distinction the second detector got wrong. Absence of your own signature says "we did not hear it";
  // only the presence of another page's says "we read that page". Anything weaker calls a quiet capture a
  // stale buffer, which is an accusation against the navigation for a fault in the speech channel.
  const quiet = classifyCapture({ transcript: ["blank"], want: cityLibrary, previous: faq });
  assert.equal(quiet, "unrecognised");
  assert.notEqual(quiet, "wrong-page");
});

test("pages that SHARE a signature cannot be used to detect staleness", () => {
  // structure-good and structure-bad both announce "City Library", so a stale read of one while asking for
  // the other is indistinguishable from success. This asserts the trap exists, so nobody adds such a pair to
  // PAGES and reads the resulting clean rate as evidence — a canary that cannot express the fault is
  // worthless, which this repo has now learned four times.
  const structureBad = { page: "structure-bad.html", signature: /City Library/i };
  assert.equal(classifyCapture({
    transcript: ["City Library", "Welcome to the City Library"],
    want: structureBad, previous: cityLibrary,
  }), "correct", "a shared signature makes a stale read look correct — this is why PAGES rotates distinct pages");
});
