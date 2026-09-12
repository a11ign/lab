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

import { readFileSync } from "node:fs";

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

/**
 * #1141: COMPARED BY PARSED URL, NEVER BY STRING PREFIX.
 *
 * `url.startsWith(prefix)` held only because the prefix ends in a slash, and **nothing pinned that
 * slash**: dropping it left the suite 9/0 while `https://www.w3.org.evil.invalid/` became invited. One
 * character between a lookalike domain and a real origin, unheld -- worker-capture measured it.
 *
 * `new URL()` does the work a longer prefix string cannot: it resolves `..` before comparison, it puts
 * userinfo (`https://www.w3.org@evil.invalid/`) in `username` rather than `host`, and `origin` is scheme
 * + host + port as one value that cannot be extended by appending characters. **A lookalike host is not a
 * prefix problem to be patched; it is a parsing problem, and parsing is the fix.**
 *
 * PATH CONTAINMENT IS SEPARATE from origin equality and both are required. `/WAI/demos-evil/x` and
 * `/WAI/demosomething/x` are on the invited ORIGIN and outside the invited PATH -- the second is the one
 * the trailing slash was silently doing, and the first is what a sibling directory on w3.org would be.
 *
 * AN UNPARSEABLE URL IS REFUSED, stated rather than left to `try`'s shape: a page whose URL cannot be
 * read is not a page that has been checked, and "could not ask" must never render as "the answer is yes".
 *
 * @param url the page's declared URL
 * @returns true only if it parses AND sits at an invited origin inside an invited path
 */
function isInvited(url: string): boolean {
  // PARSED ONCE, BEFORE THE LOOP, so the refusal is its own statement rather than a branch inside an
  // iteration. My first version parsed per prefix and returned false from the catch -- correct, and
  // UNTESTABLE: with a single entry in `INVITED`, `return false` and `continue` behave identically, so
  // the mutation for this row's clause 2 was 0 RED. **A clause whose two outcomes are indistinguishable
  // at the current population is not held, whatever the code says.**
  //
  // It is still not distinguishable BY THAT MUTATION while `INVITED` has one entry, and saying so is the
  // point. What holds it is the table below asserting the returned value for an unparseable URL
  // directly -- inverting the catch to `return true` is 1 red.
  let page: URL;
  try {
    page = new URL(url);
  } catch {
    return false;
  }
  for (const prefix of INVITED) {
    const invited = new URL(prefix);
    if (page.origin !== invited.origin) continue;
    // DIRECTORY CONTAINMENT, not a string test: `new URL` has already resolved `..`, and the invited
    // pathname ends in `/` -- an invariant the SPOOFS table pins, so dropping that slash is 1 red rather
    // than a silent widening. That slash is why `startsWith` is a boundary here and not a prefix match.
    //
    // worker-capture, reviewing: the `page.pathname === invited.pathname` disjunct this line used to
    // carry is SUBSUMED by `startsWith` -- and it was redundancy, not documentation. Saying it was
    // deliberate would have been the comfortable answer and the wrong one; the sentence above is where
    // the directory-root case belongs.
    if (page.pathname.startsWith(invited.pathname)) return true;
  }
  return false;
}

