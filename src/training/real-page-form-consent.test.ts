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
/**
 * #1175: THE SECOND ORIGIN, and its publisher's sentence with the URL it is quoted from.
 *
 * Sauce Labs publishes the-internet as an application to drive: *"An example application that captures
 * prominent and ugly functionality found on the web. **Perfect for writing automated acceptance tests
 * against.**"* — `github.com/saucelabs/the-internet`, `README.md`.
 *
 * `/login` posts to `/authenticate`; #1169 measured a real POST returning 303 → 200 with a server-rendered
 * `Your username is invalid!` and no state change, and the error div carries no `role="alert"` and no
 * `aria-live`. **That is a fact about this page, not a category** — the same standard the entry above is
 * held to, and the reason both entries carry their evidence rather than their conclusion.
 *
 * A TRAILING SLASH MEANS A DIRECTORY; ITS ABSENCE MEANS EXACTLY THIS PAGE. See `isInvited`.
 */
const INVITED = ["https://www.w3.org/WAI/demos/", "https://the-internet.herokuapp.com/login"];

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
    // #1175: A DIRECTORY PREFIX ENDS IN `/`; AN ENTRY THAT DOES NOT IS EXACTLY ONE PAGE.
    //
    // Every entry until now was a directory, so `startsWith` on a normalised pathname was a containment
    // test and the trailing slash was the boundary -- #1141's finding, pinned by the SPOOFS table below.
    // **The second origin is a single page, and `startsWith("/login")` invites `/login-evil` and
    // `/login/evil`.** Measured before this branch was written; it is #1141's defect returning through a
    // door that row did not have, because it had no page-scoped entry to return through.
    //
    // So the slash is now READ rather than merely relied on: with one, containment; without one, equality.
    // Both spellings say what they mean, and neither can widen by accident.
    const directory = invited.pathname.endsWith("/");
    if (directory ? page.pathname.startsWith(invited.pathname) : page.pathname === invited.pathname) {
      return true;
    }
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

/**
 * #1175: A PROXY RETIRED, NOT A BAR LOWERED — `ceo`'s ruling, and the argument is the reason it is safe.
 *
 * This was `publishedClaim === "conformant"`, with the reason: *"the `before/` twin filled ZERO fields
 * because its controls have no accessible names, so a formState there would submit an empty form and
 * report on it."* **That is a claim about the CONTROLS, and the published claim was standing in for it** —
 * measured on W3C's before/after pair, the one place where proxy and property coincide.
 *
 * #1169 chose `the-internet.herokuapp.com/login` as the non-conformant 4.1.3 half the training role
 * lacked, and it **breaks the coincidence**: its controls are properly labelled and it is non-conformant
 * in exactly one respect — an error rendered with no live region — which is the respect it was chosen for.
 * The proxy blocked it for a property it does not have, which is a guard failing for a reason unrelated to
 * what it claims.
 *
 * **So the guard now asserts the property directly**: every field a `formState` names must correspond to a
 * labelled control in the page's own markup. The consent half is untouched — `INVITED` decides whether we
 * may submit at all, and this decides only whether the fields we named can be filled.
 *
 * CAPTURED, NOT FETCHED AT TEST TIME. The acceptance job has no network and a test that reaches the
 * internet is one that fails for reasons unrelated to the code. The labels below were read from each
 * page's own `<form>` on 2026-09-12, with the URL beside them, so the next reader can re-run the same
 * `curl` and compare rather than re-gather.
 *
 * THE NEGATIVE CONTROL IS THE PAGE THE OLD RULE WAS MEASURED ON. `before/survey.html` has **zero**
 * `<label>` elements in its form — every input is bare — so a `formState` there still refuses, and the
 * case that justified the proxy is the case that proves the replacement.
 */
const CAPTURED_FORM_LABELS: Record<string, string[]> = {
  // curl 2026-09-12, `sed -n '/<form/,/<\/form>/p' | grep -oE '<label[^>]*>[^<]*'`
  "https://www.w3.org/WAI/demos/bad/after/survey.html": ["Explore Site by Topic:", "None", "Central Park",
    "Grand Park", "Jurassic Park", "South Park", "Other", "Mr.", "Mrs.", "Name:", "eMail Address:",
    "Retype eMail:"],
  "https://www.w3.org/WAI/demos/bad/before/survey.html": [],
  "https://the-internet.herokuapp.com/login": ["Username", "Password"],
};

/**
 * MATCHED AFTER NORMALISATION, because `field` is what NVDA ANNOUNCES and the table is what the page
 * CONTAINS, and the two differ in ways that mean nothing: the corpus names `e Mail Address:` where the
 * markup says `eMail Address:`. Comparing them literally would fail on the one entry that has worked
 * since #32 — a guard that refuses the case it was built from is not a guard.
 */
const sameControl = (a: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "");

