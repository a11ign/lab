// A `formState` IN THIS CORPUS SUBMITS A FORM ON SOMEBODY ELSE'S LIVE SITE.
//
// `probeForms` is off for every real-page capture because pressing *Book* on a site we do not own is not
// a review — `SECURITY.md`'s line, and the CLI follows it too. ADR 0024's answer is that supplying the
// values is what makes submitting acceptable, and a `formState` declared beside a URL is that consent
// recorded in the corpus.
//
// Which makes this the one place in the repo where adding a data structure causes a POST to a stranger's
// server. This test is the guard on that, and it is deliberately about WHOSE page rather than about
// whether the config parses.
import { test } from "node:test";
import assert from "node:assert/strict";

import { REAL_PAGES } from "./real-page-corpus.mjs";

const configured = REAL_PAGES.filter((page: { formState?: unknown }) => page.formState !== undefined);

/**
 * Origins whose OWN PUBLISHED PURPOSE is that people submit the form.
 *
 * W3C's `demos/bad` pages are its own broken-and-fixed pair, published as examples to try; the submission
 * is inert and both versions are the same form. That is a fact about those pages, not a category — which
 * is why this is an explicit list and not a heuristic like "looks like a demo".
 */
const INVITED = ["https://www.w3.org/WAI/demos/"];

test("only pages published AS form examples carry a formState", () => {
  const uninvited = configured
    .filter((page: { url: string }) => !INVITED.some((prefix) => page.url.startsWith(prefix)))
    .map((page: { url: string }) => page.url);
  assert.deepEqual(uninvited, [],
    "A formState submits this form on a live site every time the real-page corpus is captured. It is "
    + "allowed only where the page's own publisher put it there to be submitted. Widening this list is a "
    + "SECURITY.md decision argued on its own — never a way to make a criterion easier to reach.");
});

test("a configured page is one the publisher calls CONFORMANT", () => {
  // The failing half of a pair is somebody's example of a broken form, and submitting it teaches nothing
  // 4.1.3 needs — the conformant half is where a status message is supposed to appear. Measured: the
  // `before/` twin filled ZERO fields because its controls have no accessible names, so a formState there
  // would submit an empty form and report on it.
  for (const page of configured as { url: string; publishedClaim: string }[]) {
    assert.equal(page.publishedClaim, "conformant",
      `${page.url} is published as ${page.publishedClaim}; a formState belongs on the conformant half`);
  }
});

test("every configured state names a submit control and at least one field", () => {
  // The worker shape-checks these too, and shallowly on purpose. This is the place that can say WHY a
  // malformed one is wrong, because it can see the URL it would be sent to.
  for (const page of configured as { url: string; formState: Record<string, unknown> }[]) {
    const state = page.formState;
    assert.match(String(state.state), /^(error|success)$/, `${page.url}: state must be error or success`);
    assert.ok(typeof state.submit === "string" && state.submit !== "", `${page.url}: no submit control`);
    assert.ok(Array.isArray(state.fields) && state.fields.length > 0, `${page.url}: no fields`);
  }
});

test("no configured state COMPLETES a form", () => {
  // The line that matters most. An `error` state is rejected by design; a `success` state books the room,
  // sends the message, or takes the booking — on somebody else's site, on every corpus run, for ever.
  // Nothing in this corpus may do that, whatever the page's publisher intended.
  const completing = (configured as { url: string; formState: { state: string } }[])
    .filter((page) => page.formState.state === "success")
    .map((page) => page.url);
  assert.deepEqual(completing, [],
    "A `success` state completes the form. In the CLI that is the user's own decision about their own "
    + "site; here it would run on every capture of the real-page corpus, against a site nobody involved "
    + "owns.");
});

test("the guard can see something, or it proves nothing", () => {
  assert.ok(configured.length > 0,
    "no real page carries a formState — either 4.1.3's grounding was removed, or this test is reading "
    + "the wrong field and would pass over anything");
});
