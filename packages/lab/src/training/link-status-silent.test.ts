import assert from "node:assert/strict";
import test from "node:test";
import { linkStatusIsSilent } from "./case-matrix.mjs";

/**
 * `linkStatusIsSilent` is the predicate behind item 3 of the gap register: a live region fired by a LINK.
 *
 * It exists on the link path and not the checkbox one for a measured reason. Across six repeats each:
 * a button firing a polite region is heard **6/6**, a link **6/6**, a checkbox **2/6**. NVDA drops a
 * pending polite announcement while it is already speaking, and a link -- like a button and unlike a
 * checkbox -- has no state of its own to speak first. The checkbox case was withdrawn; this one ships.
 *
 * Every assertion below is a MUTATION of the shipped predicate. Four of its five branches return `false`
 * for a reason no corpus capture exercises, so without these the guard would be trusted having never been
 * seen to fail -- which is how 604 logged crashes came to read as pages with nothing to say.
 */
test("the announced page response is the finding", () => {
  const pressed = { control: "Show bags only, same page, link", navigated: true };
  assert.equal(linkStatusIsSilent({ ...pressed, announced: "" }), true,
    "the page answered nothing -- this IS the 4.1.3 failure");
  assert.equal(linkStatusIsSilent({ ...pressed, announced: "Showing 2 bags." }), false,
    "the status was announced, so the page is conformant");
});

test("a link's OWN state is not a page response", () => {
  const pressed = { control: "Show bags only, link", navigated: true };
  // `probeRouteChange`'s comment records the real page this defends against: the stale-title page
  // announced "visited", which names the link's state and nothing about where the user now is.
  for (const own of ["visited", "clickable", "same page", "visited | clickable"]) {
    assert.equal(linkStatusIsSilent({ ...pressed, announced: own }), true,
      `"${own}" is the link's own state, not the page's answer`);
  }
  assert.equal(linkStatusIsSilent({ ...pressed, announced: "visited | Showing 2 bags." }), false,
    "a real announcement alongside the link's state is still a real announcement");
});

test("four ways of NOT having asked, none of which is silence", () => {
  // The rule this repo has paid for four times: an absence that means "we could not ask" must never be
  // read as an absence that means "the page said nothing". Both look like an empty field.
  assert.equal(linkStatusIsSilent(undefined), false, "probeNavigation never ran");
  assert.equal(linkStatusIsSilent({ control: null, announced: "", navigated: false }), false,
    "no link on the page to press");
  assert.equal(linkStatusIsSilent({ control: "x", announced: null, error: "timed out" }), false,
    "the measurement errored -- a failed measurement is not a silent page");
  assert.equal(linkStatusIsSilent({ control: "x", announced: null }), false,
    "`null` is probeRouteChange's error sentinel and is not an empty string");
});