test("only pages published AS form examples carry a formState", () => {
  const uninvited = configured
    .filter((page: { url: string }) => !isInvited(page.url))
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

// ---------------------------------------------------------------------------------------------------
// #1114: CONSENT AND PROBE ARE ONE DECISION, and the corpus had them apart.
//
// `formState` is the consent; `probeForms` is what makes a capture drive the form. One without the other
// is either a declaration that does nothing (consent, no probe -- the state this row found) or the thing
// the guard above already forbids (probe, no consent). **Both directions, because a guard that catches
// one is half a comparison.**
// ---------------------------------------------------------------------------------------------------

const probed = (REAL_PAGES as { url: string; probeForms?: unknown; formState?: unknown }[])
  .filter((page) => page.probeForms === true);

test("#1114: a page carrying formState also carries probeForms — consent without the probe does nothing", () => {
  const consentedButUnprobed = (configured as { url: string; probeForms?: unknown }[])
    .filter((page) => page.probeForms !== true).map((page) => page.url);
  assert.deepEqual(consentedButUnprobed, [],
    "these record consent to submit and are never submitted, so no capture reaches the status message "
    + "4.1.3 needs. Consent is not the expensive half -- the probe is -- and declaring one without the "
    + `other is a decision nobody made: ${consentedButUnprobed.join(", ")}`);
});

test("#1114: and probeForms is only ever set WITH a formState — the other direction", () => {
  const probedWithoutConsent = (probed as { url: string; formState?: unknown }[])
    .filter((page) => page.formState === undefined).map((page) => page.url);
  assert.deepEqual(probedWithoutConsent, [],
    "these would press submit with no values supplied, which is the thing ADR 0024 says makes submitting "
    + `acceptable in the first place: ${probedWithoutConsent.join(", ")}`);
});

test("#1114: probeForms may only be set on an INVITED origin — asserted by origin, never by heuristic", () => {
  // THE CLAUSE THAT MUST NOT WEAKEN. Setting this key is what causes a POST to a stranger's server --
  // this file's first line -- so it is held the same way `formState` is: an explicit list of origins
  // whose own published purpose is that people submit the form, not a rule like "looks like a demo".
  const uninvited = (probed as { url: string }[])
    .filter((page) => !isInvited(page.url)).map((page) => page.url);
  assert.deepEqual(uninvited, [],
    `these would submit a form on a site nobody invited us to: ${uninvited.join(", ")}`);
});

test("#1114: a consented page's before/after TWIN is shipped, or its absence is declared", () => {
  // #32's evidence is a PAIR: the conformant page announced "Submission Failed" and the inaccessible twin
  // filled ZERO fields because its controls have no accessible names. Only the conformant half shipped,
  // and a positive with no negative is the starvation shape `corpus:starvation` exists to catch.
  //
  // The twin carries NO consent and NO probe, which is not an oversight: the guard above already rules
  // that a formState belongs on the conformant half, because submitting the broken twin would send an
  // empty form. The evidence it carries is that the fields cannot be filled, which needs no submission.
  const urls = new Set(REAL_PAGES.map((page: { url: string }) => page.url));
  const source = readFileSync(new URL("./real-page-corpus.mjs", import.meta.url), "utf8");
  const missing = (configured as { url: string }[])
    .filter((page) => page.url.includes("/after/"))
    .map((page) => page.url.replace("/after/", "/before/"))
    .filter((twin) => !urls.has(twin))
    // DECLARED ABSENCE COUNTS, and it has to be the absence that is declared rather than the subject:
    // the twin's own URL must appear in the corpus file's prose. `before/survey.html` is already an eval
    // TEST fixture -- `real-page-corpus.test.ts` refused it when I added it -- so under ADR 0010 shipping
    // it here would train on a held-out page. The declaration is where that reasoning lives.
    .filter((twin) => !source.includes(twin));
  assert.deepEqual(missing, [],
    "these consented pages have no inaccessible twin in the corpus AND no note saying why, so a capture "
    + `round over them produces a positive with no negative and nothing records that: ${missing.join(", ")}`);
});

test("the guard can see something, or it proves nothing", () => {
  assert.ok(configured.length > 0,
    "no real page carries a formState — either 4.1.3's grounding was removed, or this test is reading "
    + "the wrong field and would pass over anything");
  // #1114: AND THE SAME FOR THE PROBE. Three of the four clauses above are `deepEqual(x, [])`, which an
  // empty `probed` satisfies by construction -- so without this, removing every `probeForms` from the
  // corpus reads as four green guards rather than as the state this row exists to end.
  assert.ok(probed.length > 0,
    "no real page is probed, so every probeForms clause above is vacuous — that is the state #1114 "
    + "found, and it must not be able to return silently");
});

// ---------------------------------------------------------------------------------------------------
// #1141: THE SPOOF TABLE, with each row said to be NEWLY-caught or ALREADY-caught.
//
// The first two the string-prefix guard already rejected, and they are here BECAUSE of that: a fix must
// not be credited with catching what was never getting through. The ones the parse actually buys are the
// sibling path, the prefix-extension path, and the `..` traversal.
// ---------------------------------------------------------------------------------------------------

const SPOOFS: Array<[url: string, invited: boolean, note: string]> = [
  ["https://www.w3.org.evil.invalid/WAI/demos/x.html", false,
    "ALREADY-caught — lookalike host. The old prefix rejected it only because the prefix ends in `/`; "
    + "drop that character and it was invited. `origin` cannot be extended by appending characters."],
  ["https://www.w3.org@evil.invalid/WAI/demos/x.html", false,
    "ALREADY-caught — userinfo host. `new URL` puts `www.w3.org` in `username`, never in `host`."],
  ["https://www.w3.org/WAI/demos-evil/x.html", false,
    "NEWLY-caught — sibling path on the invited ORIGIN. This is what the trailing slash was doing "
    + "silently, and it is the one a compromised or unrelated w3.org directory would look like."],
  ["https://www.w3.org/WAI/demosomething/x.html", false,
    "NEWLY-caught — prefix-extension path. `/WAI/demos` is a prefix of `/WAI/demosomething`; "
    + "`/WAI/demos/` is not a prefix of it."],
  ["https://www.w3.org/WAI/demos/../../private/x.html", false,
    "NEWLY-caught — `..` traversal. `new URL` NORMALISES the path before comparison, so this resolves to "
    + "`/private/x.html` and fails containment. A string prefix compares the unresolved text and admits it."],
  ["https://www.w3.org", false,
    "NEWLY-caught — bare host, no path. `pathname` is `/`, which is not inside `/WAI/demos/`."],
  ["https://www.w3.org/WAI/demos/bad/after/survey.html", true,
    "the genuine invited page — the control, without which every row above is satisfied by a guard that "
    + "only ever says no."],
  ["not a url at all", false,
    "unparseable is REFUSED, never skipped: a page whose URL cannot be read has not been checked, and "
    + "'could not ask' must not render as 'the answer is yes'."],
];

test("#1141: every spoof shape is judged by the parsed URL, and the genuine page still passes", () => {
  const wrong = SPOOFS.filter(([url, invited]) => isInvited(url) !== invited)
    .map(([url, invited, note]) => `${url} -> expected ${invited}: ${note}`);
  assert.deepEqual(wrong, [], `these were judged wrongly:\n  ${wrong.join("\n  ")}`);
  assert.ok(SPOOFS.some(([, invited]) => invited),
    "the table contains no invited URL, so a guard that returned false for everything would pass it");
});

test("#1141: the TRAILING SLASH is no longer load-bearing — the row's own mutation", () => {
  // 0 red before this row: dropping the slash left the suite green while `www.w3.org.evil.invalid`
  // became invited. It is not load-bearing now because `origin` is compared as a whole value, so this
  // asserts the property directly rather than re-running the mutation.
  const withoutSlash = "https://www.w3.org/WAI/demos";
  const page = new URL("https://www.w3.org.evil.invalid/WAI/demos/x.html");
  assert.notEqual(page.origin, new URL(withoutSlash).origin,
    "a lookalike host must differ by ORIGIN, so no amount of prefix trimming can admit it");
  assert.equal(isInvited("https://www.w3.org.evil.invalid/WAI/demos/x.html"), false);
});

test("#1141: the four real invited corpus pages still pass — derived, not a floor", () => {
  const invited = REAL_PAGES.filter((p: { url: string }) => isInvited(p.url)).map((p: { url: string }) => p.url);
  assert.equal(invited.length, REAL_PAGES.filter((p: { url: string }) =>
    p.url.startsWith("https://www.w3.org/WAI/demos/")).length,
  "every page the old string prefix accepted must still be accepted — this fix tightens the boundary, "
  + "and a tightening that drops a genuine page is a different change from the one this row asked for");
  assert.ok(invited.length > 0, "no invited page is accepted, so the assertion above compares zero to zero");
});