test("#1175: every field a formState names is a LABELLED control on the page — the property, not a proxy", () => {
  for (const page of configured as { url: string; formState: { fields: { field: string }[] } }[]) {
    const labels = CAPTURED_FORM_LABELS[page.url];
    assert.ok(labels !== undefined,
      `${page.url} carries a formState and no captured label list. Capture one before consenting: a form `
      + "whose controls nobody has looked at is a form nobody can say is fillable.");
    assert.ok(labels.length > 0,
      `${page.url}'s form has NO labelled controls, so a formState there submits an empty form and reports `
      + "on it. This is `before/survey.html`'s measured failure and the reason this guard exists.");
    for (const { field } of page.formState.fields) {
      assert.ok(labels.some((l) => sameControl(l) === sameControl(field)),
        `${page.url} names the field "${field}", which matches no label on the page: `
        + `${labels.join(", ")}. A field that does not match fills nothing, and a capture that filled `
        + "nothing reports silence — indistinguishable from a form that announced nothing.");
    }
  }
});

test("#1175 NEGATIVE CONTROL: the page the old rule was measured on still refuses", () => {
  // `before/survey.html` is deliberately absent from the corpus (#1114, it is an eval fixture), so this
  // drives the guard's predicate directly rather than through `configured` — otherwise the control would
  // be a claim about a page the loop never sees.
  const bare = CAPTURED_FORM_LABELS["https://www.w3.org/WAI/demos/bad/before/survey.html"];
  assert.deepEqual(bare, [],
    "if this page ever grows labels, the negative control is gone and this guard is asserting nothing");
  assert.equal(bare.some((l) => sameControl(l) === sameControl("Name:")), false,
    "the conformant twin's own field name must NOT match anything here — the two pages are the same form "
    + "and only one of them can be filled, which is the whole distinction this guard draws");
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

  // #1175: THE SECOND ORIGIN, and it is a PAGE rather than a directory -- which is a door #1141 did not
  // have. Every entry until now ended in `/`, so `startsWith` was containment and the slash was the
  // boundary; `/login` has no slash, and a prefix test invites `/login-evil` and `/login/evil`. Measured
  // before the fix, all three read `true`. `isInvited` now READS the slash: with one, containment;
  // without one, equality.
  ["https://the-internet.herokuapp.com/login", true,
    "the genuine invited page on the second origin -- the control, without which every row below is "
    + "satisfied by a guard that only ever says no."],
  ["https://the-internet.herokuapp.com/login-evil", false,
    "NEWLY-caught -- prefix-extension on a PAGE-scoped entry. `/login` is a prefix of `/login-evil`, and "
    + "there is no trailing slash to stop it. This is #1141's defect at its second door."],
  ["https://the-internet.herokuapp.com/login/evil", false,
    "NEWLY-caught -- a child path of a page-scoped entry. `/login` names one page, not a directory, so "
    + "nothing beneath it is invited either."],
  ["https://the-internet.herokuapp.com/upload", false,
    "a SIBLING path on the invited host -- the row's clause 3, and the direction a second origin doubles. "
    + "The host is invited for ONE page; consent is not a property of the host."],
  ["https://the-internet.herokuapp.com/", false,
    "the origin root itself is not invited, because `/login` is what was argued for on #1169 and nothing "
    + "else on this site has been read."],
  ["https://the-internet.herokuapp.com.evil.invalid/login", false,
    "ALREADY-caught -- lookalike host on the new origin, by `origin` equality rather than by the path."],
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
  // #1175: DERIVED FROM `INVITED`, not from one entry's literal. The first version compared against
  // `startsWith("https://www.w3.org/WAI/demos/")` — correct while that was the only entry, and a second
  // origin makes it compare a two-origin population to a one-origin count. **A guard that restates one
  // member of a list cannot survive the list growing**, which is #1158's lesson arriving here by itself.
  const invited = REAL_PAGES.filter((p: { url: string }) => isInvited(p.url)).map((p: { url: string }) => p.url);
  const byPrefix = REAL_PAGES.filter((p: { url: string }) =>
    INVITED.some((entry) => p.url.startsWith(entry))).map((p: { url: string }) => p.url);
  assert.deepEqual(invited.sort(), byPrefix.sort(),
    "every page the old string prefix accepted must still be accepted — this fix tightens the boundary, "
    + "and a tightening that drops a genuine page is a different change from the one this row asked for");
  assert.ok(invited.length > 0, "no invited page is accepted, so the assertion above compares zero to zero");
  // NO ASSERTION THAT EVERY `INVITED` ENTRY HAS A PAGE, and the reason is a decision rather than an
  // oversight. I wrote one -- *"a consent granted to a page the corpus does not contain is a permission
  // nobody needed"* -- and #1175 is the counter-example: `ceo` ruled that the consent for
  // `the-internet.herokuapp.com/login` ships now, with its publisher sentence and its measured POST, while
  // the corpus entry waits on a MEASUREMENT of what it does to ADR 0015's why-2 distance figures.
  //
  // **A consent that precedes its page is inert** -- nothing is submitted to a page the corpus does not
  // contain -- so the assertion would have refused a correct state to prevent an imaginary one. The
  // property that matters is the opposite direction, and it is the one above: no page is submitted to
  // without an entry inviting it.
});
