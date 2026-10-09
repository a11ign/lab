// @ts-check
/**
 * Page templates: HTML string builders for the good/bad pages a case pairs together.
 *
 * Pure functions of their own parameters — no capture, no case-authoring field, no furniture. `page()`
 * wraps a title/heading/body into a full document; everything else here returns a body fragment for one
 * case's `good`/`bad` markup. Split out of `case-matrix.mjs`, where these builders sat interleaved with
 * the `cases.push(pair({...}))` calls that use them, at whatever line the case that first needed one
 * happened to be written.
 */

const BASE_STYLE = [
  "body { font: 16px system-ui, sans-serif; line-height: 1.5; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }",
  "main { display: grid; gap: 1rem; }",
  "img { display: block; max-width: 100%; margin: 1rem 0; }",
  "label { display: block; margin-top: .75rem; }",
  "input, button, select { font: inherit; padding: .4rem; }",
  ".card { border: 1px solid #bbb; padding: 1rem; }",
  ".fake-heading { font-size: 1.4rem; font-weight: 700; margin-top: 1rem; }",
  ".error { color: #9b1c1c; margin-top: .5rem; }",
  "[hidden] { display: none; }",
].join("");

export const escapeHtml = (/** @type {any} */ value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

/**
 * `heading` may be FALSE, for a page that genuinely has none.
 *
 * It was unconditional, and that one line is why `1.3.1`'s missing-headings rule could never fire on
 * anything: every generated page carried an `h1` by construction, so across 2,366 records the count with
 * zero headings was 0 and the gate reported "NEVER FIRED ANYWHERE — the claim rests on nothing". A page
 * with no headings at all is a real and common failure — a screen reader user skims BY heading, so a page
 * without any forces a line-by-line read to find anything — and the corpus simply could not express it.
 */
export function page(/** @type {any} */ { title, heading, body, script = "", landmark = true }) {
  const content = (heading ? "<h1>" + escapeHtml(heading) + "</h1>" : "") + body;
  const container = landmark ? "<main>" + content + "</main>" : content;
  return "<!doctype html>\n"
    + "<html lang=\"en\">\n"
    + "<head><meta charset=\"utf-8\"><title>" + escapeHtml(title)
    + "</title><style>" + BASE_STYLE + "</style></head>\n"
    + "<body>" + container + "\n"
    + (script ? "<script>" + script + "</script>" : "")
    + "</body></html>";
}

/**
 * A status message fired by a LINK — item 3's first-named control, and the one that works.
 *
 * `probeNavigation` already activates the first link on the page and `routeChange.announced` already
 * records what was said, so this needs no new consent and no new field: the press is one this tool already
 * performs and `SECURITY.md` already sanctions.
 *
 * MEASURED, six repeats: the region is heard **6 of 6**. That is the same rate as a BUTTON and unlike a
 * checkbox's 2 of 6, for the reason §18 records — a link has no state, so NVDA says nothing of its own and
 * the live region is the only thing in the queue. The checkbox case had to be withdrawn because NVDA drops
 * a polite region while it is already speaking; a link never puts it in that position.
 *
 * The pair differs in the live region and nothing else — same link, same handler, same message.
 *
 * @param {boolean} announced
 */
export function LINK_STATUS_PAGE(announced) {
  const region = announced
    ? "<p id=\"count\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">Showing 8 products.</p>"
    : "<p id=\"count\">Showing 8 products.</p>";
  return "<p><a href=\"#bags\" id=\"bags\">Show bags only</a></p>"
    + region
    + "<ul id=\"products\"><li>Canvas bag</li><li>Travel bag</li></ul>"
    // `preventDefault`, so the link filters in place rather than navigating. That is the shape this
    // criterion is about, and it keeps the probe on the page it is measuring.
    + "<script>document.querySelector('#bags').addEventListener('click', function (event) {"
    + "event.preventDefault();"
    + "document.querySelector('#count').textContent = 'Showing 2 bags.';"
    + "});</script>";
}

/**
 * The 2.4.3 fixture: the same five fields in the same reading order, differing only in tab order.
 *
 * A function rather than two literals so the pair cannot drift apart in any other respect. The one
 * difference between the variants must be the thing under test — this corpus's central constraint, and the
 * reason page furniture is injected identically into both.
 */
export function FOCUS_ORDER_FORM(/** @type {any} */ mode) {
  const tab = (/** @type {any} */ n) => (mode === " tabindex-trap" ? ` tabindex="${n}"` : "");
  return "<form>"
    + "<label for=\"a\">Full name</label><input id=\"a\" name=\"a\">"
    + "<label for=\"b\">Email</label><input id=\"b\" name=\"b\">"
    + `<label for="c">Postcode</label><input id="c" name="c"${tab(2)}>`
    + `<label for="d">Phone</label><input id="d" name="d"${tab(1)}>`
    + "<label for=\"e\">Notes</label><input id=\"e\" name=\"e\">"
    + "</form>";
}

/**
 * The second 2.1.2 fixture: the same five fields, wrapped in a named group the trap can watch.
 *
 * One function used by BOTH variants, with no parameter — the trap is a script and the markup is
 * byte-identical either side. That is stronger than the parameterised helpers above, which still take an
 * argument that could in principle diverge, and it is the right shape whenever the defect is behavioural
 * rather than structural: the pair then provably differs in exactly one place.
 */
/**
 * A page whose dialog holds THREE controls while FOUR more sit behind it.
 *
 * The proportion is the point. A cycling focus trap is told from a conformant tab wrap by the cycle
 * covering a strict SUBSET of the page's controls, so a dialog holding most of the page would shrink that
 * difference to nothing. Three of seven leaves it unambiguous, which is what a canary is for.
 */
/**
 * A dialog holding four controls, with four form fields behind it.
 *
 * @param {boolean} withCloseButton replaces the dialog's LAST text field with a Close button, so the ring stays the
 *   same SIZE and differs only in what it offers. That is the whole control: three earlier rules keyed on
 *   ring size and were refuted by consent banners, whose rings are small too.
 */
export function MODAL_TRAP_FORM(withCloseButton) {
  const last = withCloseButton
    ? "<button type=\"button\" id=\"m4\" onclick=\"trapped = false;"
      + " document.getElementById('confirm').hidden = true;"
      + " document.getElementById('a').focus();\">Close</button>"
    : "<label for=\"m4\">County</label><input id=\"m4\" name=\"m4\">";
  return "<form>"
    + "<label for=\"a\">Full name</label><input id=\"a\" name=\"a\">"
    + "<label for=\"b\">Email</label><input id=\"b\" name=\"b\">"
    + "<label for=\"d\">Phone</label><input id=\"d\" name=\"d\">"
    + "<label for=\"e\">Delivery notes</label><input id=\"e\" name=\"e\">"
    + "</form>"
    + "<div id=\"confirm\" role=\"dialog\" aria-label=\"Confirm address\">"
    + "<label for=\"m1\">House number</label><input id=\"m1\" name=\"m1\">"
    + "<label for=\"m2\">Street</label><input id=\"m2\" name=\"m2\">"
    + "<label for=\"m3\">Town</label><input id=\"m3\" name=\"m3\">"
    + last
    + "</div>";
}

/**
 * The focus guard BOTH variants carry — the ARIA modal pattern, keeping Tab inside the dialog.
 *
 * `focusin` on the document, deferred with a microtask because moving focus during focus-event dispatch is
 * ignored by Chromium — the same reason `keyboard-trap-blur-revalidate` defers.
 */
export const MODAL_FOCUS_GUARD = "var trapped = true;"
  + "document.addEventListener('focusin', (event) => {"
  + "  if (!trapped) return;"
  + "  const dialog = document.getElementById('confirm');"
  + "  if (!dialog.contains(event.target)) {"
  + "    queueMicrotask(() => document.getElementById('m1').focus());"
  + "  }"
  + "});";

/*
 * A dialog whose ONLY way out is the Escape key, present on one variant and absent on the other.
 *
 * `keyboard-trap-modal-cycle` cannot express this and it took a capture to see why. Its conformant variant
 * escapes by a Close BUTTON inside the ring -- the APG pattern, correct -- so neither of its pages handles
 * Escape and `dialogEscape` came back byte-identical on both. A canary that cannot express the fault is
 * worthless, and the fault this one exists for is the one WCAG 2.1.2 actually names: *"if focus can be
 * moved away using only a keyboard, the user is told the method"*. Escape IS that method for a dialog.
 *
 * The two pages differ in ONE handler and nothing else -- same ring, same fields, same size, same guard --
 * so anything that discriminates them is reading the escape route rather than the shape of a modal. Three
 * earlier trap rules were exact on the corpus and wrong on the web precisely because they read the shape.
 */
export function MODAL_ESCAPE_FORM() {
  return "<form>"
    + "<label for=\"a\">Full name</label><input id=\"a\" name=\"a\">"
    + "<label for=\"b\">Email</label><input id=\"b\" name=\"b\">"
    + "<label for=\"d\">Phone</label><input id=\"d\" name=\"d\">"
    + "<label for=\"e\">Delivery notes</label><input id=\"e\" name=\"e\">"
    + "</form>"
    + "<div id=\"confirm\" role=\"dialog\" aria-label=\"Confirm address\">"
    + "<label for=\"m1\">House number</label><input id=\"m1\" name=\"m1\">"
    + "<label for=\"m2\">Street</label><input id=\"m2\" name=\"m2\">"
    + "<label for=\"m3\">Town</label><input id=\"m3\" name=\"m3\">"
    + "<label for=\"m4\">County</label><input id=\"m4\" name=\"m4\">"
    + "</div>";
}

// Releases the trap on Escape and moves focus OUT, which is what makes the dialog leaveable.
//
// SCOPED TO FOCUS BEING INSIDE THE DIALOG, and that is not decoration -- it is what a real dialog does,
// and without it this pair proves nothing. `anchorToTop` presses Escape as its FIRST action on every
// capture, long before any probe observes anything. Measured 2026-09-01 with a document-level handler:
// the trap was released before the focus probe ran, so the conformant ring walked the whole page (7 stops
// through the main form and the links) while the failing one cycled the four dialog fields. The pair then
// differed by RING SHAPE, which is exactly the confound `keyboard-trap-modal-cycle`'s comment records
// three withdrawn rules for -- a rule fitted to it learns "is there a modal" and accuses consent banners.
//
// Scoped, the early Escape is a no-op because focus is still on the body, both rings are confined and
// identical, and the only thing that differs is what Escape does once you are inside.
export const MODAL_ESCAPE_RELEASES = MODAL_FOCUS_GUARD
  + "document.addEventListener('keydown', (event) => {"
  + "  if (event.key !== 'Escape') return;"
  + "  const dialog = document.getElementById('confirm');"
  + "  if (!dialog.contains(document.activeElement)) return;"
  + "  trapped = false;"
  + "  dialog.hidden = true;"
  + "  document.getElementById('a').focus();"
  + "});";


/*
 * `MODAL_TRAP_TOTAL_FORM` and its case `keyboard-trap-modal-total` stood here on 2026-08-28: a dialog
 * holding EVERY form field, with six links outside it. It demonstrated the gap `keyboard-trap-modal-cycle`
 * names — the form-field denominator goes silent when the dialog holds them all — and the tab-stop
 * denominator built to detect it was withdrawn the same day, so the case had no signal that could fire and
 * `check-signals` correctly reported it BLIND.
 *
 * REMOVED rather than left blind, because a case whose signal cannot fire is a training record with no
 * discriminating evidence, which is what that gate exists to refuse. Recorded here rather than only in git
 * so the shape is re-creatable: the page is the point, and it will be needed the moment a probe can ask
 * whether Escape releases focus. `docs/reliability-plan.md` A3 carries the measurements.
 */

export function TRAP_FIELDSET_FORM() {
  return "<form><fieldset id=\"addr\"><legend>Address</legend>"
    + "<label for=\"a\">Full name</label><input id=\"a\" name=\"a\">"
    + "<label for=\"b\">Email</label><input id=\"b\" name=\"b\">"
    + "<label for=\"c\">Postcode</label><input id=\"c\" name=\"c\">"
    + "<label for=\"d\">Phone</label><input id=\"d\" name=\"d\">"
    + "<label for=\"e\">Notes</label><input id=\"e\" name=\"e\">"
    + "</fieldset></form>";
}

/**
 * The 2.4.1 fixture: a skip link, a block of repeated navigation, then the content.
 *
 * `targetId` is the ONLY difference. The good variant's link points at the content wrapper, which carries
 * `tabindex="-1"` so focus can actually land on it; the bad variant points at an id that no element has —
 * a renamed or typo'd anchor, which is how this breaks in the wild and exactly what a static checker waves
 * through: it sees a link, a plausible fragment href and a page full of content.
 */
export function SKIP_LINK_PAGE(/** @type {any} */ targetId, /** @type {string} */ targetAttrs = ' tabindex="-1"') {
  return `<a href="#${targetId}">Skip to main content</a>`
    + "<nav><ul>"
    + "<li><a href=\"/news\">News and updates</a></li>"
    + "<li><a href=\"/events\">Events calendar</a></li>"
    + "<li><a href=\"/contact\">Contact the team</a></li>"
    + "</ul></nav>"
    + `<div id="content"${targetAttrs}>`
    + "<label for=\"q\">Search the archive</label><input id=\"q\" name=\"q\">"
    + "</div>";
}

/** The target exists in the markup and is REMOVED before the user reaches the link. */
export function SKIP_LINK_REPLACED_PAGE(/** @type {boolean} */ removesTarget) {
  return "<a href=\"#content\">Skip to main content</a>"
    + "<nav><ul>"
    + "<li><a href=\"/news\">News and updates</a></li>"
    + "<li><a href=\"/events\">Events calendar</a></li>"
    + "<li><a href=\"/contact\">Contact the team</a></li>"
    + "</ul></nav>"
    + "<div id=\"content\" tabindex=\"-1\">"
    + "<label for=\"q\">Search the archive</label><input id=\"q\" name=\"q\">"
    + "</div>"
    // A client-side render that replaces the container it was given. The href resolved when the page was
    // authored and does not when the link is used, which no markup check can see.
    + (removesTarget
      ? "<script>var c = document.getElementById('content');"
        + "var fresh = c.cloneNode(true); fresh.removeAttribute('id');"
        + "c.parentNode.replaceChild(fresh, c);</script>"
      : "");
}

/** Two elements share the id, and the FIRST one sits above the navigation. */
export function SKIP_LINK_DUPLICATE_ID_PAGE(/** @type {boolean} */ duplicated) {
  return "<a href=\"#content\">Skip to main content</a>"
    // The decoy carries the same id and no content. `getElementById` and fragment navigation both take
    // the FIRST match, so the jump lands here — above the nav, which is still ahead of the user.
    + (duplicated ? "<div id=\"content\" tabindex=\"-1\"></div>" : "")
    + "<nav><ul>"
    + "<li><a href=\"/news\">News and updates</a></li>"
    + "<li><a href=\"/events\">Events calendar</a></li>"
    + "<li><a href=\"/contact\">Contact the team</a></li>"
    + "</ul></nav>"
    + "<div id=\"content\" tabindex=\"-1\">"
    + "<label for=\"q\">Search the archive</label><input id=\"q\" name=\"q\">"
    + "</div>";
}

/**
 * The 2.1.1 fixture: an action the screen reader announces as a button, which Tab may or may not reach.
 *
 * `tabindex` is the only difference. Both variants announce identically — same role, same name, same
 * position — so the pair differs solely in whether a keyboard can operate the control. That is the whole
 * criterion, and it is invisible to the announcement itself.
 *
 * Placed FIRST in the body on purpose. The focus probe stops after a fixed number of Tab presses (measured:
 * every corpus page truncates at 12), so "absent from the tab order" is ambiguous at the tail — it usually
 * just means the probe stopped. A control near the top is one the probe would certainly have reached.
 */
export function KEYBOARD_ACTION_PAGE(/** @type {any} */ focusable) {
  const tab = focusable ? ' tabindex="0"' : "";
  return `<div role="button"${tab} aria-label="Delete draft" class="card">Delete draft</div>`
    + "<form>"
    + "<label for=\"a\">Full name</label><input id=\"a\" name=\"a\">"
    + "<label for=\"b\">Email</label><input id=\"b\" name=\"b\">"
    + "</form>";
}

/**
 * The second 2.1.1 fixture: a NATIVE button, reachable or not by `tabindex` alone.
 *
 * `tabindex="-1"` on a real `<button>` keeps it in the accessibility tree and takes it out of the tab
 * order, so both variants announce `"Delete draft, button"` and only one can be operated. Contrast
 * `KEYBOARD_ACTION_PAGE`, whose control is a `div role="button"`: same announcement, same failure, and a
 * shape static analysis recognises. Having both means the head sees the failure rather than the markup.
 *
 * Placed SECOND, and NOT first — which is the opposite of its sibling and was settled by measuring.
 *
 * `KEYBOARD_ACTION_PAGE` puts its control first, reasoning that the probe truncates so a control near the
 * top is certainly reached. True, and for a `tabindex="-1"` element it backfires: the probe records the
 * button as stop 0 on BOTH variants, and Tab can never return to a non-tabbable element, so the bad
 * variant's tab order never closes its cycle. `controlUnreachableByKeyboard` requires a closed cycle
 * before it will claim anything — "the WHOLE tab cycle, or no claim", because otherwise the probe's stop
 * cap is indistinguishable from the page trapping the keyboard — so it correctly refused to fire, and the
 * case was BLIND.
 *
 * Measured on the first capture, which is what `--pipeline=verify` is for:
 *
 *     bad   focusOrder ["Delete draft, button", "Full name", "Email", "Full name"]
 *           probe {stops: 92, cycled: false, truncated: true}     <- 92 presses, never wrapped
 *     good  focusOrder ["Delete draft, button", "Full name", "Email", "Delete draft, button"]
 *           probe {stops: 6, cycled: true}
 *
 * Second position fixes both: the cycle closes on `Full name` in either variant, and `Delete draft`
 * appears in `formFields` and only the good variant's `focusOrder`. The guard is right and stays; it was
 * the CASE that could not be witnessed, which is a fact about where the control sits and not about the
 * criterion.
 */
export function NATIVE_ACTION_PAGE(/** @type {any} */ focusable) {
  const tab = focusable ? "" : ' tabindex="-1"';
  return "<form>"
    + "<label for=\"a\">Full name</label><input id=\"a\" name=\"a\">"
    + `<button type="button"${tab} class="card">Delete draft</button>`
    + "<label for=\"b\">Email</label><input id=\"b\" name=\"b\">"
    + "</form>";
}

/**
 * A radio group reached by Tab and traversed by ARROWS — the widget class this corpus has none of.
 *
 * Measured 2026-09-01: across 4,926 captures there is not one radio button, tab, menu item, tree item,
 * option or grid cell. Real pages have them (13 radio buttons on 2 of 26, both W3C's own WAI tutorials),
 * and `SHARES_ONE_TAB_STOP` abstains from 2.1.1 on exactly this shape — so the rule's abstention has never
 * once been exercised by the corpus that is supposed to validate it.
 *
 * THE PAIR IS ABOUT REACHABILITY, NOT ABOUT ARIA CORRECTNESS. The failing variant is roving tabindex with
 * the roving half missing: one option carries `tabindex="0"`, the rest `-1`, and no key handler moves it.
 * Tab reaches exactly one option and arrows do nothing, so **two of the three options cannot be reached by
 * keyboard at all** — which is 2.1.1 read literally rather than a style objection.
 *
 * The conformant variant is native `<input type="radio">`, where the browser provides arrow traversal. Both
 * announce three options with the same labels and both are one tab stop, so nothing that discriminates them
 * can be reading the group's SIZE or its role — the confound three withdrawn 2.1.2 rules died of.
 *
 * @param {boolean} arrowsWork
 */
export function RADIO_GROUP_PAGE(arrowsWork) {
  const options = ["Standard delivery", "Express delivery", "Collect in store"];
  if (arrowsWork) {
    return "<form><fieldset><legend>Delivery method</legend>"
      + options.map((label, i) =>
        "<label><input type=\"radio\" name=\"delivery\" value=\"" + i + "\""
        + (i === 0 ? " checked" : "") + "> " + label + "</label>").join("")
      + "</fieldset></form>";
  }
  // Roving tabindex with nothing that roves. No keydown handler anywhere on the page, deliberately.
  return "<div role=\"radiogroup\" aria-label=\"Delivery method\">"
    + options.map((label, i) =>
      "<div role=\"radio\" tabindex=\"" + (i === 0 ? "0" : "-1") + "\" aria-checked=\""
      + (i === 0 ? "true" : "false") + "\">" + label + "</div>").join("")
    + "</div>";
}

// KEPT AS SOURCE, not deleted: the page is right and the EVIDENCE is what is not stable — see the
// withdrawal note on `validation-live-silent`. Referenced by nothing until §18's live-region
// intermittency has a cause, at which point the case is restored and this is used again.
/**
 * Validation that fires WHILE TYPING — the one mechanism this corpus has never contained.
 *
 * Measured 2026-09-01 across all 3,948 generated pages: `oninput` appears on **zero** of them, against
 * `onsubmit` on 346. So every 3.3.1 record in this corpus describes an error surfaced by SUBMITTING, and
 * the head owning `validation-error-silent` has never seen the other half of the criterion.
 *
 * It is a genuinely different mechanism rather than a variation. A submit-time error arrives with a focus
 * change and a re-read; a live one arrives with the user still typing, focus unmoved, and only a live
 * region can carry it. A page can pass the first and fail the second.
 *
 * The pair differs in the live region and NOTHING else: same field, same handler, same message, same
 * words. So anything that discriminates them is reading whether the message was ANNOUNCED, which is the
 * criterion, rather than whether a message exists.
 *
 * @param {boolean} announced
 */
// eslint-disable-next-line no-unused-vars -- see the note above; restored with the case.
function LIVE_VALIDATION_PAGE(announced) {
  const region = announced
    ? "<p id=\"hint\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\"></p>"
    : "<p id=\"hint\" class=\"error\"></p>";
  return "<form onsubmit=\"return false\">"
    + "<label for=\"ref\">Reference number</label><input id=\"ref\" name=\"ref\">"
    + region
    + "</form>"
    // Fires on every keystroke and says the same thing on both variants. `input`, not `change`: `change`
    // waits for blur, which is the submit-time mechanism this case exists to be different from.
    + "<script>document.querySelector('#ref').addEventListener('input', (e) => "
    + "{ document.querySelector('#hint').textContent = e.target.value.length === 6 ? '' : "
    + "'Reference must be 6 digits.'; });</script>";
}

/**
 * A CONSENT BANNER that confines Tab to itself — the exact shape that refuted three 2.1.2 rules.
 *
 * Measured on the pages that did the refuting: tfl.gov.uk's ring reads `link, link, button, button, button`
 * ("Manage cookies", "Accept only essential cookies", "Accept all cookies"); networkrail's reads
 * `link, button, button, button` ("Allow all cookies"). This reproduces that: a link and two buttons, with a
 * focus guard, dismissible by either button.
 *
 * IT IS FURNITURE, NOT THE DEFECT. It sits on BOTH variants of the pair, identically, so nothing about it
 * is the signal — and a rule that fires on it therefore fires on the CONFORMANT page too, where
 * `rules:gate` counts it as a false positive. That is the whole job: the corpus had no page that could
 * express this failure, so four consecutive wrong rules scored 4/4 EXACT on it.
 *
 * NO EDITABLE inside the banner, deliberately. Focus landing in a text field switches NVDA to focus mode,
 * and quick-nav keys then type themselves into the page — the defect that ran for 353 captures. A link and
 * buttons cannot trigger it, so this page tests one thing.
 */
function CONSENT_BANNER() {
  return "<div id=\"consent\" role=\"dialog\" aria-label=\"Cookie choices\">"
    + "<p>We use cookies to remember your settings and to understand how the site is used.</p>"
    + "<a href=\"/cookie-policy\">Read our cookie policy</a>"
    + "<button type=\"button\" id=\"consent-accept\">Accept all cookies</button>"
    + "<button type=\"button\" id=\"consent-reject\">Reject all cookies</button>"
    + "</div>";
}

/**
 * Keeps Tab inside the banner until a choice is made, then releases the page — what a real consent wall
 * does, and CONFORMANT: focus can be moved away using only a keyboard, by activating a button in the ring.
 */
export const CONSENT_FOCUS_GUARD = "var consenting = true;"
  + "function dismissConsent() {"
  + "  consenting = false;"
  + "  document.getElementById('consent').hidden = true;"
  + "  document.getElementById('contact-name').focus();"
  + "}"
  + "document.getElementById('consent-accept').addEventListener('click', dismissConsent);"
  + "document.getElementById('consent-reject').addEventListener('click', dismissConsent);"
  + "document.addEventListener('focusin', (event) => {"
  + "  if (!consenting) return;"
  + "  const banner = document.getElementById('consent');"
  + "  if (!banner.contains(event.target)) {"
  + "    queueMicrotask(() => document.getElementById('consent-accept').focus());"
  + "  }"
  + "});";

/**
 * @param {boolean} withAlt whether the illustration carries alternative text — the ONLY difference between
 *   the two variants of this pair. Everything else, banner included, is byte-identical.
 */
export function CONSENT_WALLED_PAGE(withAlt) {
  const alt = withAlt ? " alt=\"A shaded seating area beside the community garden\"" : "";
  return "<form>"
    + "<label for=\"contact-name\">Your name</label><input id=\"contact-name\" name=\"contact-name\">"
    + "<label for=\"contact-email\">Email</label><input id=\"contact-email\" name=\"contact-email\">"
    + "<label for=\"contact-phone\">Telephone</label><input id=\"contact-phone\" name=\"contact-phone\">"
    + "<label for=\"contact-notes\">Anything else</label><input id=\"contact-notes\" name=\"contact-notes\">"
    + "</form>"
    + "<p>The garden project added a shaded seating area.</p>"
    + "<img src=\"/missing-garden.png\"" + alt + ">"
    + CONSENT_BANNER();
}
