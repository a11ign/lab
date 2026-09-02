// @ts-check
/**
 * Controlled page pairs for collecting screen-reader-only evidence.
 *
 * The page is an instrument: it creates a known contrast so the capture
 * pipeline can produce labels without putting HTML, DOM, CSS, or axe results
 * into the model input. The wording is original and the accessibility topics
 * are paraphrased from the repository's bookctx references and existing eval
 * fixtures.
 */
import { parseAnnouncement } from "@a11y-witness/evidence";


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

const escapeHtml = (/** @type {any} */ value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");


/**
 * Realistic page furniture, identical in both variants of a pair.
 *
 * ## Why
 *
 * The generated pages were minimal test cases and real pages are not. Measured across the corpus against
 * real captures:
 *
 *   links      corpus p50 0, MAX 1        real pages 41-47
 *   headings   corpus p50 1, MAX 3        real pages 30-37
 *   transcript corpus p50 3, max 12       real pages 16-143
 *
 * So the scorer had never seen a page with more than one link or three headings, and its structured
 * features sat 10-40x outside anything it was fitted on. That is why it scores 0.997 on a corpus page and
 * <=0.002 on a real one: the inputs are off the end of its training range and its heads extrapolate to
 * nothing. The fix is not more REAL pages — labels would then need validating — it is realistically SIZED
 * pages, which we can author and label exactly.
 *
 * ## Why it cannot disturb a single label
 *
 * Applied inside `page()`, so both variants of a pair get byte-identical furniture and the labelled
 * failure remains the only difference. What it contains is constrained by what the signals read:
 *
 * - **No landmarks.** All 58 `structure-empty` cases assert `structure.landmarks` is EMPTY, which holds
 *   today only because quick navigation cannot reach the `<main>` enclosing the caret. A filler `<nav>`
 *   WOULD be reachable and would break every one of them. Costless to omit: `evidenceUnits` deliberately
 *   excludes landmarks as a model feature, so the gap there does not matter.
 * - **No images and no form fields**, because 150 image cases and 141 label cases are defined by exactly
 *   what those channels contain.
 * - **No vague link text.** `regex` signals match `link, read more|learn more`, and 2.4.4's own rule bars
 *   the phrase family, so filler links are all specific.
 * - **Headings are safe for `missing-heading`** — it asserts a NAMED heading is absent, not that none
 *   exist, so distinctly-worded filler cannot satisfy it. Sequence numbers make collision impossible.
 *   **Not safe for `structure-empty` on `headings`**, which asserts there are NONE: furniture sections
 *   would supply them and quietly void the case. `withRealisticScale` drops sections for those, the same
 *   way it drops the furniture table from a case that drives tables itself.
 */
function filler(/** @type {any} */ bucket) {
  const { links: linkCount, sections: sectionCount } = bucket;
  if (linkCount === 0 && sectionCount === 0) return "";
  const topics = [
    "Opening times for the north entrance", "Annual review 2019", "Accessibility statement",
    "Travel and parking", "Volunteering enquiries", "Room hire rates", "Schools programme",
    "Conservation projects", "Membership renewal", "Local history archive", "Site safety notes",
    "Seasonal closures", "Feedback and complaints", "Supplier information", "Research requests",
    "Community grants", "Weather advisory", "Lost property", "Bicycle storage", "Guided walks",
  ];
  // Every link text must be UNIQUE, and this is not cosmetic. The topic list cycles, so at 40 links the
  // 21st repeated the 1st — and the read-through's bottom-of-page detector treats repeated phrases as
  // having reached the end (`MAX_REPEATED_PHRASES = 3`). Measured: it stopped inside the link list, the
  // transcript came back SHORTER for a bigger page (24 lines against 44), and the 28 heading sections were
  // never read at all. Left unfixed that would have truncated the read-through on every page in the corpus.
  const links = Array.from({ length: linkCount }, (_, i) =>
    "<li><a href=\"#ref-" + (i + 1) + "\">"
    + escapeHtml(topics[i % topics.length] + " " + String(i + 1).padStart(2, "0"))
    + "</a></li>").join("");
  const sections = Array.from({ length: sectionCount }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    // "Reference note", NOT "Reference section". The word `section` collided with a real signal —
    // `heading.*\bsection\b` on `heading-vague-market` — so the filler itself satisfied the badSignal and
    // the case reported CONTAMINATED, firing on both variants. Found by testing the filler's announced text
    // against all 382 regex signals statically, which takes seconds and should be run whenever this text
    // changes: it would have caught this before a single capture was spent.
    return "<h2 id=\"ref-" + (i + 1) + "\">Reference note " + n + "</h2>"
      + "<p>Background detail for reference note " + n
      + ", retained for records and reviewed each year by the site team.</p>";
  }).join("");
  return "<ul>" + links + "</ul>" + sections + namedField(bucket) + dataTable(bucket) + disclosure(bucket);
}

/**
 * The furniture that exists to BREAK a correlation rather than to add size.
 *
 * ADR 0015: every head learned to penalise features that are 0 on all of its training positives, because
 * one page demonstrates one thing. Of the 147 records carrying an unnamed form field, none had a table and
 * none had a named field — so `table_present` (-1.26) and `form_field_named` (-4.33) were free, and the
 * scorer reports an unnamed control only on a page where nothing is correctly named.
 *
 * These two pieces are the cheapest remedy: ordinary, CONFORMANT structure that a real page carries
 * incidentally, injected identically into both variants like all other furniture. They add no failure, so
 * no label changes; they only stop the feature being constant.
 *
 * Both are deliberately conformant — a properly associated table and a properly labelled field — so they
 * cannot satisfy any case's badSignal. `filler-collision.test.ts` runs EVERY signal predicate against a
 * capture built from these announcements rather than only the regex ones, which is how it caught that
 * `placeholderOnlyIsPresent` would have been silenced by the labelled field.
 */
function namedField(/** @type {any} */ bucket) {
  if (!bucket.namedField) return "";
  // NO `<form>` wrapper, deliberately. `probeForms` finds a form and submits it, and a second form would
  // change which one a case's own probe activates — a difference between pages that the label does not
  // describe. A labelled input needs no form to be announced as a named field.
  return "<p><label for=\"ref-lookup\">Reference lookup</label>"
    + "<input id=\"ref-lookup\" name=\"ref-lookup\" type=\"text\"></p>";
}

/**
 * A CONFORMANT disclosure — the one interaction evidence furniture can supply.
 *
 * `state_changed` starves more subtypes than any other feature (13 of 13), and `corpus:starvation` models
 * this bucket as taking the starved pairs from 209 to 178. It is reachable from markup alone because
 * `probeKindFor` returns "disclosure" for anything announced as `collapsed` and activates it
 * **unconditionally**, with no `probeForms` gate — its own comment says why: "expanding something is
 * side-effect-free".
 *
 * Everything else in that group needs `probeForms`, which activates a control a page owner chose, and this
 * tool does not press *Book* on a page it does not own. So this is where furniture's reach ends for
 * interaction evidence.
 *
 * Conformant deliberately: `aria-expanded` flips, so the page announces `expanded` after activation. A
 * broken one would add a 4.1.2 failure to every page carrying it, which changes labels rather than
 * features — that is a two-defect CASE, not furniture.
 */
function disclosure(/** @type {any} */ bucket) {
  if (!bucket.disclosure) return "";
  return "<p><button type=\"button\" id=\"ref-notes-toggle\" aria-expanded=\"false\" "
    + "aria-controls=\"ref-notes-panel\" onclick=\"var b=this,p=document.getElementById('ref-notes-panel');"
    + "var open=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',String(!open));"
    + "p.hidden=open;\">Reference notes archive</button></p>"
    + "<div id=\"ref-notes-panel\" hidden><p>Archived reference notes are retained for seven years.</p></div>";
}

function dataTable(/** @type {any} */ bucket) {
  if (!bucket.dataTable) return "";
  // Headers associated by `scope`, so this sets `table_header_associated` and NOT `table_position_only`.
  // The position-only variant is a 1.3.1 FAILURE, so it cannot be furniture — a page that needs it has to
  // fail two criteria at once, which is a case definition rather than a bucket.
  return "<table><caption>Reference notes index</caption>"
    + "<tr><th scope=\"col\">Note</th><th scope=\"col\">Reviewed</th></tr>"
    + "<tr><td>Site safety</td><td>2019</td></tr></table>";
}

/**
 * `heading` may be FALSE, for a page that genuinely has none.
 *
 * It was unconditional, and that one line is why `1.3.1`'s missing-headings rule could never fire on
 * anything: every generated page carried an `h1` by construction, so across 2,366 records the count with
 * zero headings was 0 and the gate reported "NEVER FIRED ANYWHERE — the claim rests on nothing". A page
 * with no headings at all is a real and common failure — a screen reader user skims BY heading, so a page
 * without any forces a line-by-line read to find anything — and the corpus simply could not express it.
 */
function page(/** @type {any} */ { title, heading, body, script = "", landmark = true }) {
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

function defaultSubtype(/** @type {any} */ { id, criterion, badSignal }) {
  if (criterion === "1.1.1") {
    if (id.includes("missing")) return "missing-alt";
    if (id.includes("generic")) return "generic-alt";
    if (id.includes("filename")) return "filename-alt";
  }
  if (criterion === "1.3.1") {
    // KEYED ON THE FIELD, because `structure-empty` says only "this channel is empty" and the channel is
    // the whole claim. It returned `missing-landmark` for every one, so a headings case would have been
    // labelled as a landmarks failure — a label for a defect the page does not have.
    if (badSignal.type === "structure-empty") {
      return badSignal.field === "headings" ? "no-headings" : "missing-landmark";
    }
    if (badSignal.type === "missing-heading") return "fake-heading";
    if (badSignal.type === "table-unassociated") return "unassociated-table";
  }
  if (criterion === "3.3.2" && id.includes("placeholder")) return "placeholder-only";
  return badSignal.type;
}

/**
 * @param {Record<string, any>} spec
 *   Spelled out FIELD BY FIELD in the destructuring below rather than in this type, and deliberately so:
 *   the comment inside says `pair` names every field it forwards, and that list is the contract. A
 *   duplicate of it here would be a second copy of the one thing this function exists to be explicit
 *   about, which is this repo's most expensive shape.
 */
// EXPORTED so the flag forwarding can be TESTED rather than assumed. `probeArrows` and `probeTyping`
// were dropped here silently — declared, plumbed through every later hop, and lost at this one — because
// nothing could reach this function to ask whether an unknown `probe*` key survives it.
export function pair({
  id,
  criterion,
  task,
  source,
  mutation,
  badSignal,
  good,
  bad,
  probeForms = false,
  probeTables = false,
  // The FOCUS probe, and the reason it is opt-in per case rather than always-on: `focusOrder` costs ~8 s on
  // top of a ~12 s capture, and a capture must never pay for evidence nobody asked for.
  //
  // It went unforwarded until 2026-08-21 and the cost was invisible: `focusOrder` is absent from all 4,899
  // corpus captures, so every criterion reading it — 2.1.2, 2.4.1, 2.4.3, 2.1.1, 3.2.1, 2.1.4 — was
  // unassessable there. 2.1.2 was the expensive one: `rules.ts` has shipped a keyboard-trap rule the whole
  // time, and `rules:gate` could never once fire it.
  probeFocus = false,
  // The NAVIGATION probe. Opt-in for the same reason as the others, and additionally because it is the one
  // probe that ACTIVATES A LINK -- it can leave the page under measurement, so it runs last and only when a
  // case asks. It exists for the half of 2.4.2 a screen reader is uniquely placed to prove: a route that
  // changes without the title changing, so the reader still says the previous page's name.
  // The DIALOG probe. Opt-in because it presses Escape after the sweep -- a real interaction with the page,
  // and worthless once anything has anchored, since `anchorToTop` presses Escape as its first action.
  probeDialog = false,
  probeNavigation = false,
  // WHICH ORDER the two position-dependent probes run in -- `"focus-first"`, or absent for the order that
  // has always run. It is the only way a case can carry BOTH a walked tab ring and form-probe evidence:
  // the default sweeps (activating controls) before it walks focus, so the ring is measured on a page an
  // activation has already changed.
  //
  // `capture-core` and `server.mjs` have accepted it since the determinism work and no case could ask,
  // because the host runner enumerates by name. Adding it here is the last hop -- and this constructor's
  // own comment on `alsoFails` is the warning: "a constructor that enumerates its fields must be updated
  // with them", learned when three cases declared `alsoFails` and the count read 0.
  probeOrder = undefined,
  family = id,
  subtype = null,
  // Criteria this case ALSO breaks. `pair` names every field it forwards, so a case declaring
  // `alsoFails` without this line is silently dropped -- which it was, and the count read 0 while
  // three case definitions carried it. A constructor that enumerates its fields must be updated
  // with them.
  alsoFails = [],
  // Everything not named above. Only `probe*` keys are forwarded from it — see below.
  ...rest
}) {
  return {
    id,
    family,
    criterion,
    alsoFails,
    subtype: subtype || defaultSubtype({ id, criterion, badSignal }),
    task,
    source,
    mutation,
    badSignal,
    probeForms,
    probeTables,
    probeFocus,
    probeNavigation,
    probeDialog,
    // EVERY OTHER `probe*` FLAG, BY PREFIX RATHER THAN BY NAME — the remedy CLAUDE.md already records for
    // this exact defect, applied to the hop it never reached.
    //
    // "Which probe a case wants" was SIX hand-written hops, and the recorded symptom is precise: *"the
    // probe never ran; the field it writes was simply absent, which is what a page with nothing to report
    // looks like."* The manifest hop was fixed to forward by prefix. This one was not, so `probeArrows`
    // and `probeTyping` were declared on their cases, plumbed through the four hops after this, tested by
    // `probe-chain.test.ts`, and dropped HERE — silently, because a dropped flag and an unasked probe are
    // the same absent field.
    //
    // Measured 2026-09-01: both cases captured clean and both probes were inert. What said so was
    // `observed.arrowNavigation.why` reading "probeArrows is opt-in" — the flag arrived FALSE — rather
    // than an empty channel that reads as "the page has none of these". That is the protocol-10 work
    // earning its keep on the first real defect after it shipped.
    //
    // The five above stay named because they are the documented interface and a reader should see them.
    // Anything else beginning `probe` rides through, so the next one cannot be dropped by omission.
    ...Object.fromEntries(Object.entries(rest).filter(([key]) => key.startsWith("probe"))),
    ...(probeOrder ? { probeOrder } : {}),
    good,
    bad,
  };
}

// What NVDA announces for an image it cannot name, across versions: older builds emit the
// object-replacement character (U+FFFC) as a stand-in for content they cannot describe, while
// NVDA 2026.1 emits its missing-description hint. Both mean the same thing -- the image has no
// usable alternative -- so a badSignal that matches only one form silently skips the case at
// export time, reported as "bad signal was not observable in NVDA output", which reads like
// the page is wrong rather than the pattern.
const UNNAMED_GRAPHIC = "(?:\\ufffc|to get missing image descriptions)";

// NVDA speaks a filename rather than spelling it: harbour_07-final.jpg is announced
// "harbour 07-final dot jpg". A pattern written from the filename therefore never matches
// what was actually said. Underscores become spaces and "." becomes " dot ".
function spokenForm(/** @type {any} */ text) {
  return text.replaceAll("_", "[ _]").replaceAll(".", "(?:\\.| dot )");
}

const cases = [
  pair({
    id: "image-missing-alt",
    criterion: "1.1.1",
    task: "Read the project update and understand what the illustration shows.",
    source: "Practical Web Accessibility, chapter 22; Web Accessibility Cookbook, chapter 3",
    mutation: "The informative illustration has no alternative text.",
    badSignal: { type: "regex", pattern: "graphic[, ]+" + UNNAMED_GRAPHIC, flags: "i" },
    good: page({
      title: "Project update with an informative illustration",
      heading: "Project update",
      body: "<p>The garden project added a shaded seating area.</p><img src=\"/missing-garden.png\" alt=\"A shaded seating area beside the community garden\">",
    }),
    bad: page({
      title: "Project update with an unlabelled illustration",
      heading: "Project update",
      body: "<p>The garden project added a shaded seating area.</p><img src=\"/missing-garden.png\">",
    }),
  }),
  pair({
    id: "image-generic-alt",
    criterion: "1.1.1",
    task: "Read the project update and understand what the illustration shows.",
    source: "Practical Web Accessibility, chapter 22",
    mutation: "The illustration has a generic placeholder alternative such as image.",
    badSignal: { type: "regex", pattern: "graphic.*\\bimage\\b", flags: "i" },
    good: page({
      title: "Market report with a useful chart",
      heading: "Market report",
      body: "<p>Weekend visits increased after the new opening hours.</p><img src=\"/missing-chart.png\" alt=\"Line chart showing weekend visits rising from April to June\">",
    }),
    bad: page({
      title: "Market report with a placeholder chart label",
      heading: "Market report",
      body: "<p>Weekend visits increased after the new opening hours.</p><img src=\"/missing-chart.png\" alt=\"image\">",
    }),
  }),
  pair({
    id: "image-filename-alt",
    criterion: "1.1.1",
    task: "Find the image that identifies the new trail entrance.",
    source: "Practical Web Accessibility, chapter 22",
    mutation: "The alternative is a file name rather than a useful description.",
    badSignal: { type: "regex", pattern: "graphic.*trail[ _-]+entrance.*final", flags: "i" },
    good: page({
      title: "Trail map",
      heading: "Trail map",
      body: "<p>The new entrance is on the east side of the park.</p><img src=\"/trail_entrance-final.jpg\" alt=\"Map showing the new trail entrance on the east side of the park\">",
    }),
    bad: page({
      title: "Trail map",
      heading: "Trail map",
      body: "<p>The new entrance is on the east side of the park.</p><img src=\"/trail_entrance-final.jpg\" alt=\"trail_entrance-final.jpg\">",
    }),
  }),
  pair({
    id: "link-read-more",
    criterion: "2.4.4",
    task: "Open the guide for the Saturday workshop.",
    source: "Practical Web Accessibility, chapter 5; Web Accessibility Cookbook, chapter 22",
    mutation: "The link name is a repeated, context-poor phrase instead of the destination.",
    badSignal: { type: "regex", pattern: "link[, ]+(read more|learn more)\\b", flags: "i" },
    good: page({
      title: "Community workshops",
      heading: "Community workshops",
      body: "<p>Saturday workshop: planting for pollinators.</p><a href=\"/workshop-guide\">Read the planting for pollinators workshop guide</a>",
    }),
    bad: page({
      title: "Community workshops",
      heading: "Community workshops",
      body: "<p>Saturday workshop: planting for pollinators.</p><a href=\"/workshop-guide\">Read more</a>",
    }),
  }),
  pair({
    id: "link-click-here",
    criterion: "2.4.4",
    task: "Open the timetable for the evening class.",
    source: "Practical Web Accessibility, chapter 5",
    mutation: "The link name says how to operate it but not where it leads.",
    badSignal: { type: "regex", pattern: "link[, ]+click here\\b", flags: "i" },
    good: page({
      title: "Evening classes",
      heading: "Evening classes",
      body: "<p>The next class starts at six.</p><a href=\"/evening-timetable\">View the evening class timetable</a>",
    }),
    bad: page({
      title: "Evening classes",
      heading: "Evening classes",
      body: "<p>The next class starts at six.</p><a href=\"/evening-timetable\">Click here</a>",
    }),
  }),
  pair({
    id: "headings-fake",
    criterion: "1.3.1",
    task: "Navigate to the contact section and read its opening hours.",
    source: "Practical Web Accessibility, chapter 4; Web Accessibility Cookbook, chapter 22",
    mutation: "Visual section headings are styled text rather than heading elements.",
    badSignal: { type: "missing-heading", text: "Contact and opening hours" },
    good: page({
      title: "Library services",
      heading: "Library services",
      body: "<h2>Borrowing books</h2><p>Members may borrow six books.</p><h2>Contact and opening hours</h2><p>The desk is open until eight on weekdays.</p>",
    }),
    bad: page({
      title: "Library services",
      heading: "Library services",
      body: "<div class=\"fake-heading\">Borrowing books</div><p>Members may borrow six books.</p><div class=\"fake-heading\">Contact and opening hours</div><p>The desk is open until eight on weekdays.</p>",
    }),
  }),
  pair({
    id: "headings-none-refunds",
    criterion: "1.3.1",
    task: "Find out how long a refund takes.",
    source: "Web Content Accessibility Guidelines, Understanding SC 1.3.1",
    mutation: "The policy is one undifferentiated wall of text with no headings to skim by.",
    badSignal: { type: "structure-empty", field: "headings" },
    good: page({
      title: "Refunds policy",
      heading: "Refunds policy",
      body: "<h2>Requesting a refund</h2><p>You may request a refund within thirty days of delivery.</p><p>Refunds are issued to the original payment method.</p><p>We cannot refund postage on an unwanted item.</p><h2>How long it takes</h2><p>Card refunds appear within five working days.</p><p>Bank transfers can take up to ten working days.</p><p>We will email you when the refund is sent.</p><h2>Faulty items</h2><p>A faulty item is refunded in full, including postage.</p><p>Keep the packaging until the refund has cleared.</p><p>Photographs of the fault help us process the claim.</p><p>Faulty electrical goods are collected rather than returned by post.</p><p>We do not charge a restocking fee on faulty goods.</p><p>A replacement may be offered instead, at your choice.</p><p>Gift purchases are refunded to the buyer, not the recipient.</p><p>Sale items are refunded at the price paid.</p><p>A refund cancels any linked warranty registration.</p><p>Store credit is offered only where you ask for it.</p><p>Refunds on finance agreements are handled by the lender.</p><p>The thirty days run from delivery, not from dispatch.</p>",
    }),
    bad: page({
      title: "Refunds policy",
      // NO heading, and none in the body either. This is the defect: a screen reader user skims by
      // jumping heading to heading, so a page with none forces a line-by-line read to find anything.
      heading: false,
      body: "<p>You may request a refund within thirty days of delivery.</p><p>Refunds are issued to the original payment method.</p><p>We cannot refund postage on an unwanted item.</p><p>Card refunds appear within five working days.</p><p>Bank transfers can take up to ten working days.</p><p>We will email you when the refund is sent.</p><p>A faulty item is refunded in full, including postage.</p><p>Keep the packaging until the refund has cleared.</p><p>Photographs of the fault help us process the claim.</p><p>Faulty electrical goods are collected rather than returned by post.</p><p>We do not charge a restocking fee on faulty goods.</p><p>A replacement may be offered instead, at your choice.</p><p>Gift purchases are refunded to the buyer, not the recipient.</p><p>Sale items are refunded at the price paid.</p><p>A refund cancels any linked warranty registration.</p><p>Store credit is offered only where you ask for it.</p><p>Refunds on finance agreements are handled by the lender.</p><p>The thirty days run from delivery, not from dispatch.</p>",
    }),
  }),
  pair({
    id: "headings-none-booking",
    criterion: "1.3.1",
    task: "Check what time you need to arrive.",
    source: "Web Content Accessibility Guidelines, Understanding SC 1.3.1",
    mutation: "A confirmation page runs every section together with no headings.",
    badSignal: { type: "structure-empty", field: "headings" },
    good: page({
      title: "Booking confirmed",
      heading: "Booking confirmed",
      body: "<h2>Your appointment</h2><p>Your appointment is confirmed for Tuesday at half past two.</p><p>Please arrive fifteen minutes early.</p><p>Bring photographic identification with you.</p><h2>Getting here</h2><p>The entrance is on Wellgate, beside the pharmacy.</p><p>Step-free access is available from the rear car park.</p><p>Parking is free for the first two hours.</p><h2>If you cannot attend</h2><p>Cancel at least one working day in advance.</p><p>A missed appointment may be charged at the full rate.</p><p>You can rebook online at any time.</p><p>Telephone bookings are taken between nine and five.</p><p>Interpreters can be arranged with three days' notice.</p><p>A carer may attend with you at no extra cost.</p><p>Text reminders are sent the day before.</p><p>Waiting-room seating is limited to two per visitor.</p><p>Hot drinks are available in the foyer.</p><p>Assistance dogs are welcome throughout the building.</p><p>Wi-fi is free and needs no password.</p><p>Lockers take a returnable pound coin.</p>",
    }),
    bad: page({
      title: "Booking confirmed",
      // NO heading, and none in the body either. This is the defect: a screen reader user skims by
      // jumping heading to heading, so a page with none forces a line-by-line read to find anything.
      heading: false,
      body: "<p>Your appointment is confirmed for Tuesday at half past two.</p><p>Please arrive fifteen minutes early.</p><p>Bring photographic identification with you.</p><p>The entrance is on Wellgate, beside the pharmacy.</p><p>Step-free access is available from the rear car park.</p><p>Parking is free for the first two hours.</p><p>Cancel at least one working day in advance.</p><p>A missed appointment may be charged at the full rate.</p><p>You can rebook online at any time.</p><p>Telephone bookings are taken between nine and five.</p><p>Interpreters can be arranged with three days' notice.</p><p>A carer may attend with you at no extra cost.</p><p>Text reminders are sent the day before.</p><p>Waiting-room seating is limited to two per visitor.</p><p>Hot drinks are available in the foyer.</p><p>Assistance dogs are welcome throughout the building.</p><p>Wi-fi is free and needs no password.</p><p>Lockers take a returnable pound coin.</p>",
    }),
  }),
  pair({
    id: "headings-none-outage",
    criterion: "1.3.1",
    task: "Find out when the service will be back.",
    source: "Web Content Accessibility Guidelines, Understanding SC 1.3.1",
    mutation: "A status notice presents unrelated updates as one continuous block.",
    badSignal: { type: "structure-empty", field: "headings" },
    good: page({
      title: "Service status",
      heading: "Service status",
      body: "<h2>Current status</h2><p>Online applications are unavailable this morning.</p><p>Saved drafts have not been affected.</p><p>We expect the service to return by midday.</p><h2>What you can still do</h2><p>Telephone applications are being taken as usual.</p><p>Existing appointments are running normally.</p><p>Payments already submitted have gone through.</p><h2>Why this happened</h2><p>A scheduled upgrade ran longer than planned.</p><p>No personal data was affected at any point.</p><p>The upgrade will be rescheduled for a weekend.</p><p>We will publish a fuller explanation next week.</p><p>Subscribers to the status feed were notified at seven.</p><p>Compensation is not payable for a planned upgrade.</p><p>The status page updates every fifteen minutes.</p><p>Third-party integrations were not affected.</p><p>Uploads queued before eight will be processed.</p><p>No action is needed from applicants.</p><p>The helpline is busier than usual this morning.</p><p>Weekend maintenance windows are published a month ahead.</p>",
    }),
    bad: page({
      title: "Service status",
      // NO heading, and none in the body either. This is the defect: a screen reader user skims by
      // jumping heading to heading, so a page with none forces a line-by-line read to find anything.
      heading: false,
      body: "<p>Online applications are unavailable this morning.</p><p>Saved drafts have not been affected.</p><p>We expect the service to return by midday.</p><p>Telephone applications are being taken as usual.</p><p>Existing appointments are running normally.</p><p>Payments already submitted have gone through.</p><p>A scheduled upgrade ran longer than planned.</p><p>No personal data was affected at any point.</p><p>The upgrade will be rescheduled for a weekend.</p><p>We will publish a fuller explanation next week.</p><p>Subscribers to the status feed were notified at seven.</p><p>Compensation is not payable for a planned upgrade.</p><p>The status page updates every fifteen minutes.</p><p>Third-party integrations were not affected.</p><p>Uploads queued before eight will be processed.</p><p>No action is needed from applicants.</p><p>The helpline is busier than usual this morning.</p><p>Weekend maintenance windows are published a month ahead.</p>",
    }),
  }),
  pair({
    id: "headings-none-guide",
    criterion: "1.3.1",
    task: "Work out which office to attend.",
    source: "Web Content Accessibility Guidelines, Understanding SC 1.3.1",
    mutation: "A step-by-step guide is written as continuous prose with no headings.",
    badSignal: { type: "structure-empty", field: "headings" },
    good: page({
      title: "Registering a birth",
      heading: "Registering a birth",
      body: "<h2>Before you go</h2><p>Register the birth within forty-two days.</p><p>You will need the hospital's notification of birth.</p><p>Both parents may attend, but only one is required.</p><h2>At the office</h2><p>The registrar will ask for the child's full name.</p><p>Names cannot be changed casually once registered.</p><p>You may buy certified copies on the day.</p><h2>Afterwards</h2><p>The short certificate is free of charge.</p><p>A full certificate carries a fee.</p><p>Certificates are needed for a passport application.</p><p>Copies ordered later are posted within a week.</p><p>Corrections after registration require evidence.</p><p>The register cannot be amended by telephone.</p><p>Appointments are not needed at the main office.</p><p>Parking is limited to one hour outside.</p><p>The office is closed on public holidays.</p><p>Payment is by card only.</p><p>A second registrar is available on Thursdays.</p><p>Interpreters must be booked in advance.</p>",
    }),
    bad: page({
      title: "Registering a birth",
      // NO heading, and none in the body either. This is the defect: a screen reader user skims by
      // jumping heading to heading, so a page with none forces a line-by-line read to find anything.
      heading: false,
      body: "<p>Register the birth within forty-two days.</p><p>You will need the hospital's notification of birth.</p><p>Both parents may attend, but only one is required.</p><p>The registrar will ask for the child's full name.</p><p>Names cannot be changed casually once registered.</p><p>You may buy certified copies on the day.</p><p>The short certificate is free of charge.</p><p>A full certificate carries a fee.</p><p>Certificates are needed for a passport application.</p><p>Copies ordered later are posted within a week.</p><p>Corrections after registration require evidence.</p><p>The register cannot be amended by telephone.</p><p>Appointments are not needed at the main office.</p><p>Parking is limited to one hour outside.</p><p>The office is closed on public holidays.</p><p>Payment is by card only.</p><p>A second registrar is available on Thursdays.</p><p>Interpreters must be booked in advance.</p>",
    }),
  }),
  pair({
    id: "headings-none-directory",
    criterion: "1.3.1",
    task: "Find the number for planning enquiries.",
    source: "Web Content Accessibility Guidelines, Understanding SC 1.3.1",
    mutation: "A contact directory lists every team as plain paragraphs with no headings.",
    badSignal: { type: "structure-empty", field: "headings" },
    good: page({
      title: "Who to contact",
      heading: "Who to contact",
      body: "<h2>Housing</h2><p>Housing repairs are reported on the repairs line.</p><p>Rent enquiries are handled by the accounts team.</p><p>Homelessness support is available at any hour.</p><h2>Planning</h2><p>Planning enquiries are taken weekday mornings.</p><p>Applications are viewed at the planning counter.</p><p>Objections must be submitted in writing.</p><h2>Everything else</h2><p>Council tax questions go to the revenues team.</p><p>School admissions are handled by the county.</p><p>Licensing enquiries are taken by email only.</p><p>Environmental health responds within two working days.</p><p>Bulky waste collections are booked online.</p><p>The switchboard can transfer you to any team.</p><p>Lines are open from eight in the morning.</p><p>Calls are charged at a local rate.</p><p>A voicemail left overnight is returned next working day.</p><p>Written enquiries are answered within ten working days.</p><p>The offices close at four on Fridays.</p><p>British Sign Language interpretation can be arranged.</p>",
    }),
    bad: page({
      title: "Who to contact",
      // NO heading, and none in the body either. This is the defect: a screen reader user skims by
      // jumping heading to heading, so a page with none forces a line-by-line read to find anything.
      heading: false,
      body: "<p>Housing repairs are reported on the repairs line.</p><p>Rent enquiries are handled by the accounts team.</p><p>Homelessness support is available at any hour.</p><p>Planning enquiries are taken weekday mornings.</p><p>Applications are viewed at the planning counter.</p><p>Objections must be submitted in writing.</p><p>Council tax questions go to the revenues team.</p><p>School admissions are handled by the county.</p><p>Licensing enquiries are taken by email only.</p><p>Environmental health responds within two working days.</p><p>Bulky waste collections are booked online.</p><p>The switchboard can transfer you to any team.</p><p>Lines are open from eight in the morning.</p><p>Calls are charged at a local rate.</p><p>A voicemail left overnight is returned next working day.</p><p>Written enquiries are answered within ten working days.</p><p>The offices close at four on Fridays.</p><p>British Sign Language interpretation can be arranged.</p>",
    }),
  }),
  pair({
    id: "landmarks-missing",
    criterion: "1.3.1",
    task: "Jump to the main content and locate the support navigation.",
    source: "Web Accessibility Cookbook, chapter 22",
    mutation: "The page has visible regions but does not expose useful landmarks.",
    badSignal: { type: "structure-empty", field: "landmarks" },
    good: page({
      title: "Account help",
      heading: "Account help",
      body: "<nav aria-label=\"Support links\"><a href=\"/faq\">Frequently asked questions</a></nav><section aria-label=\"Main support article\"><h2>Resetting a password</h2><p>Choose a new password with at least twelve characters.</p></section>",
    }),
    bad: page({
      title: "Account help",
      heading: "Account help",
      body: "<div><a href=\"/faq\">Frequently asked questions</a></div><div><div class=\"fake-heading\">Resetting a password</div><p>Choose a new password with at least twelve characters.</p></div>",
      landmark: false,
    }),
  }),
  pair({
    id: "form-unlabelled",
    criterion: "3.3.2",
    // An unlabelled field fails TWICE, and single-label ground truth scored the second one as an error.
    // NVDA announces this field as a bare "edit" -- a role with no accessible name -- which is 4.1.2 as
    // squarely as the missing label is 3.3.2. The deterministic rule detects it correctly, and because
    // the case declared only 3.3.2, all 109 of those correct detections counted as FALSE POSITIVES in
    // calibration. That is the whole of 4.1.2's reported over-firing: not a bad rule, a missing label.
    //
    // Asserted per case from the captures, never inferred from the criterion: `form-placeholder-only` is
    // also 3.3.2 and does NOT fire 4.1.2, because a placeholder supplies a name. Applying this by family
    // would have taught the scorer "3.3.2 implies 4.1.2", which is a shortcut feature and exactly the
    // contamination this corpus exists to avoid. Verified on the bad variants only -- 109 of 109, with
    // zero good variants firing, which is what makes it a real second failure rather than noise.
    // `4.1.2:unnamed-control`, NOT `4.1.2:missing-role`. Every one of these three sites described the
    // evidence correctly in its own comment -- "a bare role with no accessible name" -- and then routed
    // it to the head for the OPPOSITE failure. Measured consequence: `4.1.2:missing-role` carried 189
    // positives that split 74/115 into two disjoint signatures, and the split is perfect -- all 74
    // genuine fake-button records announce NOTHING (`formFields: []`, `controls: []`), all 115 of these
    // announce a bare "edit". One linear head over a frozen embedding was asked to learn "nothing is
    // announced OR something is announced unnamed", with the second class as 61% of its positives.
    //
    // It cannot be threshold-tuned away, because "nothing is announced" is not a usable signal on its
    // own: 437 of the corpus's 1001 CONFORMANT records look identical on that axis (pages about images
    // and tables have no controls either). So the calibrator must push the cut up until the empty half
    // is excluded, which is exactly the 0.90 threshold at precision 1.000 and recall 0.875 -- the 20
    // false negatives that blocked release.
    //
    // Same precedent as `icon-button-unnamed` above: one failure mode belongs in one subtype, and an
    // unnamed field is the same failure as an unnamed icon button.
    alsoFails: ["4.1.2:unnamed-control"],
    task: "Enter the name of the person receiving the parcel.",
    source: "Practical Web Accessibility, chapter 6; Inclusive Design for Accessibility, chapter 13",
    mutation: "The text field has no programmatic label and relies on nearby visual text.",
    badSignal: { type: "unnamed-form-field" },
    good: page({
      title: "Parcel details",
      heading: "Parcel details",
      body: "<form><label for=\"recipient\">Recipient name</label><input id=\"recipient\" name=\"recipient\"></form>",
      script: "document.querySelector('input').focus();",
    }),
    bad: page({
      title: "Parcel details",
      heading: "Parcel details",
      body: "<form><span>Recipient name</span><input name=\"recipient\"></form>",
      script: "document.querySelector('input').focus();",
    }),
    probeForms: true,
  }),
  pair({
    id: "form-placeholder-only",
    criterion: "3.3.2",
    task: "Enter the email address for the booking confirmation.",
    source: "Practical Web Accessibility, chapter 6",
    mutation: "The only visible cue is a placeholder that disappears when typing starts.",
    badSignal: { type: "placeholder-only", placeholder: "name at example dot com" },
    // Deliberately NOT unnamed-form-field: a placeholder-only field is not unnamed, the
    // placeholder becomes its name. The discriminator is ORDER -- NVDA announces the bad page
    // as "<placeholder>, edit" (placeholder used as the name) and the good page as
    // "Confirmation email, edit, <placeholder>" (real label, placeholder as description), so
    // only the bad one ends on the role.
    good: page({
      title: "Booking confirmation",
      heading: "Booking confirmation",
      body: "<form><label for=\"email\">Confirmation email</label><input id=\"email\" type=\"email\" name=\"email\" placeholder=\"name@example.com\"></form>",
      script: "document.querySelector('input').focus();",
    }),
    bad: page({
      title: "Booking confirmation",
      heading: "Booking confirmation",
      body: "<form><input type=\"email\" name=\"email\" placeholder=\"name@example.com\"></form>",
      script: "document.querySelector('input').focus();",
    }),
    probeForms: true,
  }),
  pair({
    id: "custom-control-role",
    criterion: "4.1.2",
    task: "Save the notification settings.",
    source: "Practical Web Accessibility, chapter 6; Web Accessibility Cookbook, chapter 22",
    mutation: "A styled non-button element looks like a control but exposes no role or keyboard behavior.",
    badSignal: { type: "missing-role", text: "Save notification settings" },
    good: page({
      title: "Notification settings",
      heading: "Notification settings",
      body: "<button type=\"button\">Save notification settings</button>",
      script: "document.querySelector('button').focus();",
    }),
    bad: page({
      title: "Notification settings",
      heading: "Notification settings",
      body: "<div class=\"card\" id=\"save\">Save notification settings</div>",
      script: "document.querySelector('#save').focus();",
    }),
    probeForms: true,
  }),
  pair({
    id: "iframe-unnamed",
    criterion: "4.1.2",
    subtype: "unnamed-control",
    task: "Read the booking options.",
    source: "WCAG H64; W3C WAI Tutorials, Page Structure",
    mutation: "An iframe carrying the page's real content has no title, so NVDA announces a bare \"frame\" "
      + "with no name and a user has no way to know what is inside before entering it.",
    // THE FIRST CASE THIS CORPUS HAS WITH AN IFRAME AT ALL, and CLAUDE.md lists that absence under what
    // the corpus structurally cannot express: a named iframe ("Radios example, frame") was one of four
    // real-page failures in one day that no corpus gate could ever have seen. `announcement.ts` has
    // treated `frame` as a CONTAINER role since it was written, with the GOV.UK Design System as its
    // worked example -- so the grammar has always been ready for evidence nobody could produce.
    //
    // It also earns the protocol-11 frame sweep. Until now that sweep had only ever run on pages with no
    // frames and correctly found none, which is not proof it works -- it is the "a canary that cannot
    // express the fault is worthless" rule pointed at a brand-new channel. This is the page that can.
    //
    // The two variants differ in the `title` attribute and nothing else, so nothing that discriminates
    // them can be reading the presence of an iframe.
    badSignal: {
      type: "regex",
      // A frame announced with NO name before it, WRITTEN FROM WHAT NVDA ACTUALLY SAID rather than from
      // what seemed likely. The first version required end-of-line after `frame` and was BLIND, because
      // NVDA continues straight into the frame's contents:
      //
      //     bad    "frame, heading, level 2, By train"
      //     good   "Booking options, frame, heading, level 2, By train"
      //
      // So the discriminator is a line that BEGINS with the role -- a container announced without the
      // name that would precede it. Anchored for that reason, and it also keeps "out of frame, list..."
      // (NVDA's container-EXIT prefix, present on both variants) from matching.
      pattern: "(?:^|\\n)frame,",
      flags: "im",
    },
    good: page({
      title: "Booking options",
      heading: "Booking options",
      body: "<p>Choose how you would like to travel.</p>"
        + "<iframe title=\"Booking options\" src=\"data:text/html,"
        + "%3Ch2%3EBy%20train%3C/h2%3E%3Cp%3EDirect%20services%20run%20hourly.%3C/p%3E\"></iframe>",
    }),
    bad: page({
      title: "Booking options",
      heading: "Booking options",
      body: "<p>Choose how you would like to travel.</p>"
        + "<iframe src=\"data:text/html,"
        + "%3Ch2%3EBy%20train%3C/h2%3E%3Cp%3EDirect%20services%20run%20hourly.%3C/p%3E\"></iframe>",
    }),
  }),
  pair({
    id: "icon-button-unnamed",
    criterion: "4.1.2",
    // Named for the FAILURE, not for how it is detected. `badSignal.type` is "regex", so without this
    // the subtype was `4.1.2:regex` -- a key describing the matcher, which says nothing about what went
    // wrong and collides conceptually with the 2.4.4 and 2.4.6 regex cases that are entirely different
    // failures. The 115 unlabelled-field records join this head, because "a control announced with a
    // role and no accessible name" is one failure whether the control is an icon button or a text input.
    subtype: "unnamed-control",
    task: "Open the account search.",
    source: "Practical Web Accessibility, chapter 6",
    mutation: "An icon-only button has no accessible name.",
    // The SAME signal its 31 generated variants use (see unnamedIconVariant), and deliberately so.
    //
    // This seed declared `{type: "unnamed-form-field"}` while every variant of the same mutation
    // declared this regex, which split one failure mode across two model heads: `4.1.2:regex` trained
    // on 31 records and `4.1.2:unnamed-form-field` on ONE. The training gate refuses release for any
    // subtype under 20 positive development records, and it was right to -- a head fitted to a single
    // example is not a classifier. An icon button with no accessible name is one failure mode and
    // belongs in one subtype.
    //
    // Verified equivalent before changing it: this pattern fires on `icon-button-unnamed.bad` and stays
    // silent on `.good`, exactly as `hasUnnamedFormField` did. `hasUnnamedFormField` itself is still
    // exercised by the 115 `form-unlabelled` cases under 3.3.2, so no signal loses coverage. The pages
    // are untouched, so no capture is invalidated.
    badSignal: {
      type: "regex",
      pattern: "(?:^|\\n)button[, ]*(?:" + UNNAMED_GRAPHIC + ")?[, ]*(?:$|\\n)",
      flags: "im",
    },
    good: page({
      title: "Account search",
      heading: "Account search",
      body: "<button type=\"button\" aria-label=\"Open account search\"><span aria-hidden=\"true\">⌕</span></button>",
      script: "document.querySelector('button').focus();",
    }),
    bad: page({
      title: "Account search",
      heading: "Account search",
      body: "<button type=\"button\"><span aria-hidden=\"true\">⌕</span></button>",
      script: "document.querySelector('button').focus();",
    }),
    probeForms: true,
  }),
  pair({
    id: "disclosure-state-silent",
    criterion: "4.1.2",
    task: "Open the travel advice to read the baggage rules.",
    source: "Web Accessibility Cookbook, chapter 22; Practical Web Accessibility, chapter 6",
    mutation: "Activating the disclosure changes visible content but does not update the announced state.",
    badSignal: { type: "state-change-silent", control: "Travel advice" },
    good: page({
      title: "Travel advice",
      heading: "Travel advice",
      body: "<button id=\"advice\" type=\"button\" aria-expanded=\"false\" aria-controls=\"rules\">Travel advice</button><div id=\"rules\" hidden>Small bags may be carried into the cabin.</div>",
      script: "document.querySelector('#advice').addEventListener('click', (event) => { const button = event.currentTarget; const open = button.getAttribute('aria-expanded') === 'true'; button.setAttribute('aria-expanded', String(!open)); document.querySelector('#rules').hidden = open; });",
    }),
    bad: page({
      title: "Travel advice",
      heading: "Travel advice",
      body: "<button id=\"advice\" type=\"button\" aria-expanded=\"false\" aria-controls=\"rules\">Travel advice</button><div id=\"rules\" hidden>Small bags may be carried into the cabin.</div>",
      script: "document.querySelector('#advice').addEventListener('click', () => { document.querySelector('#rules').hidden = false; });",
    }),
    probeForms: true,
  }),
  pair({
    id: "form-error-silent",
    criterion: "3.3.1",
    task: "Submit the request without entering a reference number and understand what needs fixing.",
    source: "Web Accessibility Cookbook, chapter 22; Practical Web Accessibility, chapter 6",
    mutation: "A validation message appears visually but is not associated with the invalid field or announced as a live update.",
    badSignal: { type: "validation-error-silent", control: "Submit request" },
    good: page({
      title: "Service request",
      heading: "Service request",
      body: "<form id=\"request\"><label for=\"reference\">Reference number</label><input id=\"reference\" aria-describedby=\"reference-error\"><button type=\"submit\">Submit request</button><p id=\"reference-error\" role=\"alert\" hidden>Enter the reference number before submitting.</p></form>",
      script: "document.querySelector('#request').addEventListener('submit', (event) => { event.preventDefault(); const input = document.querySelector('#reference'); input.setAttribute('aria-invalid', 'true'); document.querySelector('#reference-error').hidden = false; input.focus(); });",
    }),
    bad: page({
      title: "Service request",
      heading: "Service request",
      body: "<form id=\"request\"><label for=\"reference\">Reference number</label><input id=\"reference\"><button type=\"submit\">Submit request</button><p class=\"error\" hidden>Enter the reference number before submitting.</p></form>",
      script: "document.querySelector('#request').addEventListener('submit', (event) => { event.preventDefault(); document.querySelector('.error').hidden = false; });",
    }),
    probeForms: true,
  }),
  // RESTORED the same day it was withdrawn, because the withdrawal rested on ONE capture and the reading
  // was right while the conclusion was wrong. The delta was `{kind: "toggle", after: "checked"}` and I
  // concluded the live region had not announced. It had not been ASKED properly: `formActivationIsSilent`
  // tested `after.trim() === ""`, a silence test written for BUTTONS, and a checkbox always says "checked".
  //
  // A diagnostic pair settled it — same control, one `polite` region and one `assertive` — and BOTH
  // announced "Showing 2 bags.". Politeness was never the cause and neither was the control. The fault was
  // in the predicate, and `pageResponseTo` now separates the control's own state from the page's answer.
  /*
   * `filter-status-silent-checkbox` — WITHDRAWN, and this time with a RATE rather than a guess.
   *
   * Six repeats of the unchanged good page: the live region reached the activation delta **2 times in 6**.
   * `gate:stability` calls that `VARIES formChanges counts 1,1,1,1,1,1` — the count never moves, only the
   * content, which is the rot a count-based check cannot see.
   *
   * Three readings of this case today, all from single captures, all different: "checked" on both;
   * then good "Showing 2 bags." and bad "checked"; then "checked" on both again. Each looked like a
   * finding. ONE CAPTURE IS NOT A MEASUREMENT — `gate:stability` repeats a page and `identity:rate` prints
   * a 95% upper bound rather than a zero, and a withdrawal is a conclusion like any other.
   *
   * IT IS NOT THE WAIT. `activateAndCaptureDelta` now waits a second time whenever everything heard is the
   * control's own state, on sound reasoning: a checkbox says "checked" first, that starts the quiet
   * window, and `aria-live="polite"` means *speak when idle* — so the region waits for the silence that
   * ends it. Deployed and re-measured: **2 of 6 before, 2 of 6 after.** The announcement is intermittent
   * AT NVDA, and no wait catches what was never spoken.
   *
   * That second wait is kept and INSTRUMENTED (`SECOND-WAIT-AFTER-OWN-STATE caught=…` in `sweepLog`), so
   * "it never fires" and "it fires and finds nothing" stop being the same silence.
   *
   * `pageResponseTo` stays and is correct independently: it separates a toggle's own state from the page's
   * answer, so a silence test written for BUTTONS can fire on a toggle at all. The evidence underneath is
   * what is not yet stable enough to train on.
   */

  pair({
    id: "filter-status-silent",
    criterion: "4.1.3",
    task: "Filter the catalogue to show only bags and notice how many results remain.",
    source: "Web Accessibility Cookbook, chapter 22; Practical Web Accessibility, chapter 6",
    mutation: "Filtering updates the visible result count but does not expose the update through a live status.",
    badSignal: { type: "form-activation-silent", control: "Show bags" },
    good: page({
      title: "Product catalogue",
      heading: "Product catalogue",
      body: "<button id=\"bags\" type=\"button\">Show bags</button><p id=\"count\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">Showing 8 products.</p><ul id=\"products\"><li>Canvas bag</li><li>Travel bag</li></ul>",
      script: "document.querySelector('#bags').addEventListener('click', () => { document.querySelector('#count').textContent = 'Showing 2 bags.'; });",
    }),
    bad: page({
      title: "Product catalogue",
      heading: "Product catalogue",
      body: "<button id=\"bags\" type=\"button\">Show bags</button><p id=\"count\">Showing 8 products.</p><ul id=\"products\"><li>Canvas bag</li><li>Travel bag</li></ul>",
      script: "document.querySelector('#bags').addEventListener('click', () => { document.querySelector('#count').textContent = 'Showing 2 bags.'; });",
    }),
    probeForms: true,
  }),
  pair({
    id: "table-unassociated-headers",
    criterion: "1.3.1",
    task: "Compare the departure time and platform for Riverside.",
    source: "Web Accessibility Cookbook, chapter 22; existing table eval fixtures",
    mutation: "A data table uses visual header cells without exposing their relationships to each data cell.",
    badSignal: { type: "table-unassociated" },
    probeTables: true,
    good: page({
      title: "Train departures",
      heading: "Train departures",
      body: "<table><caption>Departures from Central station</caption><thead><tr><th scope=\"col\">Destination</th><th scope=\"col\">Departs</th><th scope=\"col\">Platform</th></tr></thead><tbody><tr><th scope=\"row\">Riverside</th><td>09:15</td><td>3</td></tr><tr><th scope=\"row\">Hilltown</th><td>09:40</td><td>5</td></tr></tbody></table>",
    }),
    bad: page({
      title: "Train departures",
      heading: "Train departures",
      body: "<table><caption>Departures from Central station</caption><tr><td>Destination</td><td>Departs</td><td>Platform</td></tr><tr><td>Riverside</td><td>09:15</td><td>3</td></tr><tr><td>Hilltown</td><td>09:40</td><td>5</td></tr></table>",
    }),
  }),
];

function imageVariant(/** @type {any} */ { id, title, heading, description, file, goodAlt, badAlt, task }) {
  const goodImage = "<img src=\"/" + file + "\" alt=\"" + goodAlt + "\">";
  const badImage = "<img src=\"/" + file + "\""
    + (badAlt === null ? "" : " alt=\"" + badAlt + "\"") + ">";
  const spokenBadAlt = badAlt === null
    ? UNNAMED_GRAPHIC
    : "\\b" + spokenForm(badAlt) + "\\b";
  return pair({
    id,
    family: "image-alternative",
    criterion: "1.1.1",
    task,
    source: "Practical Web Accessibility, chapter 22",
    mutation: "The informative image loses a useful alternative and is announced without its meaning.",
    badSignal: {
      type: "regex",
      pattern: "graphic.*" + spokenBadAlt,
      flags: "i",
    },
    good: page({ title, heading, body: "<p>" + description + "</p>" + goodImage }),
    bad: page({ title, heading, body: "<p>" + description + "</p>" + badImage }),
  });
}

function linkVariant(/** @type {any} */ { id, title, heading, context, vague, descriptive, task }) {
  return pair({
    id,
    family: "link-purpose",
    criterion: "2.4.4",
    task,
    source: "Practical Web Accessibility, chapter 5; Web Accessibility Cookbook, chapter 22",
    mutation: "The link name is a short context-poor phrase rather than the destination.",
    badSignal: { type: "regex", pattern: "link[, ]+" + vague + "\\b", flags: "i" },
    good: page({
      title,
      heading,
      body: "<p>" + context + "</p><a href=\"/destination\">" + descriptive + "</a>",
    }),
    bad: page({
      title,
      heading,
      body: "<p>" + context + "</p><a href=\"/destination\">" + vague + "</a>",
    }),
  });
}

function vagueHeadingVariant(/** @type {any} */ { id, title, heading, vague, descriptive, task }) {
  return pair({
    id,
    family: "heading-purpose",
    criterion: "2.4.6",
    task,
    source: "Practical Web Accessibility, chapter 4; Web Accessibility Cookbook, chapter 22",
    mutation: "A real heading role is present, but its name does not identify the topic.",
    badSignal: { type: "regex", pattern: "heading.*\\b" + vague.toLowerCase() + "\\b", flags: "i" },
    good: page({
      title,
      heading,
      body: "<h2>" + descriptive + "</h2><p>The section explains the next step.</p>",
    }),
    bad: page({
      title,
      heading,
      body: "<h2>" + vague + "</h2><p>The section explains the next step.</p>",
    }),
  });
}

function fakeHeadingVariant(/** @type {any} */ { id, title, heading, label, task }) {
  return pair({
    id,
    criterion: "1.3.1",
    task,
    source: "Practical Web Accessibility, chapter 4; Web Accessibility Cookbook, chapter 22",
    mutation: "Visible section text is styled as a heading but has no heading role.",
    badSignal: { type: "missing-heading", text: label },
    good: page({
      title,
      heading,
      body: "<h2>" + label + "</h2><p>The section contains useful guidance.</p>",
    }),
    bad: page({
      title,
      heading,
      body: "<div class=\"fake-heading\">" + label + "</div><p>The section contains useful guidance.</p>",
    }),
  });
}

function landmarkVariant(/** @type {any} */ { id, title, heading, label, text, task }) {
  return pair({
    id,
    family: "landmark-navigation",
    criterion: "1.3.1",
    task,
    source: "Web Accessibility Cookbook, chapter 22",
    mutation: "A visible page region is not exposed as a landmark.",
    badSignal: { type: "structure-empty", field: "landmarks" },
    good: page({
      title,
      heading,
      body: "<section aria-label=\"" + label + "\"><h2>" + label + "</h2><p>" + text + "</p></section>",
    }),
    bad: page({
      title,
      heading,
      body: "<div><h2>" + label + "</h2><p>" + text + "</p></div>",
      landmark: false,
    }),
  });
}

function unlabelledFieldVariant(/** @type {any} */ { id, title, heading, label, name, task }) {
  return pair({
    id,
    family: "form-labels",
    criterion: "3.3.2",
    // Same second failure as the base `form-unlabelled` case: the field announces as a bare "edit", a
    // role with no accessible name. Deliberately NOT on `placeholderOnlyVariant`, which is 3.3.2 only —
    // a placeholder supplies a name and it does not fire 4.1.2, verified against its capture. See the
    // base case for why this is asserted per generator rather than by criterion.
    // `4.1.2:unnamed-control`, NOT `4.1.2:missing-role`. Every one of these three sites described the
    // evidence correctly in its own comment -- "a bare role with no accessible name" -- and then routed
    // it to the head for the OPPOSITE failure. Measured consequence: `4.1.2:missing-role` carried 189
    // positives that split 74/115 into two disjoint signatures, and the split is perfect -- all 74
    // genuine fake-button records announce NOTHING (`formFields: []`, `controls: []`), all 115 of these
    // announce a bare "edit". One linear head over a frozen embedding was asked to learn "nothing is
    // announced OR something is announced unnamed", with the second class as 61% of its positives.
    //
    // It cannot be threshold-tuned away, because "nothing is announced" is not a usable signal on its
    // own: 437 of the corpus's 1001 CONFORMANT records look identical on that axis (pages about images
    // and tables have no controls either). So the calibrator must push the cut up until the empty half
    // is excluded, which is exactly the 0.90 threshold at precision 1.000 and recall 0.875 -- the 20
    // false negatives that blocked release.
    //
    // Same precedent as `icon-button-unnamed` above: one failure mode belongs in one subtype, and an
    // unnamed field is the same failure as an unnamed icon button.
    alsoFails: ["4.1.2:unnamed-control"],
    task,
    source: "Practical Web Accessibility, chapter 6; Inclusive Design for Accessibility, chapter 13",
    mutation: "The field has nearby visible text but no programmatic label.",
    badSignal: { type: "unnamed-form-field" },
    good: page({
      title,
      heading,
      body: "<form><label for=\"" + name + "\">" + label + "</label><input id=\"" + name + "\" name=\"" + name + "\"></form>",
      script: "document.querySelector('input').focus();",
    }),
    bad: page({
      title,
      heading,
      body: "<form><span>" + label + "</span><input name=\"" + name + "\"></form>",
      script: "document.querySelector('input').focus();",
    }),
    probeForms: true,
  });
}

function placeholderOnlyVariant(/** @type {any} */ { id, title, heading, label, name, task }) {
  return pair({
    id,
    criterion: "3.3.2",
    task,
    source: "Practical Web Accessibility, chapter 6",
    mutation: "The field relies on a placeholder instead of a persistent label.",
    badSignal: { type: "placeholder-only", placeholder: "Example value" },
    good: page({
      title,
      heading,
      body: "<form><label for=\"" + name + "\">" + label + "</label><input id=\"" + name + "\" name=\"" + name + "\" placeholder=\"Example value\"></form>",
      script: "document.querySelector('input').focus();",
    }),
    bad: page({
      title,
      heading,
      body: "<form><input name=\"" + name + "\" placeholder=\"Example value\"></form>",
      script: "document.querySelector('input').focus();",
    }),
    probeForms: true,
  });
}

function customControlVariant(/** @type {any} */ { id, title, heading, label, task }) {
  return pair({
    id,
    // NOTE it shares `family` with `unnamedIconVariant` and is a DIFFERENT failure: this one strips the
    // role entirely (a styled div, announced as nothing), that one strips the name (a button announced
    // with no label). Same page shape, so grouping them for the split is right; but the shared family
    // name makes them easy to confuse, and a subtype marker was briefly attached to the wrong one here.
    family: "control-name-role",
    criterion: "4.1.2",
    task,
    source: "Practical Web Accessibility, chapter 6; Web Accessibility Cookbook, chapter 22",
    mutation: "A styled text element looks like a button but has no exposed role.",
    badSignal: { type: "missing-role", text: label },
    good: page({
      title,
      heading,
      body: "<button type=\"button\">" + label + "</button>",
      script: "document.querySelector('button').focus();",
    }),
    bad: page({
      title,
      heading,
      body: "<div class=\"card\">" + label + "</div>",
    }),
    probeForms: true,
  });
}

function unnamedIconVariant(/** @type {any} */ { id, title, heading, name, task }) {
  return pair({
    id,
    family: "control-name-role",
    criterion: "4.1.2",
    // See the `icon-button-unnamed` seed: named for the failure, and shared with the unlabelled fields.
    subtype: "unnamed-control",
    task,
    source: "Practical Web Accessibility, chapter 6",
    mutation: "An icon-only button has no accessible name.",
    // NVDA announces an unnamed control EITHER as "button, <U+FFFC>" or as a bare "button",
    // and it varies between runs of the same page -- observed both ways across two full
    // capture runs. Match both: keying a signal on one observed string is how these went
    // blind in the first place.
    badSignal: {
      type: "regex",
      pattern: "(?:^|\\n)button[, ]*(?:" + UNNAMED_GRAPHIC + ")?[, ]*(?:$|\\n)",
      flags: "im",
    },
    good: page({
      title,
      heading,
      body: "<button type=\"button\" aria-label=\"" + name + "\"><span aria-hidden=\"true\">⌕</span></button>",
      script: "document.querySelector('button').focus();",
    }),
    bad: page({
      title,
      heading,
      body: "<button type=\"button\"><span aria-hidden=\"true\">⌕</span></button>",
      script: "document.querySelector('button').focus();",
    }),
    probeForms: true,
  });
}

function disclosureVariant(/** @type {any} */ { id, title, heading, control, content, task }) {
  const goodScript = "document.querySelector('#toggle').addEventListener('click', (event) => { const button = event.currentTarget; const open = button.getAttribute('aria-expanded') === 'true'; button.setAttribute('aria-expanded', String(!open)); document.querySelector('#content').hidden = open; });";
  const badScript = "document.querySelector('#toggle').addEventListener('click', () => { document.querySelector('#content').hidden = false; });";
  const body = "<button id=\"toggle\" type=\"button\" aria-expanded=\"false\" aria-controls=\"content\">"
    + control + "</button><div id=\"content\" hidden>" + content + "</div>";
  return pair({
    id,
    family: "dynamic-state",
    criterion: "4.1.2",
    task,
    source: "Web Accessibility Cookbook, chapter 22; Practical Web Accessibility, chapter 6",
    mutation: "Activation changes visible content without updating the announced expanded state.",
    badSignal: { type: "state-change-silent", control },
    good: page({ title, heading, body, script: goodScript }),
    bad: page({ title, heading, body, script: badScript }),
    probeForms: true,
  });
}

function errorVariant(/** @type {any} */ { id, title, heading, field, submit, message, task }) {
  // Install the submit behaviour in the instrument itself. A trailing script is loaded only
  // after the form has rendered, so the probe can submit during that small window and navigate
  // away before preventDefault is attached (observed in both calibration and bulk fixtures).
  const goodBody = "<form id=\"form\" onsubmit=\"event.preventDefault(); document.querySelector('#field').setAttribute('aria-invalid', 'true'); document.querySelector('#error').hidden = false; document.querySelector('#field').focus();\"><label for=\"field\">" + field + "</label><input id=\"field\" aria-describedby=\"error\"><button type=\"submit\">" + submit + "</button><p id=\"error\" role=\"alert\" hidden>" + message + "</p></form>";
  // Keep this pair single-criterion. The original bad fixture also removed the field label,
  // which made every 3.3.1 failure a hidden 3.3.2 failure and taught the 3.3.2 head that an
  // unrelated silent validation message is evidence of an unlabeled control. The mutation
  // here is only the missing error association/announcement; the field stays labelled.
  const badBody = "<form id=\"form\"><label for=\"field\">" + field + "</label><input id=\"field\"><button type=\"submit\">" + submit + "</button><p class=\"error\" hidden>" + message + "</p></form>";
  const badBodyWithHandler = badBody.replace(
    '<form id="form">',
    '<form id="form" onsubmit="event.preventDefault(); document.querySelector(\'.error\').hidden = false;">',
  );
  return pair({
    id,
    family: "dynamic-feedback",
    criterion: "3.3.1",
    task,
    source: "Web Accessibility Cookbook, chapter 22; Practical Web Accessibility, chapter 6",
    mutation: "A validation message appears visually but is not associated with the invalid field or announced.",
    badSignal: { type: "validation-error-silent", control: submit },
    good: page({ title, heading, body: goodBody }),
    bad: page({ title, heading, body: badBodyWithHandler }),
    probeForms: true,
  });
}

/**
 * (3.3.3 Error Suggestion) The error IS announced, and names only the problem.
 *
 * `criterion-coverage.ts` recorded this as `reachable` with the reason spelled out: *"The form probe
 * already submits and re-reads; whether the announced error names a REMEDY rather than only a problem is
 * a judgement a head could learn."* No capture change is needed — this reads exactly the channels 3.3.1
 * already reads, which is why it is the one of the three reachable screen-reader criteria that costs no
 * recapture.
 *
 * BOTH VARIANTS ANNOUNCE, and that is the whole design. The good page and the bad page use the SAME
 * markup as `errorVariant`'s conformant side — `aria-invalid`, `role="alert"`, focus moved to the field —
 * so both satisfy 3.3.1 and the only difference between them is what the message SAYS. Anything else
 * would make every 3.3.3 positive a hidden 3.3.1 positive, which is the exact mistake `errorVariant`'s
 * own comment records: its first bad fixture also dropped the label, "which made every 3.3.1 failure a
 * hidden 3.3.2 failure and taught the 3.3.2 head that an unrelated silent validation message is evidence
 * of an unlabeled control".
 *
 * The remedy is a FORMAT or an ACTION the user can take -- "Enter the date as DD/MM/YYYY" -- against a
 * message that only asserts something is wrong -- "Invalid entry". WCAG's own wording is that the
 * suggestion must be PROVIDED to the user, so a message naming the field and nothing else fails.
 */
function errorRemedyVariant(/** @type {any} */ { id, title, heading, field, submit, remedy, problemOnly, task }) {
  const form = (/** @type {string} */ message) =>
    "<form id=\"form\" onsubmit=\"event.preventDefault(); document.querySelector('#field').setAttribute('aria-invalid', 'true');"
    + " document.querySelector('#error').hidden = false; document.querySelector('#field').focus();\">"
    + "<label for=\"field\">" + field + "</label><input id=\"field\" aria-describedby=\"error\">"
    + "<button type=\"submit\">" + submit + "</button>"
    + "<p id=\"error\" role=\"alert\" hidden>" + message + "</p></form>";
  return pair({
    id,
    family: "dynamic-feedback",
    criterion: "3.3.3",
    task,
    source: "WCAG 3.3.3 Understanding; Web Accessibility Cookbook, chapter 22",
    mutation: "The validation error is announced correctly but names only the problem, so a screen-reader "
      + "user is told the entry is wrong and not how to correct it.",
    badSignal: { type: "error-remedy-missing", control: submit },
    good: page({ title, heading, body: form(remedy) }),
    bad: page({ title, heading, body: form(problemOnly) }),
    probeForms: true,
  });
}

/**
 * (3.2.1 On Focus / 3.2.2 On Input) A change of CONTEXT caused by focus or by typing.
 *
 * WCAG's failure is a page that navigates, opens something, or redefines where the user is, from an act
 * the user did not intend as navigation. The part a screen reader can observe is the page TITLE, which is
 * why both probes read it — and why `criterion-coverage.ts` recorded these as `reachable` rather than
 * out of scope: the machinery existed, nothing drove it.
 *
 * ONE GENERATOR FOR BOTH, because the pages differ only in which EVENT rewrites the title. Writing them
 * apart would be the same fact twice, and the two criteria are deliberately the same shape — 3.2.2 is
 * 3.2.1 "on change rather than focus", in the coverage table's own words.
 *
 * The pair differs ONLY in the handler. Same field, same label, same title to begin with, and neither
 * page announces anything of its own — so nothing here is a 3.3.x finding in disguise, which is the
 * single-criterion discipline `errorVariant`'s comment records paying for.
 *
 * @param {{ id: string, title: string, heading: string, field: string, changedTitle: string,
 *           task: string, on: "focus" | "input" }} spec
 */
function contextChangeVariant({ id, title, heading, field, changedTitle, task, on }) {
  const body = (/** @type {boolean} */ changes) =>
    "<form><label for=\"ctl\">" + field + "</label><input id=\"ctl\"></form>"
    + (changes
      ? "<script>document.querySelector('#ctl').addEventListener('" + on + "', function () {"
        + "document.title = " + JSON.stringify(changedTitle) + "; });</script>"
      : "");
  const criterion = on === "focus" ? "3.2.1" : "3.2.2";
  return pair({
    id,
    family: "context-change",
    criterion,
    subtype: on === "focus" ? "focus-context-change" : "input-context-change",
    task,
    source: "WCAG " + criterion + " Understanding",
    mutation: on === "focus"
      ? "Focusing the field silently renames the page, so a screen-reader user's sense of where they are "
        + "changes from an act they did not intend as navigation."
      : "Typing into the field silently renames the page, changing context on input rather than on a "
        + "deliberate submit.",
    badSignal: { type: on === "focus" ? "focus-context-change" : "input-context-change" },
    good: page({ title, heading, body: body(false) }),
    bad: page({ title, heading, body: body(true) }),
    probeFocus: true,
    ...(on === "focus" ? { probeFocusContext: true } : { probeTyping: true }),
  });
}

function statusVariant(/** @type {any} */ { id, title, heading, control, task }) {
  const body = "<button id=\"filter\" type=\"button\">" + control + "</button><p id=\"count\">Showing 8 items.</p><ul><li>First item</li><li>Second item</li></ul>";
  const goodBody = body.replace(
    "id=\"count\"",
    "id=\"count\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\"",
  );
  const script = "document.querySelector('#filter').addEventListener('click', () => { document.querySelector('#count').textContent = 'Showing 2 matching items.'; });";
  return pair({
    id,
    family: "dynamic-feedback",
    criterion: "4.1.3",
    task,
    source: "Web Accessibility Cookbook, chapter 22; Practical Web Accessibility, chapter 6",
    mutation: "A result count changes without a live status announcement.",
    badSignal: { type: "form-activation-silent", control, expected: "Showing 2 matching items." },
    good: page({ title, heading, body: goodBody, script }),
    bad: page({ title, heading, body, script }),
    probeForms: true,
  });
}

function tableVariant(/** @type {any} */ { id, title, heading, destination, task }) {
  const good = "<table><caption>Departures from Central station</caption><thead><tr><th scope=\"col\">Destination</th><th scope=\"col\">Departs</th><th scope=\"col\">Platform</th></tr></thead><tbody><tr><th scope=\"row\">" + destination + "</th><td>09:15</td><td>3</td></tr></tbody></table>";
  const bad = "<table><caption>Departures from Central station</caption><tr><td>Destination</td><td>Departs</td><td>Platform</td></tr><tr><td>" + destination + "</td><td>09:15</td><td>3</td></tr></table>";
  return pair({
    id,
    family: "table-relationships",
    criterion: "1.3.1",
    task,
    source: "Web Accessibility Cookbook, chapter 22; existing table eval fixtures",
    mutation: "Visual table headers are not associated with their data cells.",
    badSignal: { type: "table-unassociated" },
    probeTables: true,
    good: page({ title, heading, body: good }),
    bad: page({ title, heading, body: bad }),
  });
}

function variedTableVariant(/** @type {any} */ { id, title, heading, caption, headers, row, task }) {
  const good = "<table><caption>" + caption + "</caption><thead><tr>"
    + headers.map((/** @type {any} */ header) => "<th scope=\"col\">" + header + "</th>").join("")
    + "</tr></thead><tbody><tr><th scope=\"row\">" + row[0] + "</th>"
    + row.slice(1).map((/** @type {any} */ value) => "<td>" + value + "</td>").join("")
    + "</tr></tbody></table>";
  const bad = "<table><caption>" + caption + "</caption><tr>"
    + headers.map((/** @type {any} */ header) => "<td>" + header + "</td>").join("")
    + "</tr><tr>" + row.map((/** @type {any} */ value) => "<td>" + value + "</td>").join("") + "</tr></table>";
  return pair({
    id,
    family: id,
    criterion: "1.3.1",
    task,
    source: "Web Accessibility Cookbook, chapter 22; Practical Web Accessibility, chapter 4",
    mutation: "The data table loses header associations while retaining its visible rows and caption.",
    badSignal: { type: "table-unassociated" },
    probeTables: true,
    good: page({ title, heading, body: good }),
    bad: page({ title, heading, body: bad }),
  });
}

function labelledControlVariant(/** @type {any} */ { id, title, heading, label, name, control, selector = "input", task }) {
  const labelled = control({ labelled: true, name });
  const unlabelled = control({ labelled: false, name });
  return pair({
    id,
    family: id,
    criterion: "3.3.2",
    // The `field-followup-*` family, and the same second failure: stripping the programmatic label
    // leaves the control announced as a bare role with no accessible name, which is 4.1.2. Confirmed on
    // `field-followup-date.bad`, whose 4.1.2 evidence is the single token "edit". See `form-unlabelled`
    // for why this is asserted per generator rather than applied to every 3.3.2 case.
    // `4.1.2:unnamed-control`, NOT `4.1.2:missing-role`. Every one of these three sites described the
    // evidence correctly in its own comment -- "a bare role with no accessible name" -- and then routed
    // it to the head for the OPPOSITE failure. Measured consequence: `4.1.2:missing-role` carried 189
    // positives that split 74/115 into two disjoint signatures, and the split is perfect -- all 74
    // genuine fake-button records announce NOTHING (`formFields: []`, `controls: []`), all 115 of these
    // announce a bare "edit". One linear head over a frozen embedding was asked to learn "nothing is
    // announced OR something is announced unnamed", with the second class as 61% of its positives.
    //
    // It cannot be threshold-tuned away, because "nothing is announced" is not a usable signal on its
    // own: 437 of the corpus's 1001 CONFORMANT records look identical on that axis (pages about images
    // and tables have no controls either). So the calibrator must push the cut up until the empty half
    // is excluded, which is exactly the 0.90 threshold at precision 1.000 and recall 0.875 -- the 20
    // false negatives that blocked release.
    //
    // Same precedent as `icon-button-unnamed` above: one failure mode belongs in one subtype, and an
    // unnamed field is the same failure as an unnamed icon button.
    alsoFails: ["4.1.2:unnamed-control"],
    task,
    source: "Practical Web Accessibility, chapter 6; Inclusive Design for Accessibility, chapter 13",
    mutation: "The form control loses its programmatic label while the same visible cue remains nearby.",
    badSignal: { type: "unnamed-form-field" },
    good: page({
      title,
      heading,
      body: "<form><label for=\"" + name + "\">" + label + "</label>" + labelled + "</form>",
      script: "document.querySelector('" + selector + "').focus();",
    }),
    bad: page({
      title,
      heading,
      body: "<form><span>" + label + "</span>" + unlabelled + "</form>",
      script: "document.querySelector('" + selector + "').focus();",
    }),
    probeForms: true,
  });
}

const generatedCases = [
  imageVariant({ id: "image-missing-alt-map", title: "Park map", heading: "Park map", description: "The east entrance is beside the lake.", file: "park-map.png", goodAlt: "Map showing the east entrance beside the lake", badAlt: null, task: "Find the east entrance on the park map." }),
  imageVariant({ id: "image-missing-alt-building", title: "Civic centre", heading: "Civic centre", description: "The restored building opens on Monday.", file: "civic-centre.png", goodAlt: "Front entrance of the restored civic centre", badAlt: null, task: "Understand what the civic centre image shows." }),
  imageVariant({ id: "image-generic-alt-recipe", title: "Recipe guide", heading: "Recipe guide", description: "The final dish is ready to serve.", file: "finished-dish.png", goodAlt: "Bowl of vegetable soup with herbs on top", badAlt: "image", task: "Understand what the finished dish looks like." }),
  imageVariant({ id: "image-filename-alt-exhibit", title: "Museum exhibit", heading: "Museum exhibit", description: "The exhibit explains how the harbour changed.", file: "harbour_07-final.jpg", goodAlt: "Historic photograph of the harbour before the new bridge", badAlt: "harbour_07-final.jpg", task: "Read the description of the harbour exhibit." }),
  linkVariant({ id: "link-vague-details", title: "Course catalogue", heading: "Course catalogue", context: "The evening drawing course begins next month.", vague: "Details", descriptive: "View the evening drawing course details", task: "Open the evening drawing course details." }),
  linkVariant({ id: "link-vague-here", title: "Travel information", heading: "Travel information", context: "The station has step-free access.", vague: "Here", descriptive: "Read the station step-free access information", task: "Read the station step-free access information." }),
  linkVariant({ id: "link-vague-more", title: "Volunteer roles", heading: "Volunteer roles", context: "The archive needs help cataloguing photographs.", vague: "More", descriptive: "Learn more about archive cataloguing volunteer roles", task: "Learn about archive cataloguing volunteer roles." }),
  linkVariant({ id: "link-vague-go", title: "Account options", heading: "Account options", context: "Choose the option for changing a password.", vague: "Go", descriptive: "Open the change password instructions", task: "Open the change password instructions." }),
  vagueHeadingVariant({ id: "headings-vague-welcome", title: "Museum guide", heading: "Museum guide", vague: "Welcome", descriptive: "Permanent collection highlights", task: "Navigate to the permanent collection highlights." }),
  vagueHeadingVariant({ id: "headings-vague-stuff", title: "Repair service", heading: "Repair service", vague: "Stuff", descriptive: "What to bring to your appointment", task: "Find what to bring to the repair appointment." }),
  vagueHeadingVariant({ id: "headings-vague-things", title: "School trip", heading: "School trip", vague: "Things", descriptive: "Information for visiting school groups", task: "Find information for visiting school groups." }),
  landmarkVariant({ id: "landmarks-missing-news", title: "Town news", heading: "Town news", label: "Latest news", text: "The council approved a new playground.", task: "Jump to the latest news." }),
  landmarkVariant({ id: "landmarks-missing-help", title: "Help centre", heading: "Help centre", label: "Account help", text: "You can change your sign-in details here.", task: "Jump to account help." }),
  landmarkVariant({ id: "landmarks-missing-events", title: "Events calendar", heading: "Events calendar", label: "Upcoming events", text: "The next event is on Saturday.", task: "Jump to upcoming events." }),
  unlabelledFieldVariant({ id: "form-unlabelled-address", title: "Delivery address", heading: "Delivery address", label: "Street address", name: "street", task: "Enter the street address for delivery." }),
  unlabelledFieldVariant({ id: "form-unlabelled-phone", title: "Contact details", heading: "Contact details", label: "Telephone number", name: "phone", task: "Enter the telephone number for contact." }),
  unlabelledFieldVariant({ id: "form-unlabelled-reference", title: "Support request", heading: "Support request", label: "Case reference", name: "case", task: "Enter the case reference for support." }),
  customControlVariant({ id: "custom-control-archive", title: "Archive", heading: "Archive", label: "Archive selected messages", task: "Archive the selected messages." }),
  customControlVariant({ id: "custom-control-print", title: "Report", heading: "Report", label: "Print this report", task: "Print this report." }),
  customControlVariant({ id: "custom-control-refresh", title: "Dashboard", heading: "Dashboard", label: "Refresh dashboard", task: "Refresh the dashboard." }),
  unnamedIconVariant({ id: "icon-button-unnamed-menu", title: "Project menu", heading: "Project menu", name: "Open project menu", task: "Open the project menu." }),
  unnamedIconVariant({ id: "icon-button-unnamed-help", title: "Help options", heading: "Help options", name: "Open help options", task: "Open help options." }),
  disclosureVariant({ id: "disclosure-state-silent-parking", title: "Parking advice", heading: "Parking advice", control: "Parking rules", content: "Visitors may park for two hours.", task: "Open the parking rules." }),
  disclosureVariant({ id: "disclosure-state-silent-refunds", title: "Refund policy", heading: "Refund policy", control: "Refund details", content: "Refunds are processed within five working days.", task: "Open the refund details." }),
  errorVariant({ id: "form-error-silent-email", title: "Newsletter signup", heading: "Newsletter signup", field: "Email address", submit: "Join newsletter", message: "Enter an email address before joining.", task: "Submit the newsletter form without an email address." }),
  errorVariant({ id: "form-error-silent-postcode", title: "Parcel booking", heading: "Parcel booking", field: "Postcode", submit: "Book parcel", message: "Enter the postcode before booking.", task: "Submit the parcel booking without a postcode." }),
  statusVariant({ id: "filter-status-silent-colours", title: "Clothing catalogue", heading: "Clothing catalogue", control: "Show blue items", task: "Show blue items and notice the result count." }),
  statusVariant({ id: "filter-status-silent-prices", title: "Book catalogue", heading: "Book catalogue", control: "Show books under ten pounds", task: "Show books under ten pounds and notice the result count." }),
  tableVariant({ id: "table-unassociated-hilltown", title: "Train timetable", heading: "Train timetable", destination: "Hilltown", task: "Compare the departure time and platform for Hilltown." }),
  tableVariant({ id: "table-unassociated-lakeside", title: "Train timetable", heading: "Train timetable", destination: "Lakeside", task: "Compare the departure time and platform for Lakeside." }),
];

cases.push(...generatedCases);

// A seed matrix proves that the capture and labelling instruments work. The next layer
// deliberately varies topic, wording, and content shape while keeping one known mutation
// per pair. Each generated case gets its own family so grouped train/test splits do not
// mistake a dozen unrelated pages for one independent example.
const independent = (/** @type {any} */ testCase) => ({ ...testCase, family: testCase.id });

const expandedCases = [
  ...[
    ["image-missing-alt-ferry", "River ferry", "River ferry", "The new ferry leaves every hour.", "ferry-terminal.jpg", "Photograph of the new river ferry at the terminal", null, "Find the new ferry on the page."],
    ["image-missing-alt-garden", "Winter garden", "Winter garden", "The garden stays open throughout winter.", "winter-garden.jpg", "A glasshouse filled with winter plants", null, "Understand what the winter garden looks like."],
    ["image-missing-alt-hall", "Community hall", "Community hall", "The hall is available for evening meetings.", "community-hall.jpg", "Front entrance of the community hall", null, "Find the entrance to the community hall."],
    ["image-missing-alt-coast", "Coastal path", "Coastal path", "The path follows the cliffs to the lighthouse.", "coastal-path.jpg", "Coastal path leading towards the lighthouse", null, "Understand where the coastal path leads."],
    ["image-missing-alt-orchard", "Community orchard", "Community orchard", "The first apples are ready in September.", "orchard.jpg", "Rows of apple trees in the community orchard", null, "Understand what is growing in the orchard."],
    ["image-missing-alt-observatory", "Hill observatory", "Hill observatory", "The observatory opens after sunset.", "observatory.jpg", "The hill observatory beneath a clear evening sky", null, "Find out what the observatory looks like."],
    ["image-missing-alt-cycleway", "Bicycle route", "Bicycle route", "The new route avoids the busy road.", "cycleway.jpg", "A separated bicycle route beside the river", null, "Understand the new bicycle route."],
    ["image-missing-alt-library", "Library entrance", "Library entrance", "The library entrance is on the quieter side of the building.", "library-entrance.jpg", "The accessible entrance to the public library", null, "Find the accessible library entrance."],
    ["image-generic-alt-sports", "Sports centre", "Sports centre", "The centre has reopened its swimming pool.", "sports-centre.jpg", "Indoor swimming pool at the sports centre", "image", "Understand what facilities have reopened."],
    ["image-generic-alt-allotment", "Allotment garden", "Allotment garden", "Volunteers planted vegetables for the food bank.", "allotment.jpg", "Raised vegetable beds in the allotment garden", "photo", "Understand what the volunteers planted."],
    ["image-generic-alt-market", "Farmers market", "Farmers market", "The Saturday market has moved to the square.", "market-stall.jpg", "A fruit stall at the Saturday farmers market", "picture", "Understand what is sold at the market."],
    ["image-generic-alt-theatre", "Theatre stage", "Theatre stage", "The autumn programme begins next week.", "theatre-stage.jpg", "The stage prepared for the autumn programme", "graphic", "Understand what is ready for the autumn programme."],
    ["image-filename-alt-flood", "Flood barrier", "Flood barrier", "The barrier protects the lower walkway.", "flood-barrier-final.jpg", "Flood barrier protecting the lower walkway", "flood-barrier-final.jpg", "Understand what the flood barrier protects."],
    ["image-filename-alt-wildlife", "Wildlife reserve", "Wildlife reserve", "The reserve protects nesting birds.", "reserve-entrance-02.jpg", "Entrance to the wildlife reserve beside the reed beds", "reserve-entrance-02.jpg", "Find the entrance to the wildlife reserve."],
    ["image-filename-alt-solar", "Solar array", "Solar array", "The solar array powers the visitor centre.", "solar-array-2026.jpg", "Solar panels beside the visitor centre", "solar-array-2026.jpg", "Understand what powers the visitor centre."],
    ["image-filename-alt-clinic", "Health clinic", "Health clinic", "The clinic has added a new reception desk.", "clinic-reception-01.jpg", "Reception desk at the new health clinic", "clinic-reception-01.jpg", "Find the new clinic reception desk."],
  ].map(([id, title, heading, description, file, goodAlt, badAlt, task]) => independent(imageVariant({ id, title, heading, description, file, goodAlt, badAlt, task }))),
  ...[
    ["link-vague-ferry", "Ferry timetable", "Ferry timetable", "The morning ferry reaches the island at nine.", "Here", "Read the morning ferry timetable", "Open the morning ferry timetable."],
    ["link-vague-garden", "Garden visits", "Garden visits", "The winter garden requires a booking.", "Details", "View winter garden booking details", "Open the winter garden booking details."],
    ["link-vague-hall", "Hall bookings", "Hall bookings", "The community hall is available on Tuesdays.", "More", "See community hall Tuesday availability", "Check Tuesday availability for the hall."],
    ["link-vague-coast", "Coastal safety", "Coastal safety", "Check the tide before walking near the cliffs.", "Read more", "Read coastal cliff safety advice", "Read the coastal cliff safety advice."],
    ["link-vague-orchard", "Orchard volunteering", "Orchard volunteering", "The next volunteer day is in October.", "Click here", "Register for the October orchard volunteer day", "Register for the orchard volunteer day."],
    ["link-vague-observatory", "Observatory visits", "Observatory visits", "The evening tour starts at eight.", "Go", "Open the evening observatory tour information", "Open the evening observatory tour information."],
    ["link-vague-cycleway", "Cycle route map", "Cycle route map", "The route includes a new bridge crossing.", "Info", "View the cycle route bridge information", "View the cycle route bridge information."],
    ["link-vague-library", "Library services", "Library services", "The library offers home delivery to members.", "This", "Read about library home delivery", "Read about library home delivery."],
    ["link-vague-sports", "Sports centre classes", "Sports centre classes", "New swimming classes start in September.", "Learn more", "View September swimming class times", "View the September swimming class times."],
    ["link-vague-allotment", "Allotment plots", "Allotment plots", "A few plots are available near the entrance.", "More", "Apply for an allotment plot near the entrance", "Apply for an allotment plot."],
    ["link-vague-market", "Market traders", "Market traders", "Local traders can apply for a Saturday pitch.", "Details", "Read the Saturday market trader requirements", "Read the Saturday market trader requirements."],
    ["link-vague-theatre", "Theatre programme", "Theatre programme", "The autumn play opens on Thursday.", "Here", "See the autumn theatre programme", "See the autumn theatre programme."],
    ["link-vague-flood", "Flood preparation", "Flood preparation", "Residents should prepare before heavy rain.", "Click here", "Read flood preparation guidance for residents", "Read flood preparation guidance."],
    ["link-vague-wildlife", "Wildlife reserve visits", "Wildlife reserve visits", "The nesting area closes in spring.", "More", "Read wildlife reserve nesting-area guidance", "Read the nesting-area guidance."],
    ["link-vague-solar", "Energy centre", "Energy centre", "The visitor centre explains how solar power works.", "Go", "Visit the solar power explanation", "Visit the solar power explanation."],
    ["link-vague-clinic", "Clinic appointments", "Clinic appointments", "Appointments can be changed online.", "Details", "Change a health clinic appointment online", "Change a health clinic appointment online."],
  ].map(([id, title, heading, context, vague, descriptive, task]) => independent(linkVariant({ id, title, heading, context, vague, descriptive, task }))),
  ...[
    ["heading-vague-ferry", "Ferry information", "Ferry information", "Welcome", "Ferry departure times", "Find the ferry departure times."],
    ["heading-vague-garden", "Garden guide", "Garden guide", "Overview", "Winter planting advice", "Find the winter planting advice."],
    ["heading-vague-hall", "Hall guide", "Hall guide", "Stuff", "Facilities available in the hall", "Find the hall facilities."],
    ["heading-vague-coast", "Coastal walk", "Coastal walk", "Things", "Safety advice for the coastal walk", "Find the coastal safety advice."],
    ["heading-vague-orchard", "Orchard guide", "Orchard guide", "Information", "How to volunteer in the orchard", "Find how to volunteer in the orchard."],
    ["heading-vague-observatory", "Observatory guide", "Observatory guide", "Notes", "What to expect on an evening visit", "Find what to expect on the evening visit."],
    ["heading-vague-cycleway", "Cycle route guide", "Cycle route guide", "Updates", "Changes to the cycle route", "Find the cycle route changes."],
    ["heading-vague-library", "Library guide", "Library guide", "Welcome", "How home delivery works", "Find how library home delivery works."],
    ["heading-vague-sports", "Sports centre guide", "Sports centre guide", "Options", "Swimming classes for beginners", "Find the beginner swimming classes."],
    ["heading-vague-allotment", "Allotment guide", "Allotment guide", "More", "Preparing a new allotment plot", "Find how to prepare a plot."],
    ["heading-vague-market", "Market guide", "Market guide", "Section", "Rules for Saturday traders", "Find the Saturday trader rules."],
    ["heading-vague-theatre", "Theatre guide", "Theatre guide", "Introduction", "Access arrangements for performances", "Find the performance access arrangements."],
    ["heading-vague-flood", "Flood guide", "Flood guide", "Help", "Steps to take before heavy rain", "Find the flood preparation steps."],
    ["heading-vague-wildlife", "Wildlife guide", "Wildlife guide", "Miscellaneous", "Keeping dogs away from nesting birds", "Find the nesting-bird guidance."],
    ["heading-vague-solar", "Energy guide", "Energy guide", "Next", "How the solar array supports the centre", "Find how the solar array works."],
    ["heading-vague-clinic", "Clinic guide", "Clinic guide", "Details", "Changing an appointment", "Find how to change an appointment."],
  ].map(([id, title, heading, vague, descriptive, task]) => independent(vagueHeadingVariant({ id, title, heading, vague, descriptive, task }))),
  ...[
    ["landmark-vague-ferry", "Ferry services", "Ferry services", "Departure information", "Ferries leave from the east quay.", "Jump to ferry departure information."],
    ["landmark-vague-garden", "Garden services", "Garden services", "Visitor information", "The glasshouse is open every afternoon.", "Jump to garden visitor information."],
    ["landmark-vague-hall", "Hall services", "Hall services", "Booking information", "Bookings are available six weeks ahead.", "Jump to hall booking information."],
    ["landmark-vague-coast", "Coastal services", "Coastal services", "Walking information", "The path is closed during severe weather.", "Jump to coastal walking information."],
    ["landmark-vague-orchard", "Orchard services", "Orchard services", "Volunteer information", "Volunteers meet at the tool shed.", "Jump to orchard volunteer information."],
    ["landmark-vague-observatory", "Observatory services", "Observatory services", "Visit information", "Evening visitors should arrive fifteen minutes early.", "Jump to observatory visit information."],
    ["landmark-vague-cycleway", "Cycle services", "Cycle services", "Route information", "The route is signposted from the station.", "Jump to cycle route information."],
    ["landmark-vague-library", "Library services", "Library services", "Delivery information", "Members can request two deliveries each month.", "Jump to library delivery information."],
  ].map(([id, title, heading, label, text, task]) => independent(landmarkVariant({ id, title, heading, label, text, task }))),
  ...[
    ["table-ferry", "Ferry departures", "Ferry departures", "Island", "Compare the departure time and platform for Island."],
    ["table-garden", "Garden timetable", "Garden timetable", "Glasshouse", "Compare the opening time and gate for Glasshouse."],
    ["table-hall", "Hall timetable", "Hall timetable", "Main hall", "Compare the booking time and room for Main hall."],
    ["table-coast", "Coastal buses", "Coastal buses", "Lighthouse", "Compare the departure time and stop for Lighthouse."],
    ["table-orchard", "Orchard schedule", "Orchard schedule", "Tool shed", "Compare the meeting time and location for Tool shed."],
    ["table-observatory", "Observatory tours", "Observatory tours", "Evening tour", "Compare the start time and room for Evening tour."],
    ["table-cycleway", "Cycle buses", "Cycle buses", "Riverside", "Compare the departure time and stop for Riverside."],
    ["table-library", "Library deliveries", "Library deliveries", "Home delivery", "Compare the day and route for Home delivery."],
  ].map(([id, title, heading, destination, task]) => independent(tableVariant({ id, title, heading, destination, task }))),
  ...[
    ["form-unlabelled-ferry", "Ferry booking", "Ferry booking", "Passenger name", "passenger", "Enter the passenger name for the ferry booking."],
    ["form-unlabelled-garden", "Garden booking", "Garden booking", "Visit date", "visit-date", "Enter the date for the garden visit."],
    ["form-unlabelled-hall", "Hall booking", "Hall booking", "Booking contact", "contact", "Enter the hall booking contact."],
    ["form-unlabelled-coast", "Coastal permit", "Coastal permit", "Group size", "group-size", "Enter the group size for the coastal permit."],
    ["form-unlabelled-orchard", "Orchard volunteer", "Orchard volunteer", "Emergency contact", "emergency", "Enter the emergency contact for volunteering."],
    ["form-unlabelled-observatory", "Observatory booking", "Observatory booking", "Visitor count", "visitors", "Enter the number of observatory visitors."],
    ["form-unlabelled-cycleway", "Cycle hire", "Cycle hire", "Hire duration", "duration", "Enter the cycle hire duration."],
    ["form-unlabelled-library", "Library delivery", "Library delivery", "Delivery postcode", "postcode", "Enter the delivery postcode."],
    ["form-unlabelled-sports", "Sports class", "Sports class", "Participant name", "participant", "Enter the participant name for the class."],
    ["form-unlabelled-allotment", "Allotment request", "Allotment request", "Plot preference", "plot", "Enter the preferred allotment plot."],
    ["form-unlabelled-market", "Market pitch", "Market pitch", "Trader name", "trader", "Enter the trader name for the market pitch."],
    ["form-unlabelled-theatre", "Theatre booking", "Theatre booking", "Booking email", "booking-email", "Enter the theatre booking email."],
    ["form-unlabelled-flood", "Flood alert", "Flood alert", "Alert postcode", "alert-postcode", "Enter the postcode for flood alerts."],
    ["form-unlabelled-wildlife", "Wildlife visit", "Wildlife visit", "Group leader", "leader", "Enter the wildlife group leader."],
    ["form-unlabelled-solar", "Energy tour", "Energy tour", "Visitor organisation", "organisation", "Enter the visitor organisation."],
    ["form-unlabelled-clinic", "Clinic booking", "Clinic booking", "Patient identifier", "patient", "Enter the patient identifier."],
  ].map(([id, title, heading, label, name, task]) => independent(unlabelledFieldVariant({ id, title, heading, label, name, task }))),
  ...[
    ["custom-control-ferry", "Ferry dashboard", "Ferry dashboard", "Refresh departure board", "Refresh the ferry departure board."],
    ["custom-control-garden", "Garden dashboard", "Garden dashboard", "Book a garden visit", "Book a garden visit."],
    ["custom-control-hall", "Hall dashboard", "Hall dashboard", "Save hall booking", "Save the hall booking."],
    ["custom-control-coast", "Coastal dashboard", "Coastal dashboard", "Show tide warning", "Show the coastal tide warning."],
    ["custom-control-orchard", "Orchard dashboard", "Orchard dashboard", "Join volunteer list", "Join the orchard volunteer list."],
    ["custom-control-observatory", "Observatory dashboard", "Observatory dashboard", "Start evening tour", "Start the evening observatory tour."],
    ["custom-control-cycleway", "Cycle dashboard", "Cycle dashboard", "Plan cycle route", "Plan the cycle route."],
    ["custom-control-library", "Library dashboard", "Library dashboard", "Request delivery", "Request a library delivery."],
  ].map(([id, title, heading, label, task]) => independent(customControlVariant({ id, title, heading, label, task }))),
  ...[
    ["icon-button-unnamed-ferry", "Ferry controls", "Ferry controls", "Open departure filters", "Open the ferry departure filters."],
    ["icon-button-unnamed-garden", "Garden controls", "Garden controls", "Open visitor filters", "Open the garden visitor filters."],
    ["icon-button-unnamed-hall", "Hall controls", "Hall controls", "Open booking filters", "Open the hall booking filters."],
    ["icon-button-unnamed-coast", "Coastal controls", "Coastal controls", "Open route filters", "Open the coastal route filters."],
  ].map(([id, title, heading, name, task]) => independent(unnamedIconVariant({ id, title, heading, name, task }))),
  ...[
    ["disclosure-state-silent-ferry", "Ferry advice", "Ferry advice", "Ferry rules", "Passengers may bring one small bag.", "Open the ferry rules."],
    ["disclosure-state-silent-garden", "Garden advice", "Garden advice", "Glasshouse rules", "Visitors should keep to the marked paths.", "Open the glasshouse rules."],
    ["disclosure-state-silent-hall", "Hall advice", "Hall advice", "Booking rules", "Bookings must be cancelled two days ahead.", "Open the hall booking rules."],
    ["disclosure-state-silent-coast", "Coastal advice", "Coastal advice", "Tide rules", "Do not cross the rocks at high tide.", "Open the coastal tide rules."],
  ].map(([id, title, heading, control, content, task]) => independent(disclosureVariant({ id, title, heading, control, content, task }))),
  ...[
    ["form-error-silent-ferry", "Ferry booking", "Ferry booking", "Passenger name", "Submit booking", "Enter the passenger name before booking.", "Submit the ferry booking without a passenger name."],
    ["form-error-silent-garden", "Garden booking", "Garden booking", "Visit date", "Book visit", "Enter the visit date before booking.", "Submit the garden booking without a visit date."],
    ["form-error-silent-hall", "Hall booking", "Hall booking", "Contact email", "Save booking", "Enter a contact email before saving.", "Submit the hall booking without a contact email."],
    ["form-error-silent-coast", "Coastal permit", "Coastal permit", "Group size", "Request permit", "Enter the group size before requesting.", "Submit the coastal permit without a group size."],
    ["form-error-silent-orchard", "Orchard volunteer", "Orchard volunteer", "Emergency contact", "Join list", "Enter an emergency contact before joining.", "Submit the volunteer form without an emergency contact."],
    ["form-error-silent-observatory", "Observatory booking", "Observatory booking", "Visitor count", "Submit booking", "Enter the visitor count before booking.", "Submit the observatory booking without a visitor count."],
    ["form-error-silent-cycleway", "Cycle hire", "Cycle hire", "Hire duration", "Hire cycle", "Enter the hire duration before hiring.", "Submit the cycle hire form without a duration."],
    ["form-error-silent-library", "Library delivery", "Library delivery", "Delivery postcode", "Request delivery", "Enter the postcode before requesting.", "Submit the library delivery form without a postcode."],
    ["form-error-silent-sports", "Sports class", "Sports class", "Participant name", "Join class", "Enter the participant name before joining.", "Submit the sports class form without a participant name."],
    ["form-error-silent-allotment", "Allotment request", "Allotment request", "Plot preference", "Request plot", "Enter a plot preference before requesting.", "Submit the allotment request without a plot preference."],
    ["form-error-silent-market", "Market pitch", "Market pitch", "Trader name", "Request pitch", "Enter the trader name before requesting.", "Submit the market pitch form without a trader name."],
    ["form-error-silent-theatre", "Theatre booking", "Theatre booking", "Booking email", "Submit booking", "Enter the booking email before reserving.", "Submit the theatre booking without a booking email."],
    ["form-error-silent-flood", "Flood alert", "Flood alert", "Alert postcode", "Join alerts", "Enter the postcode before joining alerts.", "Submit the flood alert form without a postcode."],
    ["form-error-silent-wildlife", "Wildlife visit", "Wildlife visit", "Group leader", "Book visit", "Enter the group leader before booking.", "Submit the wildlife visit without a group leader."],
    ["form-error-silent-solar", "Energy tour", "Energy tour", "Organisation", "Book tour", "Enter the organisation before booking.", "Submit the energy tour without an organisation."],
    ["form-error-silent-clinic", "Clinic booking", "Clinic booking", "Patient identifier", "Save booking", "Enter the patient identifier before confirming.", "Submit the clinic booking without an identifier."],
  ].map(([id, title, heading, field, submit, message, task]) => independent(errorVariant({ id, title, heading, field, submit, message, task }))),
  // 3.3.3 Error Suggestion. Both variants announce correctly; only the MESSAGE differs, so a case can
  // never be a 3.3.1 positive in disguise.
  // 3.3.3 Error Suggestion. Both variants announce correctly; only the MESSAGE differs, so a case can
  // never be a 3.3.1 positive in disguise.
  //
  // The remedies vary in FORM on purpose -- a format, an example, a range, an instruction, a constraint --
  // so the head cannot separate on one phrase. The problem-only messages deliberately avoid "format" and
  // "must be", which ARE remedy markers: a bad page carrying one would make its own signal silent, and a
  // corpus case that cannot express its finding is worse than no case at all.
  ...[
    ["error-remedy-missing-date", "Garden booking", "Garden booking", "Visit date", "Book visit",
      "Enter the visit date as DD/MM/YYYY.", "Invalid entry.",
      "Submit the garden booking with a badly formatted visit date."],
    ["error-remedy-missing-postcode", "Parcel booking", "Parcel booking", "Delivery postcode", "Book parcel",
      "Enter a postcode such as SW1A 1AA.", "That is not accepted.",
      "Submit the parcel booking with an unrecognised postcode."],
    ["error-remedy-missing-group", "Coastal permit", "Coastal permit", "Group size", "Request permit",
      "Choose a group size between 1 and 12.", "This value is not allowed.",
      "Request a coastal permit with an out-of-range group size."],
    ["error-remedy-missing-phone", "Clinic booking", "Clinic booking", "Contact number", "Save booking",
      "Include the area code, for example 0161.", "Incorrect value.",
      "Confirm a clinic booking with an incomplete contact number."],
    ["error-remedy-missing-password", "Volunteer account", "Volunteer account", "Passphrase", "Register account",
      "Passphrase must be at least 12 characters.", "Not valid.",
      "Create a volunteer account with a short passphrase."],
    ["error-remedy-missing-email", "Newsletter signup", "Newsletter signup", "Contact email", "Join newsletter",
      "Enter an address such as name@example.org.", "Invalid entry.",
      "Join the newsletter with a malformed email address."],
    ["error-remedy-missing-reference", "Allotment request", "Allotment request", "Plot reference", "Request plot",
      "Plot references start with two letters, for example AB14.", "That is wrong.",
      "Request an allotment with a badly formed plot reference."],
    ["error-remedy-missing-time", "Ferry booking", "Ferry booking", "Departure time", "Book crossing",
      "Enter a time between 06:00 and 22:00.", "Unacceptable value.",
      "Book a ferry crossing outside the sailing window."],
    ["error-remedy-missing-count", "Observatory booking", "Observatory booking", "Visitor count", "Submit booking",
      "Choose a number between 1 and 30.", "This is not permitted.",
      "Submit an observatory booking with too many visitors."],
    ["error-remedy-missing-licence", "Cycle hire", "Cycle hire", "Licence number", "Hire cycle",
      "Licence numbers contain 16 characters, for example AB12CD34EF56GH78.", "Not accepted.",
      "Hire a cycle with a truncated licence number."],
    ["error-remedy-missing-name", "Market pitch", "Market pitch", "Trader name", "Request pitch",
      "Enter the trading name as it appears on your registration.", "Invalid.",
      "Request a market pitch with a mismatched trader name."],
    ["error-remedy-missing-year", "Library delivery", "Library delivery", "Year of birth", "Request delivery",
      "Enter a four-digit year, such as 1978.", "That is not right.",
      "Request a library delivery with a two-digit year of birth."],
    ["error-remedy-missing-amount", "Energy tour", "Energy tour", "Group budget", "Book tour",
      "Enter an amount in pounds, for example 250.", "This entry is wrong.",
      "Book an energy tour with an unreadable budget."],
    ["error-remedy-missing-postcode-alert", "Flood alert", "Flood alert", "Alert postcode", "Join alerts",
      "Enter the outward code only, such as CB1.", "Error in this field.",
      "Join flood alerts with a full postcode where an outward code is wanted."],
    ["error-remedy-missing-leader", "Wildlife visit", "Wildlife visit", "Group leader", "Book visit",
      "Enter the leader's full name as two words.", "Invalid entry.",
      "Book a wildlife visit with a single-word group leader."],
    ["error-remedy-missing-identifier", "Sports class", "Sports class", "Participant identifier", "Join class",
      "Identifiers must start with SC followed by five digits.", "Not acceptable.",
      "Join a sports class with a malformed participant identifier."],
  ].map(([id, title, heading, field, submit, remedy, problemOnly, task]) =>
    independent(errorRemedyVariant({ id, title, heading, field, submit, remedy, problemOnly, task }))),
  // 3.2.1 On Focus — focusing the field renames the page.
  ...[
    ["focus-context-change-archive", "Archive search", "Archive search", "Reference", "Results for the reference you typed",
      "Move to the reference field on the archive search page."],
    ["focus-context-change-permit", "Permit lookup", "Permit lookup", "Permit number", "Permits matching your entry",
      "Move to the permit number field on the permit lookup page."],
    ["focus-context-change-route", "Route planner", "Route planner", "Departure stop", "Routes from your chosen stop",
      "Move to the departure stop field on the route planner page."],
    ["focus-context-change-register", "Species register", "Species register", "Species name", "Register entries for that species",
      "Move to the species name field on the species register page."],
    ["focus-context-change-ledger", "Grant ledger", "Grant ledger", "Grant code", "Ledger filtered by grant code",
      "Move to the grant code field on the grant ledger page."],
    ["focus-context-change-roster", "Volunteer roster", "Volunteer roster", "Volunteer name", "Roster for the named volunteer",
      "Move to the volunteer name field on the volunteer roster page."],
    ["focus-context-change-survey", "Site survey", "Site survey", "Survey plot", "Survey readings for that plot",
      "Move to the survey plot field on the site survey page."],
    ["focus-context-change-tender", "Tender notices", "Tender notices", "Tender reference", "Notices for that tender",
      "Move to the tender reference field on the tender notices page."],
    ["focus-context-change-harbour", "Harbour bookings", "Harbour bookings", "Berth number", "Bookings for that berth",
      "Move to the berth number field on the harbour bookings page."],
    ["focus-context-change-kiln", "Kiln bookings", "Kiln bookings", "Firing slot", "Bookings for that firing slot",
      "Move to the firing slot field on the kiln bookings page."],
  ].map(([id, title, heading, field, changedTitle, task]) =>
    independent(contextChangeVariant({ id, title, heading, field, changedTitle, task, on: "focus" }))),
  // 3.2.2 On Input — the same failure, on typing rather than focus.
  ...[
    ["input-context-change-archive", "Archive search", "Archive search", "Reference", "Results for the reference you typed",
      "Type into the reference field on the archive search page."],
    ["input-context-change-permit", "Permit lookup", "Permit lookup", "Permit number", "Permits matching your entry",
      "Type into the permit number field on the permit lookup page."],
    ["input-context-change-route", "Route planner", "Route planner", "Departure stop", "Routes from your chosen stop",
      "Type into the departure stop field on the route planner page."],
    ["input-context-change-register", "Species register", "Species register", "Species name", "Register entries for that species",
      "Type into the species name field on the species register page."],
    ["input-context-change-ledger", "Grant ledger", "Grant ledger", "Grant code", "Ledger filtered by grant code",
      "Type into the grant code field on the grant ledger page."],
    ["input-context-change-roster", "Volunteer roster", "Volunteer roster", "Volunteer name", "Roster for the named volunteer",
      "Type into the volunteer name field on the volunteer roster page."],
    ["input-context-change-survey", "Site survey", "Site survey", "Survey plot", "Survey readings for that plot",
      "Type into the survey plot field on the site survey page."],
    ["input-context-change-tender", "Tender notices", "Tender notices", "Tender reference", "Notices for that tender",
      "Type into the tender reference field on the tender notices page."],
    ["input-context-change-harbour", "Harbour bookings", "Harbour bookings", "Berth number", "Bookings for that berth",
      "Type into the berth number field on the harbour bookings page."],
    ["input-context-change-kiln", "Kiln bookings", "Kiln bookings", "Firing slot", "Bookings for that firing slot",
      "Type into the firing slot field on the kiln bookings page."],
  ].map(([id, title, heading, field, changedTitle, task]) =>
    independent(contextChangeVariant({ id, title, heading, field, changedTitle, task, on: "input" }))),
  ...[
    ["filter-status-silent-ferry", "Ferry results", "Ferry results", "Show morning ferries", "Show morning ferries and notice the result count."],
    ["filter-status-silent-garden", "Garden results", "Garden results", "Show indoor gardens", "Show indoor gardens and notice the result count."],
    ["filter-status-silent-hall", "Hall results", "Hall results", "Show evening bookings", "Show evening bookings and notice the result count."],
    ["filter-status-silent-coast", "Coastal results", "Coastal results", "Show safe routes", "Show safe coastal routes and notice the result count."],
    ["filter-status-silent-orchard", "Orchard results", "Orchard results", "Show volunteer days", "Show orchard volunteer days and notice the result count."],
    ["filter-status-silent-observatory", "Observatory results", "Observatory results", "Show evening tours", "Show evening tours and notice the result count."],
    ["filter-status-silent-cycleway", "Cycle results", "Cycle results", "Show short routes", "Show short cycle routes and notice the result count."],
    ["filter-status-silent-library", "Library results", "Library results", "Show delivered books", "Show delivered books and notice the result count."],
    ["filter-status-silent-sports", "Sports results", "Sports results", "Show beginner classes", "Show beginner classes and notice the result count."],
    ["filter-status-silent-allotment", "Allotment results", "Allotment results", "Show available plots", "Show available plots and notice the result count."],
    ["filter-status-silent-market", "Market results", "Market results", "Show food traders", "Show food traders and notice the result count."],
    ["filter-status-silent-theatre", "Theatre results", "Theatre results", "Show accessible shows", "Show accessible shows and notice the result count."],
    ["filter-status-silent-flood", "Flood results", "Flood results", "Show current alerts", "Show current flood alerts and notice the result count."],
    ["filter-status-silent-wildlife", "Wildlife results", "Wildlife results", "Show bird walks", "Show bird walks and notice the result count."],
    ["filter-status-silent-solar", "Energy results", "Energy results", "Show solar tours", "Show solar tours and notice the result count."],
    ["filter-status-silent-clinic", "Clinic results", "Clinic results", "Show morning appointments", "Show morning appointments and notice the result count."],
  ].map(([id, title, heading, control, task]) => independent(statusVariant({ id, title, heading, control, task }))),
];

cases.push(...expandedCases);

// The first 173 pairs proved the instruments. This second batch is intentionally generated
// from many independent topics so the useful-baseline run has enough positive examples per
// criterion without hand-authoring hundreds of near-identical fixtures. These are still page
// instruments only: the exporter uses the NVDA captures, never these HTML strings.
const BULK_TOPICS = [
  "Aquarium", "Meadow", "Harbour", "Museum", "Station", "Playground", "Civic hall", "Wetland",
  "Gallery", "Food co-op", "Health centre", "Town square", "Bus depot", "Railway", "Ferry terminal", "Concert hall",
  "Learning centre", "Repair cafe", "Energy park", "River walk", "Hill farm", "Marina", "Stadium", "Greenhouse",
  "Bookshop", "Town hall", "Garden centre", "Science lab", "Swimming pool", "Wildlife trust", "Carers centre", "Housing office",
  "Youth club", "Shelter", "Recycling centre", "Fire station", "Post office", "Park gate", "Farm shop", "Bird hide",
  "Community kitchen", "Health pavilion", "Makerspace", "Market garden", "Coastal path", "Waterworks", "Sports field", "Cemetery",
  "Cultural centre", "Heritage centre", "Visitor dock", "Bus interchange", "Train depot", "Community forest", "Solar field", "Flood gate",
  "Volunteer centre", "Food bank", "Public square", "Local archive", "Bike workshop", "Day centre", "Civic theatre", "Music room",
  "Tide station", "Public garden", "Learning hub", "Wellbeing centre", "Nature trail", "Community pool", "Digital lab", "Art studio",
  "Farmers hall", "Advice centre", "Harbour office", "River station", "Town library", "Marsh boardwalk", "Coastal clinic", "Rail depot",
  "Forest cabin", "Wind farm", "Community orchard", "Canal lock", "Visitor shelter", "Sports pavilion", "Public archive", "Travel office",
];

function bulkTopic(/** @type {any} */ index) {
  const code = String(index).padStart(3, "0");
  const place = BULK_TOPICS[(index - 1) % BULK_TOPICS.length];
  const slug = place.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + code;
  return { code, place, slug, label: place + " " + code };
}

function bulkImageCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  return independent(imageVariant({
    id: "image-missing-alt-bulk-" + topic.slug,
    title: topic.label + " image",
    heading: topic.label + " image",
    description: "The latest update explains what visitors can expect at the " + topic.place.toLowerCase() + ".",
    file: "bulk-image-" + topic.slug + ".jpg",
    goodAlt: "Photograph of the " + topic.place.toLowerCase() + " visitor area",
    badAlt: null,
    task: "Understand what the " + topic.place.toLowerCase() + " visitor area looks like.",
  }));
}

function bulkLinkCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  const vague = ["Details", "More", "Here", "Go", "Info", "This"][index % 6];
  return independent(linkVariant({
    id: "link-vague-bulk-" + topic.slug,
    title: topic.label + " links",
    heading: topic.label + " links",
    context: "Read the latest information about the " + topic.place.toLowerCase() + ".",
    vague,
    descriptive: "View the " + topic.place.toLowerCase() + " visitor information",
    task: "Open the " + topic.place.toLowerCase() + " visitor information.",
  }));
}

function bulkHeadingCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  const vague = ["Overview", "Details", "Stuff", "Things", "Updates", "More"][index % 6];
  return independent(vagueHeadingVariant({
    id: "heading-vague-bulk-" + topic.slug,
    title: topic.label + " guide",
    heading: topic.label + " guide",
    vague,
    descriptive: "Visitor guidance for the " + topic.place.toLowerCase(),
    task: "Find the visitor guidance for the " + topic.place.toLowerCase() + ".",
  }));
}

function bulkLandmarkCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  const label = topic.place + " information";
  return independent(landmarkVariant({
    id: "landmark-vague-bulk-" + topic.slug,
    title: topic.label + " services",
    heading: topic.label + " services",
    label,
    text: "Opening information for the " + topic.place.toLowerCase() + " is listed here.",
    task: "Jump to the " + topic.place.toLowerCase() + " information.",
  }));
}

function bulkTableCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  return independent(tableVariant({
    id: "table-bulk-" + topic.slug,
    title: topic.label + " schedule",
    heading: topic.label + " schedule",
    destination: topic.place,
    task: "Compare the departure time and platform for " + topic.place + ".",
  }));
}

function bulkFieldCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  const name = "field-" + topic.slug;
  return independent(unlabelledFieldVariant({
    id: "form-unlabelled-bulk-" + topic.slug,
    title: topic.label + " form",
    heading: topic.label + " form",
    label: topic.place + " reference",
    name,
    task: "Enter the " + topic.place.toLowerCase() + " reference.",
  }));
}

function bulkCustomControlCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  const label = "Open " + topic.place.toLowerCase() + " details";
  return independent(customControlVariant({
    id: "custom-control-bulk-" + topic.slug,
    title: topic.label + " controls",
    heading: topic.label + " controls",
    label,
    task: "Open the " + topic.place.toLowerCase() + " details.",
  }));
}

function bulkDisclosureCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  const control = topic.place + " advice";
  return independent(disclosureVariant({
    id: "disclosure-state-silent-bulk-" + topic.slug,
    title: topic.label + " advice",
    heading: topic.label + " advice",
    control,
    content: "Visitors should follow the posted advice at the " + topic.place.toLowerCase() + ".",
    task: "Open the " + topic.place.toLowerCase() + " advice.",
  }));
}

function bulkErrorCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  const field = topic.place + " contact";
  const submit = "Submit " + topic.place.toLowerCase() + " form";
  return independent(errorVariant({
    id: "form-error-silent-bulk-" + topic.slug,
    title: topic.label + " booking",
    heading: topic.label + " booking",
    field,
    submit,
    message: "Enter the " + topic.place.toLowerCase() + " contact before submitting.",
    task: "Submit the " + topic.place.toLowerCase() + " form without a contact.",
  }));
}

function bulkStatusCase(/** @type {any} */ index) {
  const topic = bulkTopic(index);
  const control = "Show " + topic.place.toLowerCase() + " results";
  return independent(statusVariant({
    id: "filter-status-silent-bulk-" + topic.slug,
    title: topic.label + " results",
    heading: topic.label + " results",
    control,
    task: "Show the " + topic.place.toLowerCase() + " results and notice the count.",
  }));
}

const bulkCases = [
  ...Array.from({ length: 77 }, (_, index) => bulkImageCase(index + 1)),
  ...Array.from({ length: 78 }, (_, index) => bulkLinkCase(index + 1)),
  ...Array.from({ length: 81 }, (_, index) => bulkHeadingCase(index + 1)),
  ...Array.from({ length: 38 }, (_, index) => bulkLandmarkCase(index + 1)),
  ...Array.from({ length: 38 }, (_, index) => bulkTableCase(index + 1)),
  ...Array.from({ length: 79 }, (_, index) => bulkFieldCase(index + 1)),
  ...Array.from({ length: 37 }, (_, index) => bulkCustomControlCase(index + 1)),
  ...Array.from({ length: 37 }, (_, index) => bulkDisclosureCase(index + 1)),
  ...Array.from({ length: 81 }, (_, index) => bulkErrorCase(index + 1)),
  ...Array.from({ length: 81 }, (_, index) => bulkStatusCase(index + 1)),
];

cases.push(...bulkCases);

// Follow-up contrasts are chosen from the held-out error report. The first pass had enough
// volume to expose the problem, but its broad 1.3.1 head over-weighted the word "table" and
// its 3.3.2 head saw correctly named controls as suspicious. These are fresh page families,
// so they remain independent from the original split groups.
const TARGETED_CASES = [
  ...[
    ["table-followup-clinic", "Clinic appointments", "Clinic appointments", "Appointments for Monday", ["Patient", "Time", "Room"], ["Morgan", "09:00", "2"], "Compare Morgan's appointment time and room."],
    ["table-followup-garden", "Garden tasks", "Garden tasks", "Tasks for volunteers", ["Task", "Start", "Lead"], ["Seed beds", "08:30", "Priya"], "Find who leads seed beds and when it starts."],
    ["table-followup-market", "Market stalls", "Market stalls", "Saturday stall plan", ["Trader", "Stall", "Produce"], ["Amina", "14", "Apples"], "Find Amina's stall and produce."],
    ["table-followup-library", "Library returns", "Library returns", "Returns desk rota", ["Day", "Desk", "Staff"], ["Tuesday", "North", "Lee"], "Find the Tuesday returns desk and staff member."],
    ["table-followup-ferry", "Ferry fares", "Ferry fares", "Fares by passenger type", ["Passenger", "Single", "Return"], ["Adult", "8 pounds", "14 pounds"], "Compare the adult single and return fares."],
    ["table-followup-theatre", "Theatre seating", "Theatre seating", "Seats for the evening show", ["Section", "Rows", "Access"], ["Balcony", "A to D", "Lift"], "Find the accessible route to the balcony."],
    ["table-followup-weather", "Weather readings", "Weather readings", "Readings at noon", ["Station", "Temperature", "Wind"], ["Harbour", "18 degrees", "West"], "Find the harbour temperature and wind."],
    ["table-followup-recycling", "Recycling days", "Recycling days", "Collection schedule", ["Material", "Day", "Bin"], ["Glass", "Friday", "Blue"], "Find the glass collection day and bin."],
    ["table-followup-sports", "Sports fixtures", "Sports fixtures", "Fixtures this weekend", ["Team", "Opponent", "Pitch"], ["Rovers", "United", "Three"], "Find the Rovers pitch and opponent."],
    ["table-followup-archive", "Archive boxes", "Archive boxes", "Boxes awaiting review", ["Box", "Date", "Reviewer"], ["A12", "June", "Noor"], "Find who reviews box A12."],
    ["table-followup-bus", "Bus fares", "Bus fares", "Fares from the station", ["Destination", "Adult", "Child"], ["Riverside", "3 pounds", "1 pound"], "Compare the Riverside adult and child fares."],
    ["table-followup-courses", "Course timetable", "Course timetable", "Evening classes", ["Course", "Day", "Room"], ["Drawing", "Thursday", "Studio"], "Find the drawing class day and room."],
  ].map(([id, title, heading, caption, headers, row, task]) => variedTableVariant({ id, title, heading, caption, headers, row, task })),
  ...[
    ["landmark-followup-health", "Health centre", "Health centre", "Appointments", "Appointments are listed by clinic.", "Jump to the appointments information."],
    ["landmark-followup-travel", "Travel office", "Travel office", "Accessible travel", "Step-free routes leave from the east entrance.", "Jump to accessible travel information."],
    ["landmark-followup-museum", "Museum guide", "Museum guide", "Current exhibition", "The current exhibition opens at ten.", "Jump to the current exhibition."],
    ["landmark-followup-housing", "Housing advice", "Housing advice", "Repairs", "Emergency repairs can be reported at any time.", "Jump to repairs information."],
    ["landmark-followup-school", "School visits", "School visits", "Group bookings", "Group bookings need two weeks' notice.", "Jump to group bookings."],
    ["landmark-followup-water", "Water safety", "Water safety", "River conditions", "The river is fast after heavy rain.", "Jump to river conditions."],
    ["landmark-followup-park", "Park information", "Park information", "Play area", "The play area is open until dusk.", "Jump to play area information."],
    ["landmark-followup-energy", "Energy advice", "Energy advice", "Home energy", "Advice is available for insulation and heating.", "Jump to home energy advice."],
  ].map(([id, title, heading, label, text, task]) => independent(landmarkVariant({ id, title, heading, label, text, task }))),
  ...[
    // Native date/number/time inputs are announced by NVDA as composite spin-button and
    // picker widgets. Their labelled and unlabelled forms can collapse to the same output,
    // which makes the unnamed-field signal blind. Keep the input vocabulary varied while
    // using stable text-entry roles for this contrast.
    ["field-followup-date", "Garden booking", "Garden booking", "Visit date", "visit-date", "input", (/** @type {any} */ { labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the date for the garden visit."],
    ["field-followup-number", "Sports booking", "Sports booking", "Number of visitors", "visitor-count", "input", (/** @type {any} */ { labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the number of visitors."],
    ["field-followup-email", "Archive contact", "Archive contact", "Contact email", "contact-email", "input", (/** @type {any} */ { labelled, name }) => `<input type="email" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the archive contact email."],
    ["field-followup-select", "Ferry booking", "Ferry booking", "Passenger type", "passenger-type", "select", (/** @type {any} */ { labelled, name }) => `<select ${labelled ? `id="${name}"` : ""} name="${name}"><option>Adult</option><option>Child</option></select>`, "Choose the passenger type."],
    ["field-followup-select-route", "Travel booking", "Travel booking", "Route preference", "route", "select", (/** @type {any} */ { labelled, name }) => `<select ${labelled ? `id="${name}"` : ""} name="${name}"><option>Step-free route</option><option>Fastest route</option></select>`, "Choose a route preference."],
    ["field-followup-textarea", "Volunteer details", "Volunteer details", "Relevant experience", "experience", "textarea", (/** @type {any} */ { labelled, name }) => `<textarea ${labelled ? `id="${name}"` : ""} name="${name}"></textarea>`, "Describe the relevant experience."],
    ["field-followup-textarea-notes", "Clinic booking", "Clinic booking", "Appointment notes", "notes", "textarea", (/** @type {any} */ { labelled, name }) => `<textarea ${labelled ? `id="${name}"` : ""} name="${name}"></textarea>`, "Enter appointment notes."],
    ["field-followup-time", "Class booking", "Class booking", "Preferred start time", "start-time", "input", (/** @type {any} */ { labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Choose the preferred start time."],
    ["field-followup-tel", "Support request", "Support request", "Telephone number", "telephone", "input", (/** @type {any} */ { labelled, name }) => `<input type="tel" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the telephone number."],
    ["field-followup-search", "Library search", "Library search", "Search phrase", "search-phrase", "input", (/** @type {any} */ { labelled, name }) => `<input type="search" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter a library search phrase."],
    ["field-followup-text", "Market pitch", "Market pitch", "Trader name", "trader-name", "input", (/** @type {any} */ { labelled, name }) => `<input type="text" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the trader name."],
    ["field-followup-text-reference", "Housing repair", "Housing repair", "Repair reference", "repair-reference", "input", (/** @type {any} */ { labelled, name }) => `<input type="text" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the repair reference."],
    ["field-followup-date-departure", "Ferry departure", "Ferry departure", "Departure date", "departure-date", "input", (/** @type {any} */ { labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the departure date."],
    ["field-followup-select-language", "Museum tour", "Museum tour", "Tour language", "tour-language", "select", (/** @type {any} */ { labelled, name }) => `<select ${labelled ? `id="${name}"` : ""} name="${name}"><option>English</option><option>Welsh</option></select>`, "Choose the tour language."],
    ["field-followup-textarea-message", "Contact office", "Contact office", "Message", "message", "textarea", (/** @type {any} */ { labelled, name }) => `<textarea ${labelled ? `id="${name}"` : ""} name="${name}"></textarea>`, "Write a message to the office."],
    ["field-followup-number-group", "Workshop booking", "Workshop booking", "Group size", "group-size", "input", (/** @type {any} */ { labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the workshop group size."],
  ].map(([id, title, heading, label, name, selector, control, task]) => labelledControlVariant({ id, title, heading, label, name, selector, control, task })),
];

cases.push(...TARGETED_CASES);

const CALIBRATION_TOPICS = [
  "aquarium", "meadow", "harbour", "museum", "station", "playground", "civic-hall", "wetland", "gallery", "food-co-op",
  "health-centre", "town-square", "bus-depot", "railway", "ferry-terminal", "concert-hall", "learning-centre", "repair-cafe", "energy-park", "river-walk",
  "hill-farm", "marina", "stadium", "greenhouse", "bookshop",
];

const CALIBRATION_CASES = [
  ...CALIBRATION_TOPICS.map((topic, index) => {
    const code = String(index + 1).padStart(3, "0");
    const place = topic.replaceAll("-", " ");
    const name = "calibration-" + topic + "-" + code;
    return independent(imageVariant({
      id: "image-generic-" + name,
      title: place + " image",
      heading: place + " image",
      description: "The latest update explains what visitors can expect at the " + place + ".",
      file: name + ".jpg",
      goodAlt: "Photograph of the " + place + " visitor area",
      badAlt: ["image", "photo", "picture", "graphic"][index % 4],
      task: "Understand what the " + place + " visitor area looks like.",
    }));
  }),
  ...CALIBRATION_TOPICS.map((topic, index) => {
    const code = String(index + 1).padStart(3, "0");
    const place = topic.replaceAll("-", " ");
    const name = "calibration-" + topic + "-" + code;
    const badAlt = name + "-final.jpg";
    return independent(imageVariant({
      id: "image-filename-" + name,
      title: place + " exhibit",
      heading: place + " exhibit",
      description: "The exhibit explains the history of the " + place + ".",
      file: badAlt,
      goodAlt: "Historical photograph of the " + place,
      badAlt,
      task: "Read the description of the " + place + " exhibit.",
    }));
  }),
  ...CALIBRATION_TOPICS.map((topic, index) => {
    const code = String(index + 1).padStart(3, "0");
    const place = topic.replaceAll("-", " ");
    return independent(fakeHeadingVariant({
      id: "headings-fake-calibration-" + topic + "-" + code,
      title: place + " guide",
      heading: place + " guide",
      label: "Visitor requirements",
      task: "Find the visitor requirements for the " + place + ".",
    }));
  }),
  ...CALIBRATION_TOPICS.map((topic, index) => {
    const code = String(index + 1).padStart(3, "0");
    const place = topic.replaceAll("-", " ");
    return independent(placeholderOnlyVariant({
      id: "form-placeholder-calibration-" + topic + "-" + code,
      title: place + " booking",
      heading: place + " booking",
      label: "Booking reference",
      name: "booking-reference-" + code,
      task: "Enter the booking reference for the " + place + ".",
    }));
  }),
  ...CALIBRATION_TOPICS.map((topic, index) => {
    const code = String(index + 1).padStart(3, "0");
    const place = topic.replaceAll("-", " ");
    return independent(unnamedIconVariant({
      id: "icon-button-calibration-" + topic + "-" + code,
      title: place + " controls",
      heading: place + " controls",
      name: "Open " + place + " controls",
      task: "Open the " + place + " controls.",
    }));
  }),
  ...CALIBRATION_TOPICS.map((topic, index) => {
    const code = String(index + 1).padStart(3, "0");
    const place = topic.replaceAll("-", " ");
    return independent(errorVariant({
      id: "form-error-calibration-" + topic + "-" + code,
      title: place + " request",
      heading: place + " request",
      field: "Reference number",
      submit: "Submit " + place + " request",
      message: "Enter the reference number before submitting.",
      task: "Submit the " + place + " request without a reference number.",
    }));
  }),
  ...CALIBRATION_TOPICS.map((topic, index) => {
    const code = String(index + 1).padStart(3, "0");
    const place = topic.replaceAll("-", " ");
    return independent(statusVariant({
      id: "filter-status-calibration-" + topic + "-" + code,
      title: place + " catalogue",
      heading: place + " catalogue",
      control: "Show " + place + " items",
      task: "Show " + place + " items and notice the result count.",
    }));
  }),
  ...CALIBRATION_TOPICS.map((topic, index) => {
    const code = String(index + 1).padStart(3, "0");
    const place = topic.replaceAll("-", " ");
    return independent(customControlVariant({
      id: "custom-control-calibration-" + topic + "-" + code,
      title: place + " controls",
      heading: place + " controls",
      label: "Open " + place + " details",
      task: "Open the " + place + " details.",
    }));
  }),
  ...CALIBRATION_TOPICS.map((topic, index) => {
    const code = String(index + 1).padStart(3, "0");
    const place = topic.replaceAll("-", " ");
    return independent(disclosureVariant({
      id: "disclosure-state-calibration-" + topic + "-" + code,
      title: place + " advice",
      heading: place + " advice",
      control: place + " rules",
      content: "Visitors should follow the published rules.",
      task: "Open the " + place + " rules.",
    }));
  }),
];

cases.push(...CALIBRATION_CASES);

// The single-page-app fixture behind the 2.4.2 case below. Both variants share the markup and the
// navigation; they differ only in what happens to the TITLE and to FOCUS when the route changes.
//
// The nav list comes first in DOM order deliberately: `probeRouteChange` quick-navs to the FIRST link, so
// the control it activates has to be the one that navigates. A case whose first link is a skip link would
// measure the skip link.
const NAV_MARKUP =
  "<nav><ul>"
  // The NAVIGATING link is first, and that is a constraint of the probe rather than a design choice:
  // `probeRouteChange` quick-navs to the first link on the page and activates that. Written the natural way
  // round -- Overview, then Bookings -- both variants activated a plain fragment link, nothing changed on
  // either, and the good page was indistinguishable from the bad one. A fixture whose conformant variant
  // cannot pass is the same defect as one whose bad variant cannot fail.
  + "<li><a href=\"#bookings\" id=\"nav-bookings\">Bookings</a></li>"
  + "<li><a href=\"#overview\">Overview</a></li>"
  + "</ul></nav>"
  + "<div id=\"view\"><p>Opening times and directions for the Riverside Centre.</p></div>";

// `pushState` + an innerHTML swap: a route change with no page load, which is the only shape in which this
// failure can exist. On a real navigation the browser reads the new document's title whatever the author
// did, so the bug is unreachable.
const ROUTE_SWAP =
  "var view = document.getElementById('view');"
  + "document.getElementById('nav-bookings').addEventListener('click', function (event) {"
  + "event.preventDefault();"
  + "history.pushState({}, '', '#bookings');";

// Conformant: the title becomes the new page's, and focus moves to the new heading. Both matter and they
// answer different questions — focus is what NVDA announces at the moment of navigation, the title is what
// a user hears when they ask where they are.
const GOOD_ROUTE_SCRIPT = ROUTE_SWAP
  + "view.innerHTML = '<h1 id=\"landed\" tabindex=\"-1\">Bookings</h1>"
  + "<p>Book a room for up to twelve people.</p>';"
  + "document.title = 'Bookings - Riverside Centre';"
  + "document.getElementById('landed').focus();"
  + "});";

// The failure: the view changes and nothing else does. The page now shows Bookings, the title still says
// Riverside Centre, focus never moved, and the screen reader says nothing.
const BAD_ROUTE_SCRIPT = ROUTE_SWAP
  + "view.innerHTML = '<h1>Bookings</h1>"
  + "<p>Book a room for up to twelve people.</p>';"
  + "});";


/*
 * TWO MORE 2.4.2 HOSTS, and the reason is arithmetic rather than appetite.
 *
 * Accompanying defects are DEALT: `roundsForHost` takes `ROTATIONS[(rotation + round) % 12]` with three
 * rounds per host, so a subtype covers `3 x hosts` of the twelve rotations. With two hosts 2.4.2 saw six,
 * and which six is an offset — `filename-alt` and `generic-alt` were not among them. So no positive of
 * this subtype could carry `filename_graphic_present` or `generic_graphic_present`, and the promote gate
 * refused on both as free vetoes. §2 records the identical accident for `2.4.1:skip-link-inert`:
 * *"none contains `vague-link`, so the substitution never fires. That is chance, not design."*
 *
 * FOUR hosts is twelve slots, which covers every rotation by construction rather than by luck — the same
 * reasoning that moved furniture from an independent hash to a within-subtype deal, where a seven-case
 * subtype missed a bucket with probability 0.8^7.
 *
 * It is bounded: `withAccompanyingDefects` re-rotates "the hosts after it WITHIN THAT SUBTYPE ONLY", so
 * this recaptures 2.4.2's family and nothing else. The 474-capture figure in §2 is for enlarging
 * `ROTATIONS` globally, which this deliberately does not do.
 *
 * And it is worth doing for its own sake: 2.4.2 had 14 positives, which §2 calls the underlying
 * constraint — *"the remaining vetoes concentrate in subtypes with few positives"*.
 *
 * Each host is a DIFFERENT router mechanism, matching the two above (`pushState`, `replaceState`), because
 * a fourth copy of one shape teaches a head the shape rather than the failure.
 */
const ENROLMENT_NAV =
  "<nav><ul>"
  // Navigating link first — `probeRouteChange` activates the first link it reaches. Same constraint the
  // two hosts above record, and the reason a conformant variant would otherwise be unable to pass.
  + "<li><a href=\"#modules\" id=\"nav-modules\">My modules</a></li>"
  + "<li><a href=\"#timetable\">Timetable</a></li>"
  + "</ul></nav>"
  + "<div id=\"view\"><p>Term dates and enrolment deadlines for the current year.</p></div>";

const ENROLMENT_SWAP =
  "var view = document.getElementById('view');"
  + "document.getElementById('nav-modules').addEventListener('click', function (event) {"
  + "event.preventDefault();"
  // A HASH change rather than a History call — the oldest client-side router there is, and still the one
  // a hand-rolled single-page view most often uses. Same evidence, a third mechanism.
  + "location.hash = '#modules';";

const ENROLMENT_GOOD = ENROLMENT_SWAP
  + "view.innerHTML = '<h1 id=\"landed\" tabindex=\"-1\">My modules</h1>"
  + "<p>Three modules enrolled, one awaiting approval.</p>';"
  + "document.title = 'My modules - Northgate College';"
  + "document.getElementById('landed').focus();"
  + "});";

const ENROLMENT_BAD = ENROLMENT_SWAP
  + "view.innerHTML = '<h1>My modules</h1>"
  + "<p>Three modules enrolled, one awaiting approval.</p>';"
  + "});";

const CLAIM_NAV =
  "<nav><ul>"
  + "<li><a href=\"#payments\" id=\"nav-payments\">Payment history</a></li>"
  + "<li><a href=\"#contact\">Contact us</a></li>"
  + "</ul></nav>"
  + "<div id=\"view\"><p>How to report a change of circumstances and what evidence is needed.</p></div>";

const CLAIM_SWAP =
  "var view = document.getElementById('view');"
  + "document.getElementById('nav-payments').addEventListener('click', function (event) {"
  + "event.preventDefault();"
  // `pushState` with a real PATH rather than a fragment. The address bar changes more visibly than in any
  // of the three above, which makes the stale title the only thing a screen-reader user has left to go on.
  + "history.pushState({}, '', '/payments');";

const CLAIM_GOOD = CLAIM_SWAP
  + "view.innerHTML = '<h1 id=\"landed\" tabindex=\"-1\">Payment history</h1>"
  + "<p>Your last payment was made on the fourth of the month.</p>';"
  + "document.title = 'Payment history - Benefit claims';"
  + "document.getElementById('landed').focus();"
  + "});";

const CLAIM_BAD = CLAIM_SWAP
  + "view.innerHTML = '<h1>Payment history</h1>"
  + "<p>Your last payment was made on the fourth of the month.</p>';"
  + "});";

// 2.4.2, and deliberately NOT the missing-title case. Measured across 4,895 captures there are ZERO
// missing or placeholder titles, and WebAIM's million-page survey does not list missing title among the
// failures covering 96% of errors -- a rule there would add a row to the coverage table and detect nothing.
//
// This is the half a screen reader is uniquely placed to prove, and that a static analyser cannot reach at
// all: the markup is valid at every instant, and the failure is the TRANSITION. Both variants navigate the
// same way and both have a title; only one of them changes it.
cases.push(
  pair({
    id: "route-title-stale",
    // Written from the case's own definition, not invented: `preflight` requires task/source/mutation on
    // every case and these four families never had them, so 21 cases failed it for as long as the
    // criteria have existed. The metadata is what makes a case REVIEWABLE — "what was the user doing,
    // where does this failure come from, what exactly was changed" — and a case nobody can review is a
    // label nobody can check.
    task: "Open the Overview view and confirm where you are.",
    source: "WCAG 2.4.2 Understanding; W3C WAI single-page-application patterns",
    mutation: "The route changes and the document title does not, so the page announces the old title.",
    criterion: "2.4.2",
    // Both pages are single-page apps: the link swaps the view without a page load, which is the shape the
    // whole case exists for. A real page load cannot express this failure -- the browser reads the new
    // document's title whatever the author did.
    //
    // The nav is FIRST in the body and the navigating link is first within it, because the probe activates
    // the first link it reaches. See NAV_MARKUP.
    good: page({
      title: "Riverside Centre",
      heading: "Riverside Centre",
      body: NAV_MARKUP,
      // Updates the title AND moves focus to the new heading. The focus move is what NVDA actually
      // announces; the title is what a user navigating by title hears. A conformant SPA does both, and
      // doing only the second would announce nothing at the moment of navigation.
      script: GOOD_ROUTE_SCRIPT,
    }),
    bad: page({
      title: "Riverside Centre",
      heading: "Riverside Centre",
      body: NAV_MARKUP,
      // Swaps the content and nothing else. The page now shows Bookings, the title still says Riverside
      // Centre, focus never moved, and NVDA says nothing -- so a screen reader user has no way to learn
      // they went anywhere. That is the finding, and it is invisible to the markup.
      script: BAD_ROUTE_SCRIPT,
    }),
    badSignal: { type: "route-title-stale" },
    // Without this the capture carries no `routeChange` and the case labels every capture clean while
    // looking like a passing signal -- the exact way 2.1.2 shipped unvalidated.
    probeNavigation: true,
  }),
);

// A SECOND ROUTE-CHANGE PAGE: a library catalogue, switched with `replaceState`.
//
// The EVIDENCE SHAPE is the same by construction and that is not a shortcoming to fix.
// `routeTitleIsStale` reads `headingBefore !== headingAfter && titleBefore === titleAfter`, and any
// mechanism that changes the view without the title produces exactly that. A "different" route technique
// producing different evidence would be a different subtype.
//
// So what this case adds is what the corpus was actually short of, measured 2026-08-28:
// `2.4.2:route-title-stale` had SEVEN positives and ONE page. A head that has only ever seen
// "Riverside Centre" become "Bookings" has learned that vocabulary as much as the failure — the same
// word-sense trap `corpus:starvation`'s monopoly report exists to catch, arrived at through repetition
// rather than through a wordlist. Different domain, different view names, different route call.
const CATALOGUE_NAV =
  "<nav><ul>"
  // The navigating link first, for the reason `NAV_MARKUP` gives: `probeRouteChange` activates the first
  // link it reaches, and a case whose conformant variant cannot pass is as broken as one whose bad
  // variant cannot fail.
  + "<li><a href=\"#loans\" id=\"nav-loans\">My loans</a></li>"
  + "<li><a href=\"#search\">Search the catalogue</a></li>"
  + "</ul></nav>"
  + "<div id=\"view\"><p>Opening hours and branch addresses for the county library.</p></div>";

const CATALOGUE_SWAP =
  "var view = document.getElementById('view');"
  + "document.getElementById('nav-loans').addEventListener('click', function (event) {"
  + "event.preventDefault();"
  // `replaceState`, not `pushState` — a router that treats a view switch as a correction rather than a
  // new entry. Same evidence, different call, so the probe is exercised against both.
  + "history.replaceState({}, '', '#loans');";

const CATALOGUE_GOOD = CATALOGUE_SWAP
  + "view.innerHTML = '<h1 id=\"landed\" tabindex=\"-1\">My loans</h1>"
  + "<p>Four items on loan, one due back on Friday.</p>';"
  + "document.title = 'My loans - County Library';"
  + "document.getElementById('landed').focus();"
  + "});";

const CATALOGUE_BAD = CATALOGUE_SWAP
  + "view.innerHTML = '<h1>My loans</h1>"
  + "<p>Four items on loan, one due back on Friday.</p>';"
  + "});";

cases.push(
  pair({
    id: "route-title-stale-catalogue",
    task: "Open your loans and confirm where you are.",
    source: "WCAG 2.4.2 Understanding; W3C WAI single-page-application patterns",
    mutation: "The route changes with `replaceState` and the document title does not, so the page still "
      + "announces the catalogue's landing title.",
    criterion: "2.4.2",
    good: page({ title: "County Library", heading: "County Library", body: CATALOGUE_NAV,
      script: CATALOGUE_GOOD }),
    bad: page({ title: "County Library", heading: "County Library", body: CATALOGUE_NAV,
      script: CATALOGUE_BAD }),
    badSignal: { type: "route-title-stale" },
    probeNavigation: true,
  }),
);

// A single targeted case rather than a family: 2.1.2 needs exactly one pair to become validatable, and
// it is pushed here beside the other explicit pushes rather than buried in a generated block.
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
function LINK_STATUS_PAGE(announced) {
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

cases.push(
  pair({
    id: "filter-status-silent-link",
    task: "Filter the catalogue to show only bags and notice how many results remain.",
    source: "WCAG 4.1.3 Understanding; Web Accessibility Cookbook, chapter 22",
    mutation: "A LINK filters the catalogue and updates the visible count without exposing it through a "
      + "live status, so a sighted user sees the new number and a screen-reader user hears nothing.",
    criterion: "4.1.3",
    subtype: "form-activation-silent",
    badSignal: { type: "link-status-silent" },
    good: page({ title: "Product catalogue", heading: "Product catalogue", body: LINK_STATUS_PAGE(true) }),
    bad: page({ title: "Product catalogue", heading: "Product catalogue", body: LINK_STATUS_PAGE(false) }),
    // The probe that presses a link. Already opt-in, already sanctioned, and the only one that can reach
    // this failure — `probeForms` deliberately never activates a link.
    probeNavigation: true,
  }),
);

cases.push(
  pair({
    id: "route-title-stale-enrolment",
    task: "Open your modules and confirm where you are.",
    source: "WCAG 2.4.2 Understanding; ADR 0019 — the corpus cannot express what real pages do",
    mutation: "The view changes on a HASH route and the document title does not, so the page shows modules "
      + "while the title still names the college and nothing is announced.",
    criterion: "2.4.2",
    subtype: "route-title-stale",
    badSignal: { type: "route-title-stale" },
    good: page({ title: "Northgate College", heading: "Northgate College", body: ENROLMENT_NAV,
      script: ENROLMENT_GOOD }),
    bad: page({ title: "Northgate College", heading: "Northgate College", body: ENROLMENT_NAV,
      script: ENROLMENT_BAD }),
    probeNavigation: true,
  }),
  pair({
    id: "route-title-stale-claim",
    task: "Open your payment history and confirm where you are.",
    source: "WCAG 2.4.2 Understanding; ADR 0019 — the corpus cannot express what real pages do",
    mutation: "The route changes to a real PATH and the document title does not, so the address bar moves "
      + "and the only thing a screen-reader user could have gone on stays put.",
    criterion: "2.4.2",
    subtype: "route-title-stale",
    badSignal: { type: "route-title-stale" },
    good: page({ title: "Benefit claims", heading: "Benefit claims", body: CLAIM_NAV, script: CLAIM_GOOD }),
    bad: page({ title: "Benefit claims", heading: "Benefit claims", body: CLAIM_NAV, script: CLAIM_BAD }),
    probeNavigation: true,
  }),
);

cases.push(
  pair({
    id: "keyboard-trap-postcode",
    criterion: "2.1.2",
    // No `subtype:` -- `defaultSubtype` falls through to `badSignal.type`, which is already the right
    // vocabulary word. Spelling it out here as "2.1.2:focus-trapped" made the exported key
    // "2.1.2:2.1.2:focus-trapped", because the exporter composes `${criterion}:${subtype}` and every other
    // case declares the BARE word ("unnamed-control"). `rules:gate` caught it from both sides at once --
    // declared-but-absent and fired-but-undeclared -- which is the pair of complaints that names a
    // vocabulary mismatch rather than a missing rule.
    // THE FIRST CASE FOR A RULE THAT ALREADY SHIPPED. `addKeyboardTrap` has been in `rules.ts` the whole
    // time and had never once fired against known evidence: no case targeted 2.1.2, it was absent from
    // `rule-ownership.json` so `rules:gate` did not cover it, and it reads `focusOrder`, which no corpus
    // capture carried because `probeFocus` was never forwarded through the dataset path. Surfaced by
    // `criteriaAssessableFrom` on the day that function was added.
    //
    // A trap is TOTAL in a way most failures are not: a keyboard user who cannot leave a control cannot
    // use the rest of the page at all. WCAG treats 2.1.2 as non-interference (§5.2.5) — it applies whether
    // or not the content is relied upon.
    task: "Fill in the delivery details.",
    source: "WCAG 2.2 SC 2.1.2 No Keyboard Trap; F10 (failure of 2.1.2 due to a component trapping focus)",
    mutation: "A keydown handler on the postcode field cancels Tab and refocuses itself, so focus enters "
      + "the field and can never leave it.",
    // Read from the PROBE's own `stalled` flag, not re-derived from the stop list the rule reasons over —
    // see `focusIsTrapped`. Two independent expressions, or the gate compares the rule with itself.
    badSignal: { type: "focus-trapped" },
    good: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: "<form><label for=\"a\">Full name</label><input id=\"a\" name=\"a\"><label for=\"b\">Email</label><input id=\"b\" name=\"b\"><label for=\"c\">Postcode</label><input id=\"c\" name=\"c\"><label for=\"d\">Phone</label><input id=\"d\" name=\"d\"><label for=\"e\">Notes</label><input id=\"e\" name=\"e\"></form>",
    }),
    bad: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: "<form><label for=\"a\">Full name</label><input id=\"a\" name=\"a\"><label for=\"b\">Email</label><input id=\"b\" name=\"b\"><label for=\"c\">Postcode</label><input id=\"c\" name=\"c\"><label for=\"d\">Phone</label><input id=\"d\" name=\"d\"><label for=\"e\">Notes</label><input id=\"e\" name=\"e\"></form>",
      // Traps BOTH directions, because trapping only forward Tab leaves Shift+Tab as an escape and is
      // therefore not a trap. `preventDefault` then refocus is F10's canonical shape.
      script: "document.getElementById('c').addEventListener('keydown', (event) => { "
        + "if (event.key === 'Tab') { event.preventDefault(); event.currentTarget.focus(); } });",
    }),
    // The whole point: without this the capture carries no `focusOrder` and the case labels every capture
    // clean while looking like a passing signal.
    probeFocus: true,
    // THE TAB RING IS WALKED FIRST, THEN THE FORM IS PROBED -- added 2026-08-30.
    //
    // A real user who tabs through a form also SUBMITS it. This case walked the ring and never interacted,
    // so `stateChanges`, `formChanges` and `postSubmitFields` were empty on every one of its captures --
    // not because the page was silent, but because nothing asked. Ten of the 28 model features read only
    // those three channels, and a feature that is 0 on every positive of a subtype is a FREE VETO: measured
    // on the shipped weights, 50 of 52 vetoes across 18 heads sit on those ten, and this subtype carried 8
    // of them for a reason that is not a fact about any page.
    //
    // `probeOrder: "focus-first"` is what makes it safe here and it is not optional. The default order
    // sweeps before it walks focus, and the sweep ACTIVATES controls -- so the ring would be measured on a
    // page an activation had already changed, which is the D7 defect this subtype's evidence is most
    // exposed to. Focus-first puts the walk on a virgin page. `gate:probe-order` measured focus-first as
    // evidence-neutral on all three of its corpus pages.
    probeForms: true,
    probeOrder: "focus-first",
  }),
);

/**
 * Page sizes to spread the corpus across, smallest to largest.
 *
 * A corpus where every page has exactly N links teaches the scorer "N", not "a range" — so the sizes vary
 * per case and the zero stays in, keeping the small pages the model already handles.
 *
 * **The numbers live in `scale-buckets.test.ts`, not here.** This comment used to restate the cost model,
 * and it went stale within the hour of the model being corrected — two descriptions of one thing that
 * disagreed, which is worse than one. The test holds `BASELINE_MS` and `MS_PER_ELEMENT` as the single
 * source, asserts these buckets against them, and fails if a bucket outgrows either rule below.
 *
 * Two rules bound this list, both from `docs/adr/0009-dataset-tiers.md`:
 *
 * 1. No bucket may be large enough for a capture to approach `DEFAULT_BUDGET_MS`. Past that the sweeps
 *    truncate mid-page and report an empty field — and an empty field IS the finding for several cases
 *    here, so absence becomes indistinguishable from truncation. The five-bucket version breached this:
 *    its largest page took the full budget and reported `lists: 0` on a page with 40 list items.
 * 2. A full recapture of the bulk corpus must fit one night, because a feedback loop measured in days
 *    does not get run — which in practice means shipping evidence nobody revalidated.
 *
 * Real-page structure is the realism TIER's job, sampled rather than applied to all 1,061 pairs. Change
 * these only with fresh timings, and update the test's constants in the same commit.
 */
export const SCALE_BUCKETS = [
  { links: 0, sections: 0 },
  { links: 6, sections: 4 },
  // The two buckets that exist for ADR 0015 rather than for size. They carry conformant structure belonging
  // to OTHER criteria, so `form_field_named` and `table_present` stop being constant across any subtype's
  // positives — which is what made them free negative weights. `furniture-spread.test.ts` asserts the
  // property directly, without capturing anything.
  { links: 6, sections: 4, namedField: true },
  // Ordered by MEASURED capture cost, ascending, which `scale-buckets.test.ts` asserts: a labelled field
  // is +3.7 s, a disclosure +3.9 s (it activates a control), a table +7.9 s (the sweep walks cells).
  { links: 6, sections: 4, disclosure: true },
  { links: 6, sections: 4, dataTable: true },
];

/**
 * FNV-1a over a case id. The one hash both id-keyed choices use, so they cannot drift apart.
 *
 * Extracted rather than copied when the conformant accompaniments needed the same property: a case's
 * generated content must depend on nothing but its own name, or adding cases elsewhere re-rolls it.
 */
function fnv1a(/** @type {any} */ id) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Which furniture bucket a case gets — SPREAD ACROSS ITS SUBTYPE, not hashed independently.
 *
 * It was `SCALE_BUCKETS[fnv1a(id) % length]`, which gives each case an independent 1-in-5 chance of the
 * `namedField` bucket and therefore gives a SUBTYPE no guarantee at all. For seven cases the chance of
 * missing that bucket entirely is 0.8^7 = 0.21 — one subtype in five — and measured 2026-08-26 exactly
 * one did: `2.4.2:route-title-stale`, all seven cases without a named form field, which
 * `furniture-spread.test.ts` correctly reported as a free veto for `form_field_named`.
 *
 * The fix is not to special-case that subtype. Random assignment does not spread, and ADR 0015 is about
 * a feature being constant across a subtype's positives — so the index must be taken WITHIN the subtype:
 * case k of a subtype gets bucket (offset + k) % 5, and every subtype with 5+ cases sees all five buckets
 * by construction rather than by luck.
 *
 * The offset is still hashed, from the SUBTYPE, so two subtypes do not receive the buckets in lockstep —
 * which would make `namedField` correlate with position-in-subtype instead of with nothing.
 *
 * Keyed on the subtype and the case's index within it, so inserting a case re-buckets only that subtype's
 * later cases. That is a weaker guarantee than the id hash gave (`insert freely, nothing moves`) and it
 * is the trade the starvation forces; `check-signals` reports what moved, and the pages are regenerated
 * from the definitions anyway.
 *
 * **AND "APPENDING IS FREE" IS NOT A COROLLARY, which is how that sentence reads.** A subtype's cases are
 * ordered base-cases-first, then multi-defect variants, then furniture variants — so EVERY generated
 * variant is "later" than every base case, and appending a base case re-buckets all of them.
 *
 * Measured 2026-08-28, appending two hosts to `2.4.1:skip-link-inert`: 14 cases added and **6 existing
 * pages moved** — `skip-link-broken`'s three multi-defect and three furniture variants — for 12 captures.
 * Nothing outside the subtype moved, which is the guarantee above doing its job.
 *
 * So the cost of a new mechanism is roughly `2 x (new cases + generated variants of the subtype's
 * existing hosts)` captures. Small, and worth knowing before rather than after.
 */
function bucketFor(/** @type {any} */ id, /** @type {any} */ subtype, /** @type {any} */ indexInSubtype) {
  const offset = fnv1a(subtype ?? id);
  const index = indexInSubtype ?? fnv1a(id);
  return SCALE_BUCKETS[(offset + index) % SCALE_BUCKETS.length];
}

/**
 * Give every case realistic page furniture, identical in both of its variants.
 *
 * Done HERE rather than inside `page()` deliberately. `page()` sees only a title and a body, and those
 * differ between the good and bad variant — so any size derived from them could differ across a pair and
 * introduce a second difference into a controlled comparison. That is the one defect this corpus cannot
 * carry. Keyed on the case's identity instead, the furniture is provably identical for both variants.
 *
 * **This rule has been written down three times and said something different each time, which is the most
 * useful thing about it.** Furniture was first keyed on ARRAY POSITION, so the rule was "APPEND, never
 * insert" — a thing a human has to remember, which this repo's housekeeping rule says does not happen.
 * Then on `fnv1a(id)` alone, so it became "insert, reorder or delete freely". Both were true when written
 * and both are now wrong: independent hashing gives a SUBTYPE no coverage guarantee, which ADR 0015 makes
 * a free veto. See `bucketFor` for what replaced them.
 *
 * The rule that survived all three is the one that is a TEST rather than a paragraph:
 * `furniture-spread.test.ts` asserts the property per feature, and it is what caught the regression a
 * comment could not.
 */
function withRealisticScale(/** @type {any} */ list) {
  // Position within the subtype, so the buckets can be dealt round-robin rather than drawn independently.
  const seen = new Map();
  const indexOf = (/** @type {any} */ testCase) => {
    const key = `${testCase.criterion}:${testCase.subtype}`;
    const next = (seen.get(key) ?? 0);
    seen.set(key, next + 1);
    return { key, index: next };
  };
  return list.map((/** @type {any} */ testCase) => {
    const { key, index } = indexOf(testCase);
    const bucket = bucketFor(testCase.id, key, index);
    // A case that drives tables itself never gets the furniture table. Not to avoid a signal collision —
    // the furniture table is conformant, so `tableHeadersAreUnassociated` cannot see it — but because
    // `probeTables` walks the page's tables, and a second one changes what the case's own probe reports.
    // These cases already carry `table_present`, so the correlation this furniture breaks is not theirs.
    let usable = testCase.probeTables ? { ...bucket, dataTable: false } : bucket;
    // SAME RULE, applied to headings. Four of the five buckets add `sections: 4`, and furniture is dealt
    // round-robin within a subtype — so four of every five `no-headings` cases would silently be given
    // headings and stop testing anything, while `check-signals` reported them as not discriminating.
    //
    // This is the principle `filler()` already states for images and form fields ("150 image cases and
    // 141 label cases are defined by exactly what those channels contain"). Headings were listed as SAFE
    // there, and that was true while the only heading case asserted a NAMED heading was absent. It stops
    // being true the moment a case asserts there are none.
    if (testCase.badSignal?.type === "structure-empty" && testCase.badSignal.field === "headings") {
      usable = { ...usable, sections: 0 };
    }
    const extra = filler(usable);
    if (!extra) return testCase;
    // Always at the SAME structural position — before `</body>`, outside any landmark.
    //
    // Injecting inside `<main>` "where there is one" looked tidier and was wrong: 58 cases are landmark
    // cases whose bad variant has no `<main>` at all, because its absence IS the labelled failure. The
    // furniture would then sit inside a landmark in one variant and outside it in the other, so NVDA would
    // announce identical text with different container prefixes. That amplifies the difference between a
    // pair in a way the label does not describe — a shortcut, the same shape as the keystroke leak that
    // sat on exactly one variant of 125 pairs. Uniform placement costs a little realism and buys a
    // controlled comparison, which is the trade this corpus exists to make.
    const inject = (/** @type {any} */ html) => html.replace("</body>", extra + "</body>");
    return { ...testCase, good: inject(testCase.good), bad: inject(testCase.bad) };
  });
}

/**
 * The 2.4.3 fixture: the same five fields in the same reading order, differing only in tab order.
 *
 * A function rather than two literals so the pair cannot drift apart in any other respect. The one
 * difference between the variants must be the thing under test — this corpus's central constraint, and the
 * reason page furniture is injected identically into both.
 */
function FOCUS_ORDER_FORM(/** @type {any} */ mode) {
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
function MODAL_TRAP_FORM(withCloseButton) {
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
const MODAL_FOCUS_GUARD = "var trapped = true;"
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
function MODAL_ESCAPE_FORM() {
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
const MODAL_ESCAPE_RELEASES = MODAL_FOCUS_GUARD
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

function TRAP_FIELDSET_FORM() {
  return "<form><fieldset id=\"addr\"><legend>Address</legend>"
    + "<label for=\"a\">Full name</label><input id=\"a\" name=\"a\">"
    + "<label for=\"b\">Email</label><input id=\"b\" name=\"b\">"
    + "<label for=\"c\">Postcode</label><input id=\"c\" name=\"c\">"
    + "<label for=\"d\">Phone</label><input id=\"d\" name=\"d\">"
    + "<label for=\"e\">Notes</label><input id=\"e\" name=\"e\">"
    + "</fieldset></form>";
}

// 2.4.3 Focus Order. APPENDED at the end of `cases`, and that placement is load-bearing: page furniture is
// sized by array index, so inserting anywhere else re-sizes every case after it and quietly invalidates
// their captures. That cost one recapture on 2026-08-22; in the middle of a generated family it would cost
// hundreds.
//
// The detectable subset is a tab order that DISAGREES WITH THE READING ORDER. Whether an order "preserves
// meaning" in general is human judgement — the same wall 2.4.6 stops at — but a positive `tabindex`
// dragging a field to the front of the tab order is not a judgement call, and it is the canonical way this
// criterion is failed in practice.
//
// Both channels are already captured and neither is new: `structure.formFields` is the order a screen
// reader READS, `interaction.focusOrder` is the order Tab VISITS. The comparison between them is the whole
// rule, and it is the kind of claim only a screen-reader tool can make — the DOM has no "reading order" to
// compare against, which is why a static checker can flag `tabindex="1"` as a smell but cannot say whether
// it actually broke anything.
cases.push(
  pair({
    id: "focus-order-tabindex",
    task: "Tab through the form and complete it in the order it reads.",
    source: "WCAG 2.4.3 Understanding; Practical Web Accessibility, chapter 6",
    mutation: "Positive tabindex pulls two fields ahead of the rest, so tab order contradicts reading order.",
    criterion: "2.4.3",
    good: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: FOCUS_ORDER_FORM(""),
    }),
    bad: page({
      // `tabindex="2"` on Postcode and `1` on Phone: both are pulled ahead of every tabindex=0 control, and
      // ahead of each other in their own order, so Tab visits Phone, Postcode, then the rest. Reading order
      // is unchanged, which is exactly the failure — the page looks and reads correctly and operates in a
      // different sequence.
      title: "Delivery details",
      heading: "Delivery details",
      body: FOCUS_ORDER_FORM(" tabindex-trap"),
    }),
    badSignal: { type: "focus-order-scrambled" },
    probeFocus: true,
    probeForms: true,
    probeOrder: "focus-first",
  }),
);

/**
 * The 2.4.1 fixture: a skip link, a block of repeated navigation, then the content.
 *
 * `targetId` is the ONLY difference. The good variant's link points at the content wrapper, which carries
 * `tabindex="-1"` so focus can actually land on it; the bad variant points at an id that no element has —
 * a renamed or typo'd anchor, which is how this breaks in the wild and exactly what a static checker waves
 * through: it sees a link, a plausible fragment href and a page full of content.
 */
function SKIP_LINK_PAGE(/** @type {any} */ targetId, /** @type {string} */ targetAttrs = ' tabindex="-1"') {
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

// 2.4.1 Bypass Blocks — and deliberately NOT "the page has no skip link", which would be wrong.
//
// W3C's Understanding page is explicit: headings alone satisfy this criterion (H69), landmarks alone satisfy
// it (ARIA11), and a skip link is not required. So absence is not a failure, every corpus page has an h1,
// and a presence rule would fire on conformant pages. Whether any of those mechanisms EXISTS is a DOM fact
// the static layer answers better than we can — our own landmark sweep is documented as nondeterministic.
//
// The claim that is ours: the mechanism is there and does nothing. Both variants have the same skip link,
// the same nav block and the same content; only the target differs. Activating it either moves focus past
// the block or leaves the user exactly where they were, and no amount of markup inspection can tell which.
cases.push(
  pair({
    id: "skip-link-broken",
    task: "Use the skip link to jump past the navigation to the main content.",
    source: "WCAG 2.4.1 Understanding; W3C technique G1 (skip link)",
    mutation: "The skip link targets an id no element has, so it is present, plausible and inert.",
    criterion: "2.4.1",
    good: page({
      title: "Archive",
      heading: "Archive",
      body: SKIP_LINK_PAGE("content"),
    }),
    bad: page({
      title: "Archive",
      heading: "Archive",
      // No element has this id. The link is valid HTML, points somewhere plausible, and goes nowhere.
      body: SKIP_LINK_PAGE("main-content"),
    }),
    badSignal: { type: "skip-link-inert" },
    // The focus probe as well: the signal compares where the skip link LEFT focus against where the second
    // Tab would ordinarily go, and that second sequence is `focusOrder`. Without it there is nothing to
    // compare against and the case labels every capture clean.
    probeFocus: true,
    // The navigation probe activates the first link — which here IS the skip link — and records where the
    // next Tab lands. That reading is the entire evidence for this case.
    probeNavigation: true,
  }),
);

cases.push(
  pair({
    id: "skip-link-target-hidden",
    task: "Use the skip link to jump past the navigation to the main content.",
    source: "WCAG 2.4.1 Understanding; technique G1",
    mutation: "The skip link's target is focusable and `hidden`, so activating it moves focus nowhere "
      + "and the content it names is not rendered at all.",
    criterion: "2.4.1",
    // A SECOND MECHANISM. A THIRD WAS TRIED AND REFUTED, and the refutation is worth more than the case
    // would have been: `skip-link-target-not-focusable` pointed at an id that EXISTS and carries no
    // `tabindex`, on the belief that the browser scrolls without moving focus, leaving a screen-reader
    // user in the navigation. Captured 2026-08-28, and it is not so — `nextFocusAfter` was
    // `"Search the archive, edit"`, byte-identical to the CONFORMANT variant. Chromium moves the
    // sequential-focus navigation starting point even for a non-focusable target, so the next Tab does
    // enter the content and the block IS bypassed. The page is conformant and the case was deleted.
    //
    // Do not re-add it without capturing first. `--pipeline=verify --only=` answered this in minutes, and
    // a canary that cannot express the fault is worthless — one that expresses a fault that is not there
    // is worse, because it teaches the model a conformant page is a failing one.
    //
    // This one is the one a rewrite introduces: the target keeps its `tabindex="-1"` — somebody
    // knew the pattern — and a later change hid the wrapper. `hidden` removes the element from the
    // rendering AND from the accessibility tree, so focus cannot land on it however correct the link is.
    //
    // Distinct from the other two in what a reader must check: the id resolves and the tabindex is right,
    // so both of the obvious checks pass and the link is still inert.
    good: page({ title: "Archive", heading: "Archive", body: SKIP_LINK_PAGE("content") }),
    bad: page({ title: "Archive", heading: "Archive", body: SKIP_LINK_PAGE("content", ' tabindex="-1" hidden') }),
    badSignal: { type: "skip-link-inert" },
    probeFocus: true,
    probeNavigation: true,
  }),
);

/*
 * TWO MORE 2.4.1 HOSTS, for the arithmetic §2 records and 2.4.2 has already been fixed for.
 *
 * Accompanying defects are DEALT — `ROTATIONS[(rotation + round) % 12]`, three rounds per host — so a
 * subtype covers `3 x hosts` of the twelve. With two hosts 2.4.1 saw six, and `vague-link` was not among
 * them, which is why §2 records `vague_link_without_context (-4.51)` as its worst free veto: *"none
 * contains `vague-link`, so the substitution never fires. That is chance, not design."* Four hosts is
 * twelve slots, and every rotation is drawn by construction.
 *
 * Bounded to this subtype: `withAccompanyingDefects` re-rotates "the hosts after it WITHIN THAT SUBTYPE
 * ONLY". 2.4.1 also had 14 positives, and §2 calls corpus depth the underlying constraint.
 *
 * A MECHANISM THAT WAS REFUTED IS DELIBERATELY NOT AMONG THESE. `skip-link-target-not-focusable` — a
 * target with a real id and no `tabindex` — was captured on 2026-08-28 and the page is CONFORMANT:
 * Chromium moves the sequential-focus starting point even for a non-focusable target, so the next Tab
 * does enter the content. Both mechanisms below leave focus somewhere a Tab cannot recover from.
 */

/** The target exists in the markup and is REMOVED before the user reaches the link. */
function SKIP_LINK_REPLACED_PAGE(/** @type {boolean} */ removesTarget) {
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
function SKIP_LINK_DUPLICATE_ID_PAGE(/** @type {boolean} */ duplicated) {
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

cases.push(
  pair({
    id: "skip-link-target-replaced",
    task: "Skip past the navigation to the search field.",
    source: "WCAG 2.4.1 Understanding; ADR 0019 — the corpus cannot express what real pages do",
    mutation: "A client-side render replaces the container the skip link names, so the href resolved when "
      + "the page was authored and resolves to nothing when the link is used.",
    criterion: "2.4.1",
    subtype: "skip-link-inert",
    badSignal: { type: "skip-link-inert" },
    good: page({ title: "Archive", heading: "Archive", body: SKIP_LINK_REPLACED_PAGE(false) }),
    bad: page({ title: "Archive", heading: "Archive", body: SKIP_LINK_REPLACED_PAGE(true) }),
    probeFocus: true,
    probeNavigation: true,
  }),
  pair({
    id: "skip-link-duplicate-id",
    task: "Skip past the navigation to the search field.",
    source: "WCAG 2.4.1 Understanding; ADR 0019 — the corpus cannot express what real pages do",
    mutation: "Two elements share the target id and the first is above the navigation, so the jump lands "
      + "before the block it was meant to bypass and the nav is still ahead.",
    criterion: "2.4.1",
    subtype: "skip-link-inert",
    badSignal: { type: "skip-link-inert" },
    good: page({ title: "Archive", heading: "Archive", body: SKIP_LINK_DUPLICATE_ID_PAGE(false) }),
    bad: page({ title: "Archive", heading: "Archive", body: SKIP_LINK_DUPLICATE_ID_PAGE(true) }),
    probeFocus: true,
    probeNavigation: true,
  }),
);

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
function KEYBOARD_ACTION_PAGE(/** @type {any} */ focusable) {
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
function NATIVE_ACTION_PAGE(/** @type {any} */ focusable) {
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
function RADIO_GROUP_PAGE(arrowsWork) {
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

// 2.1.1 Keyboard. The detectable failure is a control the screen reader ANNOUNCES as operable that the
// keyboard cannot reach — a `div role="button"` with a click handler and no `tabindex`, which is the most
// common way this is failed and the one a screen-reader user meets as "I can hear it and I cannot press it".
//
// Note this is NOT the roleless `<div onclick>` of the custom-control family. That one is invisible to the
// screen reader entirely — its absence IS the 4.1.2 finding — and a capture cannot distinguish it from a
// page with no button at all. This case is the opposite: perfectly perceivable, and unusable.
cases.push(
  pair({
    id: "keyboard-unreachable-action",
    task: "Reach the delete action for a draft using the keyboard alone.",
    source: "WCAG 2.1.1 Understanding; Practical Web Accessibility, chapter 5",
    mutation: "The action is a div with a click handler and no tabindex, so Tab never reaches it.",
    criterion: "2.1.1",
    good: page({ title: "Drafts", heading: "Drafts", body: KEYBOARD_ACTION_PAGE(true) }),
    bad: page({ title: "Drafts", heading: "Drafts", body: KEYBOARD_ACTION_PAGE(false) }),
    badSignal: { type: "control-unreachable-by-keyboard" },
    probeFocus: true,
    probeForms: true,
    probeOrder: "focus-first",
  }),
);


cases.push(
  // RESTORED on the same evidence. The withdrawal read `announced: ""` on both variants and concluded a
  // live region cannot be heard while NVDA is speaking; a diagnostic pair disproved that outright.
  //
  // What this case has to prove is narrower than the withdrawal assumed: not "can a live region be heard",
  // but "is the page's response separable from NVDA's character echo" — and `probeTypedFeedback` already
  // separates them, comparing each spoken phrase against the string it actually sent.
  /*
   * `validation-live-silent` — WITHDRAWN, same cause, less ambiguity.
   *
   * `typedFeedback` reads `{typed: true, echoed: "1 2 3 4 5 6", announced: ""}` on BOTH variants, and the
   * good page's transcript never carries the message either. The probe lands, types, and separates NVDA's
   * echo from the page's response correctly; what it separates is empty.
   *
   * Its sibling above measures the same mechanism at 2 of 6 for ONE activation. Typing fires the handler
   * six times in a burst, so if a polite region is dropped while NVDA is speaking, this is the shape where
   * it is dropped every time.
   *
   * `LIVE_VALIDATION_PAGE` is kept as source because the page is right. Restore it when §18's
   * intermittency has a cause — not by switching the region to `assertive`, which would be fitting the
   * page to the tool.
   */

  pair({
    id: "radio-group-arrows-inert",
    task: "Choose express delivery using the keyboard alone.",
    source: "WCAG 2.1.1 Understanding; ARIA Authoring Practices, radio group pattern",
    mutation: "A div-based radio group uses roving tabindex with nothing that roves: one option is "
      + "tabbable, the rest are -1, and no handler moves focus between them. Two of the three options "
      + "cannot be reached by keyboard at all.",
    criterion: "2.1.1",
    // THE EXISTING SUBTYPE, DECLARED EXPLICITLY, and getting this wrong cost a gate failure worth
    // recording. Left implicit, `defaultSubtype` derives the subtype from `badSignal.type` and invented
    // `2.1.1:arrow-keys-inert` -- a subtype no `rule-ownership` entry claims, so it fell to the MODEL.
    // `acceptance` then refused: "2.1.1: fewer than 3 acceptance positives", because the held-out set
    // predates the case, plus two false positives from a head trained on a handful of examples.
    //
    // It was never a new failure. This case's own mutation says so: two of the three options cannot be
    // reached by keyboard at all. That IS `control-unreachable-by-keyboard` -- the same failure by a
    // different MECHANISM, which is the pattern this corpus already uses ("a fifth case for each of the
    // three focus subtypes, and each one is a different mechanism").
    //
    // A new SIGNAL type does not imply a new SUBTYPE. The signal is how a case is checked; the subtype is
    // what the failure IS, and it is what a head is fitted to and a gate counts.
    subtype: "control-unreachable-by-keyboard",
    // THE FIRST CASE IN THIS CORPUS WITH AN ARROW-KEY WIDGET OF ANY KIND. Measured 2026-09-01: 0 of 4,926
    // captures carry a radio button, tab, menu item, tree item, option or grid cell, while real pages do
    // -- so `SHARES_ONE_TAB_STOP`, the abstention 2.1.1 makes for exactly this shape, has never been
    // exercised by the corpus that validates it. `docs/not-working.md` §17 records the measurement and why
    // it means the CASE comes before the probe: a probe built first has no positive to be right about.
    good: page({ title: "Delivery method", heading: "Delivery method", body: RADIO_GROUP_PAGE(true) }),
    bad: page({ title: "Delivery method", heading: "Delivery method", body: RADIO_GROUP_PAGE(false) }),
    badSignal: { type: "arrow-keys-inert" },
    // All three, and the case is worthless without any one. `probeArrows` presses the arrows; `probeFocus`
    // is what puts DOM focus INTO the group first, since a sweep is browse mode and never moves focus --
    // the lesson the dialog probe cost three captures to learn; `focus-first` runs the pair before the
    // sweep activates anything.
    probeFocus: true,
    probeArrows: true,
    probeOrder: "focus-first",
  }),
);


/**
 * A FIFTH CASE FOR EACH OF THE THREE FOCUS SUBTYPES, and each one is a different MECHANISM.
 *
 * The arithmetic first, because it is the reason these exist: furniture is dealt round-robin within a
 * subtype across five buckets, so a subtype with four cases misses one bucket BY CONSTRUCTION. For these
 * three that bucket was `namedField`, which is exactly ADR 0015's free veto — a feature constant at zero
 * across every positive of the subtype, available to the head as a costless negative weight.
 * `furniture-spread.test.ts` reports it per feature, which is how it was visible rather than inferred.
 *
 * **But a fifth case that restates the fourth buys the bucket and no evidence.** Each subtype already had
 * exactly one mechanism and three multi-defect variants of it, so the head had seen one way of failing
 * four times. These add a second way, chosen so that a STATIC checker handles it differently from the
 * first — which is the standing question this project exists to answer.
 */
cases.push(
  pair({
    id: "keyboard-trap-blur-revalidate",
    task: "Fill in the delivery details.",
    source: "WCAG 2.2 SC 2.1.2 No Keyboard Trap; F10",
    mutation: "Blur-triggered validation refocuses the postcode field whenever it is left empty, so focus "
      + "cannot move on by any route — not just by Tab.",
    criterion: "2.1.2",
    // A DIFFERENT TRAP FROM `keyboard-trap-postcode`, and the difference is what it catches. That one
    // cancels Tab in a KEYDOWN handler, so it traps the keys it names and nothing else — Shift+Tab, a
    // click, or a programmatic focus call all escape it. This one watches focus ITSELF via `focusout`, so
    // it holds against every route out. Validate-on-blur that refocuses the offending field is how this
    // is failed in real forms, and its author generally believes they have written a helpful form.
    //
    // It also fails a static checker differently: there is no `tabindex` and no key handler to find. The
    // markup is a plain fieldset of labelled inputs and is entirely conformant on its face.
    //
    // THE MECHANISM WAS CHOSEN AGAINST THE PROBE, not just against the criterion. The first version of
    // this case used a `focusin` guard on the fieldset that pulled focus back to its FIRST control, which
    // is the canonical modal focus-trap shape — and `probeFocusOrder` could not have seen it. `stalled`
    // requires the same control `TRAP_REPEATS` times running; a guard that cycles focus among several
    // fields moves focus every press, so it reads as `cycled`, which is exactly what a conformant page's
    // tab order does when it wraps. That case would have entered the corpus BLIND, and this repo's rule is
    // that a canary which cannot express the fault is worthless. Refocusing ONE field produces the
    // consecutive repeat the probe is built to detect.
    //
    // The limitation is real and stays: a trap that lets you cycle inside a modal for ever is a genuine
    // 2.1.2 failure this tool cannot currently distinguish from a normal tab cycle, because the probe
    // presses only Tab. Recorded in `docs/screenreader-coverage.md` rather than worked around here.
    good: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: TRAP_FIELDSET_FORM(),
    }),
    bad: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: TRAP_FIELDSET_FORM(),
      // `focusout` fires whatever takes focus away — Tab, Shift+Tab, a click, a script — which is the
      // whole point of choosing it over a key handler. Deferred with a microtask because moving focus
      // during focus-event dispatch is ignored by Chromium.
      script: "document.getElementById('c').addEventListener('focusout', (event) => {"
        + "  if (!event.target.value) {"
        + "    queueMicrotask(() => event.target.focus());"
        + "  }"
        + "});",
    }),
    badSignal: { type: "focus-trapped" },
    probeFocus: true,
    probeForms: true,
    probeOrder: "focus-first",
  }),
);

cases.push(
  pair({
    id: "keyboard-trap-modal-cycle",
    task: "Tab through the page and reach the delivery notes at the end.",
    source: "WCAG 2.2 SC 2.1.2 No Keyboard Trap; F10; ARIA Authoring Practices, Dialog (Modal) Pattern",
    mutation: "A focus guard confines Tab to a dialog holding four text fields and NOTHING that can be "
      + "activated, so a keyboard user can type and cycle and never leave. The conformant variant has the "
      + "identical guard and an identical-sized ring whose last control is a Close button.",
    criterion: "2.1.2",
    // THE PAIR THAT KEYS ON WHAT THE RING OFFERS, NOT HOW BIG IT IS — which is why three earlier versions
    // of this case were withdrawn on 2026-08-28.
    //
    // Each of those had a conformant variant with NO guard, so the pair differed by the ring's SIZE. Size
    // is exactly what a consent banner also differs by, so every rule fitted to it learned "is there a
    // modal" and accused real pages: 7 and 9 new findings on 86 conformant ones, and a third attempt that
    // was inert. Measured on the accusers — tfl ring 5 reads link, link, button, button, button ("Accept
    // all cookies"); networkrail ring 4 reads link, button, button, button. Every banner offers a way out.
    //
    // Here BOTH variants carry the identical guard and both rings hold FOUR controls. The only difference
    // is that one of the four is a button. So `ring size`, `cycled`, `swept fields` and the tab order are
    // constant across the pair by construction, and the single feature that varies is the one 2.1.2
    // actually turns on: is there anything here a keyboard can activate to get out?
    good: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: MODAL_TRAP_FORM(true),
      // Confines focus, and offers a Close button inside the ring that dismisses it. WCAG asks that focus
      // CAN be moved away, not that it is never held — this is the APG modal pattern and it conforms.
      script: MODAL_FOCUS_GUARD,
    }),
    bad: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: MODAL_TRAP_FORM(false),
      // The same guard, the same ring size, and four text fields. Nothing to activate, so nothing to do.
      script: MODAL_FOCUS_GUARD,
    }),
    badSignal: { type: "focus-trapped" },
    probeFocus: true,
    // THE FIRST CASE TO ASK FOR THE DIALOG PROBE, and it is the natural one: its page opens a modal, which
    // is what the probe exists to observe. A flag no case sets is decoration -- `probe-chain.test.ts`
    // refuses one, which is how this line came to be written rather than remembered.
    //
    // What it records is deliberately not a verdict: focus before Escape, what Escape announced, and focus
    // after. Whether "back where it started" means the same control is a judgement about announcements, and
    // `parseAnnouncement` is the single grammar for that -- so the comparison belongs to a rule, not here.
    probeDialog: true,
    probeForms: true,
    probeOrder: "focus-first",
  }),
);

cases.push(
  pair({
    id: "keyboard-trap-modal-escape",
    task: "Tab through the page and reach the delivery notes at the end.",
    source: "WCAG 2.1.2 Understanding; ARIA Authoring Practices, dialog pattern",
    mutation: "A focus guard confines Tab to a dialog holding four text fields. The conformant variant "
      + "releases it on Escape and moves focus back to the page; the failing one ignores Escape, so the "
      + "only documented way out of a modal does nothing.",
    criterion: "2.1.2",
    subtype: "focus-trapped",
    // THE SIBLING OF `keyboard-trap-modal-cycle`, AND IT EXISTS BECAUSE THAT CASE CANNOT EXPRESS THIS.
    //
    // That one conforms by a Close BUTTON inside the ring, which is correct and is the APG pattern -- so
    // NEITHER of its pages handles Escape, and `dialogEscape` came back byte-identical on both when the
    // probe was first pointed at it. Measured on the fleet, not reasoned about. A canary that cannot
    // express the fault is worthless, and the two cases now cover the two ways out that 2.1.2 accepts.
    //
    // `MODAL_TRAP_TOTAL_FORM` stood here until 2026-08-28 and was removed for having no signal that could
    // fire, with a note saying the page "will be needed the moment a probe can ask whether Escape releases
    // focus". That moment is capture-protocol 11.
    //
    // The pair differs in ONE keydown handler: same ring, same four text fields, same guard, same size.
    // So nothing that discriminates it can be reading the SHAPE of a modal, which is how three earlier
    // trap rules came to accuse real consent banners.
    good: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: MODAL_ESCAPE_FORM(),
      script: MODAL_ESCAPE_RELEASES,
    }),
    bad: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: MODAL_ESCAPE_FORM(),
      // The identical guard with no Escape handler. Focus is held and the documented way out does nothing.
      script: MODAL_FOCUS_GUARD,
    }),
    badSignal: { type: "escape-does-not-release" },
    // All three are required and the case is worthless without any one of them. `probeDialog` presses
    // Escape; `probeFocus` is what puts focus INSIDE the dialog first, since a sweep is browse mode and
    // never moves DOM focus; `focus-first` runs the pair before the sweep can activate anything.
    probeFocus: true,
    probeDialog: true,
    probeOrder: "focus-first",
  }),
);

cases.push(
  pair({
    id: "focus-order-scripted-advance",
    task: "Tab through the form and complete it in the order it reads.",
    source: "WCAG 2.4.3 Understanding; Practical Web Accessibility, chapter 6",
    mutation: "A keydown handler redirects Tab to a field further down the form, so tab order contradicts "
      + "reading order without any tabindex being present.",
    criterion: "2.4.3",
    // A DIFFERENT SCRAMBLE FROM `focus-order-tabindex`. That one is declarative — a positive `tabindex`,
    // which every static checker already flags as a smell. This one has no `tabindex` anywhere: the order
    // is scrambled at runtime by an auto-advance handler, the pattern real forms grow when somebody makes
    // tabbing "smarter". Markup alone cannot answer it, which is the criterion's whole point here.
    good: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: FOCUS_ORDER_FORM(""),
    }),
    bad: page({
      title: "Delivery details",
      heading: "Delivery details",
      body: FOCUS_ORDER_FORM(""),
      // Tab from Email jumps PAST Postcode and Phone to Notes, then Postcode is reached only afterwards.
      // Reading order is untouched — the fields are in the same DOM order in both variants.
      script: "document.getElementById('b').addEventListener('keydown', (event) => {"
        + "  if (event.key === 'Tab' && !event.shiftKey) {"
        + "    event.preventDefault(); document.getElementById('e').focus();"
        + "  }"
        + "});"
        + "document.getElementById('e').addEventListener('keydown', (event) => {"
        + "  if (event.key === 'Tab' && !event.shiftKey) {"
        + "    event.preventDefault(); document.getElementById('c').focus();"
        + "  }"
        + "});",
    }),
    badSignal: { type: "focus-order-scrambled" },
    probeFocus: true,
    probeForms: true,
    probeOrder: "focus-first",
  }),
);

cases.push(
  pair({
    id: "keyboard-unreachable-native-button",
    task: "Reach the delete action for a draft using the keyboard alone.",
    source: "WCAG 2.1.1 Understanding; F55",
    mutation: "A real button carries tabindex=\"-1\", so it announces as a button and Tab never reaches it.",
    criterion: "2.1.1",
    // A DIFFERENT UNREACHABILITY FROM `keyboard-unreachable-action`, and the more interesting one. That
    // case is a `div role="button"` with no `tabindex` — the shape every static rule looks for. This is a
    // NATIVE `<button>`, which is focusable by default and which a checker scanning for "interactive
    // element without a tabindex" passes without comment. `tabindex="-1"` removes it from the tab order
    // while leaving it in the accessibility tree, so NVDA announces it exactly as it announces the
    // reachable one.
    //
    // That makes the pair announce IDENTICALLY and differ only in whether a keyboard can operate it,
    // which is the same controlled comparison the sibling case makes by a route static analysis can see.
    good: page({ title: "Drafts", heading: "Drafts", body: NATIVE_ACTION_PAGE(true) }),
    bad: page({ title: "Drafts", heading: "Drafts", body: NATIVE_ACTION_PAGE(false) }),
    badSignal: { type: "control-unreachable-by-keyboard" },
    probeFocus: true,
    probeForms: true,
    probeOrder: "focus-first",
  }),
);

/**
 * ACCOMPANYING DEFECTS — a real page fails several ways at once, and this corpus never did.
 *
 * ADR 0015 measured what that costs: a feature that is 0 on every positive of a subtype is one the head can
 * penalise for free, and the shipped weights carry 225 such vetoes. The furniture buckets fixed the ones
 * conformant structure can supply (263 starved pairs -> 178). What remains are features that ARE failures —
 * a vague link, a generic heading, an unnamed graphic, a position-only table cell, a bare edit field. No
 * conformant page can carry them, by definition, so only a page that fails TWICE supplies them.
 *
 * Each snippet is a defect this corpus already demonstrates on its own, reused so the pairing cannot invent
 * a failure mode nothing else asserts. `subtypes` names the heads that carry it, and `alsoFails` puts them
 * in the label — the `form-unlabelled` precedent, where a missing label is 3.3.2 AND 4.1.2 and scoring it
 * as one turned 109 correct detections into false positives.
 */
/**
 * CONFORMANT accompaniments — page behaviour that is correct, present in BOTH variants.
 *
 * `ACCOMPANYING_DEFECTS` below injects into `bad` only, which is right for a defect and wrong for this:
 * furniture that appeared solely on failing pages would correlate with the label, and I would be creating
 * the very shortcut ADR 0015 is about, pointing the other way.
 *
 * ## Why this exists
 *
 * `corpus:starvation` measures 51 fixable starved pairs, and the two features heading the list —
 * `status_update_announced` and `validation_error_announced`, 10 subtypes each — are INTERACTION evidence:
 * a status message spoken after activating something. No page about an image or a table has ever carried
 * them, so the image head and the table head can penalise them for free. On a real page — which has images
 * AND a working filter — that veto fires against evidence the head was trained to treat as somebody else's.
 *
 * Furniture cannot supply them: the pieces in `SCALE_BUCKETS` are static, and this evidence only exists
 * when `probeForms` activates something. Hence a conformant accompaniment carrying its own probe flag.
 *
 * ## Two constraints that shaped the markup
 *
 * The widget is a BUTTON with a live region, not a `<form>` — copied from `filter-status-silent`'s
 * conformant variant, which this corpus already proves captures and discriminates. `namedField`'s comment
 * records why a second `<form>` is forbidden: `probeForms` submits a form, and two make it ambiguous which
 * one a case's own probe activates.
 *
 * For the same reason it is paired ONLY with hosts that have no interactive control of their own. A host
 * with its own button plus this one is two things to press, and which the probe chooses is a difference the
 * label does not describe — the one defect this corpus cannot carry.
 */
/** @type {Record<string, any>} */
export const ACCOMPANYING_CONFORMANT = Object.freeze({
  // A filter that finds nothing and SAYS SO. `validation_error_announced` starves 10 subtypes — the most of
  // any remaining fixable feature — and it is conformant behaviour: the error being spoken is the criterion
  // being SATISFIED. `3.3.1:validation-error-silent` is the page where it is not.
  //
  // Same button-and-live-region shape as `status-region` rather than a real form, for the reason recorded
  // there: a second `<form>` makes `probeForms` ambiguous about which one a case's own probe activates.
  // `ERROR_WORD` in the featurizer matches /invalid|\berror\b/, so the announced text has to carry one.
  "validation-message": {
    markup: [
      "<p><button id=\"check-ref\" type=\"button\">Check reference</button></p>"
        + "<p id=\"ref-message\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">Enter a reference to check.</p>"
        + "<script>document.querySelector('#check-ref').addEventListener('click', () => "
        + "{ document.querySelector('#ref-message').textContent = "
        + "'Error: that reference was not recognised.'; });</script>",
      "<p><button id=\"check-code\" type=\"button\">Check code</button></p>"
        + "<p id=\"code-message\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">Enter a code to check.</p>"
        + "<script>document.querySelector('#check-code').addEventListener('click', () => "
        + "{ document.querySelector('#code-message').textContent = "
        + "'That code is invalid. Check it and try again.'; });</script>",
    ],
    grants: ["validation_error_announced", "form_change_present", "form_change_nonempty"],
    probeForms: true,
    task: "Check the reference and notice what the page says back.",
  },
  // A SHORT LINK NAME THAT CONFORMS. The remedy for a word-sense monopoly, and the reason it is needed is
  // measured: every one of the 13 wordlist terms appears on failing pages only — `link:details` 0 good /
  // 17 bad — so the corpus teaches that the WORD is the failure. It is not. 2.4.4 is Link Purpose IN
  // CONTEXT, and "Details" naming a component inside an index of component names conforms.
  //
  // The scorer accused 11 GOV.UK Design System pages of 2.4.4 on the strength of one announcement,
  // `"link, Details"`, where the shipped model accused none. This markup is that exact shape: a nav
  // landmark holding a list of peer links, each a proper noun naming a distinct destination. What makes it
  // conformant is what makes GOV.UK's conformant — the link is not a lone call to action after prose, it is
  // one item in a homogeneous index, and its neighbours establish the kind of thing it names.
  //
  // No control and no `probeForms`: this is static structure, which is why the control guard below is now
  // conditional rather than applied to every piece.
  "component-index": {
    markup: [
      // A bare list, NOT a `<nav>`. The landmark version was captured and broke three cases: NVDA announces
      // a container transition when the caret crosses one, so `form-unlabelled`'s bare `"edit"` became
      // `"main landmark, form, edit"` and its signal stopped matching — the role-prefix problem one layer
      // out. It also gave a landmark to `landmarks-missing`, whose failure IS having none.
      //
      // Nothing is lost. What makes the link conform is that it is one item in a homogeneous index of peer
      // links, which the list supplies; WCAG's programmatically determined context names the LIST ITEM, not
      // the landmark.
      "<ul>"
        + "<li><a href=\"/components/accordion\">Accordion</a></li>"
        + "<li><a href=\"/components/details\">Details</a></li>"
        + "<li><a href=\"/components/tabs\">Tabs</a></li>"
        + "<li><a href=\"/components/table\">Table</a></li>"
        + "</ul>",
      "<ul>"
        + "<li><a href=\"/guidance/eligibility\">Eligibility</a></li>"
        + "<li><a href=\"/guidance/details\">Details</a></li>"
        + "<li><a href=\"/guidance/deadlines\">Deadlines</a></li>"
        + "<li><a href=\"/guidance/contacts\">Contacts</a></li>"
        + "</ul>",
    ],
    // No `subtypes`: it adds no failure, so no label changes — the test every accompaniment must pass.
    grants: ["vague_link_present"],
    // 2.4.4's own cases USE these words as their failing example -- `link-vague-market` and
    // `link-vague-clinic` are both "Details" -- so accompanying one would put the word on its good variant
    // and its badSignal would fire on both. That is CONTAMINATED, the one thing this corpus cannot carry.
    // Every other criterion is unaffected: a page about an unnamed form field does not care what a link in
    // an index is called. (This paragraph was here TWICE, once in each dash style, and the copies had
    // already drifted apart in wording -- the fact-stated-twice shape inside a comment.)
    //
    // THE OTHER THREE WERE EXCLUDED ON A STALE PREMISE, and the measurement has now been taken.
    //
    // The recorded reason was: "The rest are criteria whose evidence IS the focus order, and this piece
    // adds four focusable links. `focusOrder` truncates at 12 stops, so four more push the case's own
    // controls out of the window and both variants come back looking alike -- measured on
    // `focus-order-tabindex`, which reported CONTAMINATED for exactly that reason."
    //
    // `MAX_TAB_STOPS` became 150 on 2026-08-25 and the exclusion was never re-measured. Settled
    // 2026-08-31 by capturing all seven affected families with the piece applied:
    //
    //     1469 discriminating, 0 blind, 0 CONTAMINATED, 0 uncaptured, 0 stale
    //     keyboard-unreachable-action+with-component-index          OK
    //     keyboard-unreachable-native-button+with-component-index   OK
    //     keyboard-trap-postcode+with-component-index               OK
    //     keyboard-trap-blur-revalidate+with-component-index        OK
    //     keyboard-trap-modal-cycle+with-component-index            OK
    //     focus-order-tabindex+with-component-index                 OK
    //     focus-order-scripted-advance+with-component-index         OK
    //
    // So the exclusion is lifted for those three, and `audit_applicability.py` no longer has grounds to
    // call the free-veto remedy UNAVAILABLE for `2.1.1`, `2.1.2` and `2.4.3` -- which was the whole cost
    // of leaving a stale premise in place: it was cited elsewhere as a reason not to try.
    //
    // Purely additive when it landed: 7 new cases, 14 captures, and ZERO existing ids renamed.
    //
    // 2.4.4 STAYS excluded, on a reason the cap never touched: its own cases use these words as their
    // failing example -- `link-vague-market` and `link-vague-clinic` are both "Details" -- so
    // accompanying one would put the word on its good variant and its badSignal would fire on both.
    notFor: ["2.4.4"],
  },
  "status-region": {
    markup: [
      "<p><button id=\"filter-notes\" type=\"button\">Show recent notes</button></p>"
        + "<p id=\"notes-count\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">Showing 9 notes.</p>"
        + "<script>document.querySelector('#filter-notes').addEventListener('click', () => "
        + "{ document.querySelector('#notes-count').textContent = 'Showing 3 recent notes.'; });</script>",
      "<p><button id=\"filter-records\" type=\"button\">Show current records</button></p>"
        + "<p id=\"records-count\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">Showing 12 records.</p>"
        + "<script>document.querySelector('#filter-records').addEventListener('click', () => "
        + "{ document.querySelector('#records-count').textContent = 'Showing 4 current records.'; });</script>",
    ],
    // No `subtypes`: it adds no failure, so no label changes. That is what makes it furniture rather than
    // a defect, and why it belongs in both variants.
    grants: ["status_update_announced", "form_change_present", "form_change_nonempty", "post_submit_present"],
    // The evidence only exists if something is activated, and `probeForms` with no task activates nothing.
    probeForms: true,
    task: "Show the shorter list of notes and notice how many remain.",
  },
});

/** Hosts with a control of their own cannot take a second one — see the comment above. */
const CONFORMANT_HOSTS_PER_SUBTYPE = 3;
// `checkbox` and `radio` added 2026-09-01 with capture-protocol 12, and the omission was correct until
// then: this pattern asks "can the capture already activate something here", and until `probeKindFor`
// learned about toggles the answer for a bare checkbox was genuinely no. Widening what the tool operates
// means revisiting every place that decides what a CONTROL is, which is this repo's most expensive
// recurring shape -- a remedy that reaches one of several sites.
//
// Found by `case-matrix.test.ts` firing on `filter-status-silent-checkbox+with-status-region`: the new
// checkbox host read as control-free, so it was given furniture carrying a live region -- onto a case
// whose entire failure is a MISSING live region. Contamination by construction, and the guard caught it.
const HAS_OWN_CONTROL =
  /<button|<input[^>]*type=["']?(submit|button|checkbox|radio)|<select|<textarea|<form[\s>]/i;

// EXPORTED so the `grants` field can be verified rather than merely declared. It was read nowhere: eleven
// accompanying defects each state the feature their markup is supposed to produce in the captured
// evidence, and nothing ever checked that it did. `audit-grants.mjs` is that check.
/** @type {Record<string, any>} */
export const ACCOMPANYING_DEFECTS = Object.freeze({
  "vague-link": {
    // FOUR phrasings, not one, and they are the corpus's own — `link-vague-details`, `-here`, `-more`
    // and `-go` already demonstrate exactly these. Reusing them means an accompanying vague link is the
    // same failure the single-defect family teaches, rather than a sixth thing the model must learn.
    markup: [
      "<p><a href=\"#detail-note\">Details</a></p>",
      "<p><a href=\"#detail-note\">Here</a></p>",
      "<p><a href=\"#detail-note\">More</a></p>",
      "<p><a href=\"#detail-note\">Read more</a></p>",
    ],
    subtypes: ["2.4.4:regex"],
    // `vague_link_present` was REMOVED from the feature vector on 2026-08-25 -- it asks 2.4.9's question
    // (is the text alone vague), a AAA criterion this project does not report, and the 2.4.4 head was
    // using it as a shortcut: dropping it took that head from 27 false positives to 0. The declaration
    // kept naming it, so `corpus:grants-audit` read a feature that does not exist and reported 52 records
    // as missing evidence. `vague_link_without_context` is the one the pipeline computes, and it is the
    // right claim anyway: this markup appends a bare link with nothing around it.
    grants: "vague_link_without_context",
  },
  // THE SAME DEFECT, REACHABLE BY THE THREE FOCUS HEADS. `bare-edit-inert`'s argument, one feature along.
  //
  // `vague_link_without_context` is 0 on every positive of `2.1.1:control-unreachable-by-keyboard`,
  // `2.1.2:focus-trapped` and `2.4.3:focus-order-scrambled`, so each may penalise it at no cost — it is
  // the WORST veto on all three, and the cost is real: a page with a bare "Read more" is ordinary, and
  // the penalty pushes those heads down on exactly the pages they should fire on.
  //
  // `vague-link` is the only accompanying defect granting it, and `PERTURBS_FOCUS_ORDER` rightly excludes
  // it: an `<a href>` is a TAB STOP, injected into the BAD variant only, so it corrupts the very channel
  // those three subtypes are measured on.
  //
  // `tabindex="-1"` breaks the tie exactly as it did for the field. NVDA's link quick-nav (`k`) walks the
  // browse-mode buffer, not the tab order, so the link is still announced and still has no context around
  // it — while adding no tab stop, leaving the controlled pair controlled.
  //
  // A NON-FOCUSABLE LINK IS NOT A CONTRIVANCE. `tabindex="-1"` on an anchor is what a script does when it
  // takes over activation, and it is its own accessibility failure — which is the point: this markup is a
  // real defect, not a marker planted to move a number.
  //
  // UNVERIFIED UNTIL CAPTURED, like its sibling. Whether NVDA's `k` reaches a non-focusable anchor is a
  // question about NVDA; `--pipeline=verify --only=` answers it in minutes, and `corpus:grants-audit`
  // reports it if the answer is no — in which case this grants nothing and must be DELETED rather than
  // left looking useful.
  // A DISCLOSURE THAT NEVER OPENS — the third `-inert` accompanying defect, and it took two attempts.
  //
  // `state_unchanged` is 0 on every positive of `3.3.1:validation-error-silent` and
  // `4.1.3:form-activation-silent`, which are the only two closable vetoes on a subtype the model
  // actually decides. The feature can only be 1 when a toggle is activated and its state does NOT
  // change — `4.1.2:state-change-silent`'s own defect — and no accompanying defect provided one.
  //
  // WITHDRAWN ON THE FIRST ATTEMPT, 2026-08-31: the ninth rotation re-rolled all multi-defect cases and
  // left `2.4.3:focus-order-scrambled` with 8 cases and no table furniture — a new free veto created
  // while closing two, caught by `furniture-spread`.
  //
  // WHAT CHANGED IS NOT THIS PIECE. Lifting the stale `component-index` exclusion gave the three focus
  // subtypes their conformant furniture back, and `2.4.3` went from 8 cases to 35. A subtype with 35
  // cases sees every furniture shape by construction; one with 8 was near the edge. The starvation was
  // never a property of re-rolling — measured by adding two unrelated twelfth rotations, both of which
  // pass `furniture-spread` — it was a property of a subtype that was too thin, for a reason that has
  // since been refuted.
  //
  // WHY IT DOES NOT PERTURB ITS HOSTS. A disclosure activation lands in `interaction.stateChanges`; the
  // two target subtypes are measured on `formChanges` and `postSubmitFields`. Different channels.
  //
  // `tabindex="-1"` for the same reason as its two siblings: a `<button>` is a TAB STOP and this markup
  // goes into the BAD variant only, so without it the focus-order subtypes would see one half of a
  // controlled pair grow a stop. NVDA's form-field quick-nav walks the browse-mode buffer rather than the
  // tab order, so the button is still announced, still says `collapsed`, and still fails to change.
  //
  // UNVERIFIED UNTIL CAPTURED, like both siblings. Whether NVDA's `f` reaches a `tabindex="-1"` button and
  // whether browse-mode Enter activates it are questions about NVDA. `corpus:grants-audit` reports it if
  // the answer is no — in which case this grants nothing and must be DELETED rather than left looking
  // useful.
  "silent-toggle-inert": {
    markup: [
      "<p><button type=\"button\" aria-expanded=\"false\" tabindex=\"-1\">Show delivery options</button></p>",
      "<p><button type=\"button\" aria-expanded=\"false\" tabindex=\"-1\">Show opening hours</button></p>",
      "<p><button type=\"button\" aria-expanded=\"false\" tabindex=\"-1\">Show contact details</button></p>",
    ],
    subtypes: ["4.1.2:state-change-silent"],
    grants: "state_unchanged",
  },
  "vague-link-inert": {
    markup: [
      "<p><a href=\"#detail-note\" tabindex=\"-1\">Details</a></p>",
      "<p><a href=\"#detail-note\" tabindex=\"-1\">Here</a></p>",
      "<p><a href=\"#detail-note\" tabindex=\"-1\">More</a></p>",
      "<p><a href=\"#detail-note\" tabindex=\"-1\">Read more</a></p>",
    ],
    subtypes: ["2.4.4:regex"],
    grants: "vague_link_without_context",
  },
  // The three below were added 2026-08-23 for a measured reason, not for variety.
  //
  // Per-head recall tracks the number of POSITIVES, and the cliff is around 140. Every subtype that was
  // already an accompanying defect had 137-162 positives and recall 0.87-1.00; every subtype that was not
  // had 38-42 and recall 0.54-0.76 — `1.3.1:fake-heading` at 41 positives and 0.54 was the worst, and it
  // is where the remaining held-out misses live. An accompaniment multiplies a subtype's positives across
  // every multi-defect host, which is exactly why the others are healthy.
  //
  // The markup is copied from the single-defect case that already demonstrates each failure, for the same
  // reason `vague-link` reuses the corpus's own phrasings: an accompanying fake heading should be the same
  // failure the family teaches, not a sixth thing to learn. `withAccompanyingDefects` already refuses to
  // pair a defect with a host of its own subtype, so no page gets its own failure twice.
  "fake-heading": {
    markup: [
      "<div class=\"fake-heading\">Borrowing books</div><p>Members may borrow six books at a time.</p>",
      "<div class=\"fake-heading\">Contact and opening hours</div><p>The desk is open until five.</p>",
      "<div class=\"fake-heading\">Where to find us</div><p>The entrance is on the east side.</p>",
    ],
    subtypes: ["1.3.1:fake-heading"],
    grants: "plain_heading_candidate_present",
  },
  "filename-alt": {
    markup: [
      "<img src=\"/trail_entrance-final.jpg\" alt=\"trail_entrance-final.jpg\">",
      "<img src=\"/site_plan_v2.png\" alt=\"site_plan_v2.png\">",
      "<img src=\"/DSC_0421.jpg\" alt=\"DSC_0421.jpg\">",
    ],
    subtypes: ["1.1.1:filename-alt"],
    grants: "filename_graphic_present",
  },
  "generic-alt": {
    markup: [
      "<img src=\"/missing-chart.png\" alt=\"image\">",
      "<img src=\"/notice-board.png\" alt=\"photo\">",
      "<img src=\"/summary-panel.png\" alt=\"graphic\">",
    ],
    subtypes: ["1.1.1:generic-alt"],
    grants: "generic_graphic_present",
  },
  "generic-heading": {
    markup: [
      "<h2>Welcome</h2><p>General notes about this service.</p>",
      "<h2>Details</h2><p>Further information is kept with the records.</p>",
      "<h2>Things</h2><p>Assorted notes retained by the site team.</p>",
      "<h2>Stuff</h2><p>Miscellaneous items held for reference.</p>",
    ],
    subtypes: ["2.4.6:regex"],
    grants: "generic_heading_present",
  },
  "unnamed-graphic": {
    // Three distinct images, because an unnamed graphic announces the same hint whatever the file is —
    // varying the FILE varies the surrounding transcript, which is what the head reads.
    markup: [
      "<img src=\"/missing-chart.png\">",
      "<img src=\"/missing-garden.png\">",
      "<img src=\"/missing-trail.png\">",
    ],
    subtypes: ["1.1.1:missing-alt"],
    grants: "unnamed_graphic_present",
  },
  "position-only-table": {
    // No `scope`, so NVDA announces data cells by position and never carries the header name into them —
    // `row 2, column 1, ...` rather than `row 2, Note, column 1, ...`. That is the announcement
    // `tableHeadersAreUnassociated` reads, and it is why this cannot be furniture: it IS the 1.3.1 failure.
    markup: [
      "<table><caption>Archive index</caption>"
        + "<tr><td>Period</td><td>Held</td></tr><tr><td>2019</td><td>Yes</td></tr></table>",
      "<table><caption>Session times</caption>"
        + "<tr><td>Day</td><td>Hours</td></tr><tr><td>Saturday</td><td>10 to 4</td></tr></table>",
      "<table><caption>Room rates</caption>"
        + "<tr><td>Room</td><td>Rate</td></tr><tr><td>Hall</td><td>45</td></tr></table>",
    ],
    subtypes: ["1.3.1:unassociated-table"],
    grants: "table_position_only",
    // THE PROBE ITS RULE-SIDE EVIDENCE NEEDS — known-gaps §19.
    //
    // `probeTables` is opt-in, and a host that does not set it produces `structure.tableCells: []` — so
    // the case carries the label `1.3.1:unassociated-table` while the channel a rule would read was never
    // captured. Measured over the built case list: 69 cases pair this defect and ALL 69 inherited
    // `probeTables: false` from their host, because `withAccompanyingDefects` spreads `...template`.
    //
    // Nothing fails today and that is exactly why it is worth fixing now rather than later: no rule reads
    // `tableCells`, and `grants: "table_position_only"` is computed from the TRANSCRIPT, which carries the
    // table fine — so `corpus:grants-audit` passes, correctly. The moment a deterministic rule for
    // unassociated tables is written, it finds nothing on all 69 and reads as a rule that never fires:
    // `rules:coverage`'s "NEVER FIRED ANYWHERE — the claim rests on nothing", pre-arranged.
    //
    // Applied with the protocol 8 bump because it changes the capture options and therefore the cache
    // key. On its own it would have cost 138 recaptures to populate a field nothing reads, which is why
    // it was written, reverted and recorded in August rather than shipped alone.
    probes: { probeTables: true },
  },
  // THE FOCUS-SAFE BARE EDIT, and it exists to close a free veto no other pairing can reach.
  //
  // `form_field_unnamed` is 0 on every positive of the three focus subtypes, so each head may penalise it
  // at no cost — measured at -4.60 to -6.59 logits, and the cost is real because a real page frequently
  // HAS an unnamed field, which then pushes the head down on exactly the pages it should fire on.
  //
  // `bare-edit` is the only accompanying defect granting that feature and `PERTURBS_FOCUS_ORDER` rightly
  // excludes it: the accompanying markup is injected into the BAD variant ONLY, so an `<input>` adds a tab
  // stop to one half of a controlled pair and corrupts the very channel those cases are measured on. That
  // produced the corpus's only BLIND case in 1,306.
  //
  // `tabindex="-1"` breaks the tie. The field stays in the accessibility tree — NVDA's form-field
  // quick-nav walks the browse-mode buffer, not the tab order — while adding no tab stop at all, so the
  // pair stays controlled and the feature becomes reachable.
  //
  // UNVERIFIED UNTIL CAPTURED. Whether NVDA's `f` quick-nav actually reaches a non-focusable input is a
  // question about NVDA, not about this markup, and `--pipeline=verify --only=` answers it in minutes.
  // If it does not, this defect grants nothing and must be deleted rather than left looking useful —
  // `corpus:grants-audit` is what will say so.
  "bare-edit-inert": {
    markup: [
      "<p><input name=\"note-ref\" type=\"text\" tabindex=\"-1\"></p>",
      "<p><input name=\"ref-code\" type=\"text\" tabindex=\"-1\"></p>",
      "<p><input name=\"visit-note\" type=\"text\" tabindex=\"-1\"></p>",
    ],
    subtypes: ["3.3.2:unnamed-form-field", "4.1.2:unnamed-control"],
    grants: "bare_edit_present",
  },
  "bare-edit": {
    // Announced as a bare role with no name. Two heads, for the reason `form-unlabelled` documents at
    // length: an unnamed field is 3.3.2 and 4.1.2 as squarely as each other.
    markup: [
      "<p><input name=\"note-ref\" type=\"text\"></p>",
      "<p><input name=\"ref-code\" type=\"text\"></p>",
      "<p><input name=\"visit-note\" type=\"text\"></p>",
    ],
    subtypes: ["3.3.2:unnamed-form-field", "4.1.2:unnamed-control"],
    grants: "bare_edit_present",
  },
});

/**
 * Pick ONE phrasing of an accompanying defect, varying with the host so the same snippet does not land on
 * every page.
 *
 * The first version of this family used a single hardcoded string per defect: "Read more" appeared on 93
 * of 240 pages, byte-identical. That is the error this project diagnosed in the W3C real-page corpus the
 * same week — one unnamed combo box repeated three times and counted as three failures. Scaling the number
 * of PAGES without scaling the variety of the thing being learned teaches the string, not the concept.
 */
function accompanyingMarkup(/** @type {any} */ name, /** @type {any} */ hostId, /** @type {any} */ round) {
  const options = ACCOMPANYING_DEFECTS[name].markup;
  let hash = 0x811c9dc5;
  for (const character of `${hostId}|${name}|${round}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return options[hash % options.length];
}

/**
 * Pairings whose ANNOUNCEMENTS collide, so the accompanying defect satisfies the host's own signal.
 *
 * Named individually rather than inferred from the criterion, because the collision is a fact about what
 * NVDA says and not about WCAG numbering. `1.1.1:generic-alt`'s signal is /graphic.*\bimage\b/ and an
 * unnamed graphic announces as "graphic, to get missing image descriptions" — one phrase satisfying two
 * different subtypes' patterns. `filler-collision.test.ts` fails on anything missing from this list.
 */
/**
 * Accompanying defects that add a FOCUSABLE element, and the hosts they must never be paired with.
 *
 * A different failure from a text collision, and the collision test could not see it. `focus-order-tabindex`
 * measures the tab order against the reading order; an accompanying `<a href>` or `<input>` ENTERS the tab
 * order, so it perturbs the very evidence the host depends on. Measured 2026-08-23: pairing bare-edit and
 * vague-link with that host produced the corpus's only BLIND case in 1,306 — its signal never fired on the
 * bad page, because the accompanying controls changed what `focusOrder` recorded.
 *
 * The general rule, which is worth more than this instance: **an accompanying defect must not perturb the
 * evidence CHANNEL its host is measured on.** `criterion-coverage.ts` names each criterion's channels, and
 * the four that read `focusOrder` — 2.1.1, 2.1.2, 2.4.1, 2.4.3 — are the ones a focusable element reaches.
 * Heading, graphic and table snippets are inert and safe for every host.
 */
const PERTURBS_FOCUS_ORDER = Object.freeze(["vague-link", "bare-edit"]);
const FOCUS_ORDER_CRITERIA = Object.freeze(["2.1.1", "2.1.2", "2.4.1", "2.4.3"]);

/** @type {Record<string, any>} */

const COLLIDING_PAIRINGS = Object.freeze({
  "1.1.1:generic-alt": ["unnamed-graphic"],
  "1.1.1:filename-alt": ["unnamed-graphic"],
  "1.3.1:unassociated-table": ["position-only-table"],
  // `generic-heading` adds a REAL <h2> — vaguely worded, which is 2.4.6's failure, but a heading all the
  // same. On a page whose whole claim is "there are no headings" that does not merely muddy the label, it
  // makes the assertion FALSE: `structure.headings` is no longer empty, so the case stops testing
  // anything while still being labelled a 1.3.1 positive. Caught by generating the pages and grepping the
  // markup for `<h1-6>`; 5 of the 29 variants carried one.
  "1.3.1:no-headings": ["generic-heading"],
});

/**
 * Pair an existing case's failure with one or more OTHER criteria's failures, on the bad variant.
 *
 * The bad variant only, because `export-screenreader-dataset.mjs` hardcodes every good variant to
 * `label: "clean"` with no subtypes — "we wrote the page, so we know every criterion's status". Putting an
 * accompanying defect on the good variant too would preserve the controlled comparison and produce a
 * page labelled clean that has a vague link in it, which is a worse trade: a wrong label poisons evidence,
 * where a labelled second difference merely widens what the pair demonstrates.
 *
 * ROTATED, never applied by family. `form-unlabelled`'s comment records why: applying `alsoFails` across a
 * whole family "would have taught the scorer 3.3.2 implies 4.1.2, which is a shortcut feature and exactly
 * the contamination this corpus exists to avoid". So each host gets a DIFFERENT subset, and a host is never
 * paired with a defect it already demonstrates — that would make the accompanying evidence indistinguishable
 * from its own.
 */
function withAccompanyingDefects(/** @type {any} */ template, /** @type {any} */ names, round = 0) {
  // Excluded by SUBTYPE, plus an explicit list of pairings whose ANNOUNCEMENTS collide.
  //
  // This was briefly a criterion-level exclusion, and that was too blunt. It was introduced for a real
  // collision — `image-generic-alt` (1.1.1:generic-alt, signal /graphic.*\bimage\b/) paired with the
  // unnamed graphic (1.1.1:missing-alt), whose announcement is "graphic, to get missing image
  // descriptions", so the accompanying defect satisfied the HOST's own signal. But excluding the whole
  // criterion also blocked the one pairing 3.3.2 most needs.
  //
  // Measured (ADR 0015, 2026-08-23): `3.3.2:placeholder-only`'s false positives are `form-unlabelled-*`
  // pages. The two failures are genuinely similar — both are form fields lacking a proper label — the veto
  // was what separated them, and NO page in the corpus contains both, so the head has never been shown the
  // difference. Pairing them is exactly the fix, and the criterion rule forbade it.
  //
  // So the collision is named where it happens rather than generalised into a rule that costs more than it
  // saves. `filler-collision.test.ts` catches any pairing this list misses — it caught the original.
  const collides = (COLLIDING_PAIRINGS[`${template.criterion}:${template.subtype}`] ?? []);
  const readsFocusOrder = FOCUS_ORDER_CRITERIA.includes(template.criterion);
  // SUBSTITUTED, not dropped — and substituting rather than adding a rotation is the whole reason this
  // costs three subtypes instead of the corpus.
  //
  // `bare-edit` is the only accompanying defect granting `form_field_unnamed`, and dropping it from the
  // four focus-order criteria left that feature at 0 on every positive of three subtypes: a free veto
  // worth -4.60 to -6.59 logits, which pushes those heads DOWN on any page carrying an unnamed field —
  // and real pages frequently do. `bare-edit-inert` is the same markup with `tabindex="-1"`, so it is an
  // unnamed field in the accessibility tree and adds no tab stop to the bad variant.
  //
  // Adding it to ROTATIONS instead would have re-rolled every multi-defect pairing in the corpus, because
  // the choice is `(rotation + round) % ROTATIONS.length` — that list's own comment says enlarging it must
  // be treated like a protocol bump. Substituting inside the filter touches only the cases that were
  // already dropping the defect, so every other page stays byte-identical.
  //
  // `vague-link` WAS dropped too, on the reasoning that "a link is a tab stop by nature, and
  // `tabindex="-1"` on one would make it unreachable, which is a DIFFERENT defect and would collide with
  // 2.1.1's own signal". CHECKED against the predicates rather than accepted, 2026-08-28, and it does not
  // hold: `controlUnreachableByKeyboard` and `focusOrderIsScrambled` both compare
  // `structure.formFields` against `interaction.focusOrder`, and neither reads `structure.links`. An
  // inert anchor enters neither channel — not a form field, not a tab stop — so it cannot move either
  // verdict. `skipLinkIsInert` reads `routeChange`, and the 2.1.2 rule reads the same two channels.
  //
  // `vague_link_without_context` is the WORST veto on all three focus heads, so leaving it unreachable
  // costs more than the collision that turned out not to exist.
  //
  // A MAP, not a chain: two substitutions were an `if`, a third would be the fifteen-`if` shape
  // `SIGNAL_PREDICATES` one file along exists to avoid.
  /** @type {Record<string, string>} */
  const FOCUS_SAFE = { "bare-edit": "bare-edit-inert", "vague-link": "vague-link-inert" };
  const focusSafe = (/** @type {any} */ name) =>
    (readsFocusOrder && name in FOCUS_SAFE ? FOCUS_SAFE[name] : name);
  const chosen = names.map(focusSafe).filter((/** @type {any} */ name) => !collides.includes(name)
    && !(readsFocusOrder && PERTURBS_FOCUS_ORDER.includes(name))
    && !ACCOMPANYING_DEFECTS[name].subtypes.some((/** @type {any} */ s) => s === `${template.criterion}:${template.subtype}`));
  if (chosen.length === 0) return null;
  const markup = chosen.map((/** @type {any} */ name) => accompanyingMarkup(name, template.id, round)).join("");
  const added = chosen.flatMap((/** @type {any} */ name) => ACCOMPANYING_DEFECTS[name].subtypes);
  // THE PROBES ITS ADDED DEFECTS NEED, unioned over the host's — known-gaps §19.
  //
  // Spreading `...template` alone inherits the HOST's probe settings, so a defect whose evidence needs an
  // opt-in probe got its LABEL and not its evidence. A UNION and never an override: a host that already
  // probes keeps doing so, and no accompanying defect can turn a probe OFF.
  //
  // `probeForms` is deliberately unreachable this way — no accompanying defect declares it, and one that
  // did would make this tool PRESS BUTTONS because of a label. That is a decision for the case author,
  // not a side effect of a pairing, and it is the same line `chooseProbe` draws for the CLI.
  const probes = Object.assign({}, ...chosen.map((/** @type {any} */ name) =>
    ACCOMPANYING_DEFECTS[name].probes ?? {}));
  return pair({
    ...template,
    ...probes,
    id: `${template.id}+also-${chosen.join("-")}`,
    // Its OWN family, not the template's. Sharing one would put a two-defect page in the same train/test
    // split group as the single-defect case it was built from, so a held-out score would be reading a
    // near-duplicate of something it trained on.
    family: `multi-defect-${template.criterion}`,
    mutation: `${template.mutation} It ALSO carries: ${chosen.join(", ")}.`,
    alsoFails: [...new Set([...(template.alsoFails ?? []), ...added])],
    good: template.good,
    bad: template.bad.replace("</body>", `${markup}</body>`),
  });
}

/**
 * One host per scored subtype, each paired with a rotating subset — so no (host, accompanying) pairing is
 * deterministic and no accompanying defect lands on every positive of any subtype.
 *
 * Hosts are chosen from `cases` by subtype rather than written fresh: the host failure is then one this
 * corpus already proves it can capture and discriminate, so a two-defect page that fails to discriminate
 * is a fact about the pairing rather than about a page nobody had tried before.
 */
/**
 * WHAT THIS DELIBERATELY DOES NOT REACH, measured after the criterion exclusion above.
 *
 * Six subtype/feature cells stay starved because the only defect that would supply them belongs to the
 * host's own criterion, and pairing those is what produced the `image-generic-alt` collision:
 *
 *   1.1.1:generic-alt, 1.1.1:filename-alt  lack `unnamed_graphic_present`  (their graphic IS named)
 *   1.3.1:fake-heading                     lacks `table_position_only`
 *   3.3.2:placeholder-only                 lacks `bare_edit_present`       (a placeholder supplies a name)
 *   4.1.2:missing-role, :state-change-silent  lack `bare_edit_present`
 *
 * Each is a real residual: those heads can still penalise that feature for free. The fix is not another
 * pairing — NVDA announces an unnamed graphic as "to get missing image descriptions", which satisfies
 * `image-generic-alt`'s own /graphic.*\bimage\b/ whatever we label it. It needs a host written for the
 * purpose, with a signal that cannot be confused with its neighbour's. Recorded here rather than left for
 * `corpus:starvation` to report as an unexplained gap.
 */
//
// EXTENDED 2026-08-23 with the three under-represented subtypes. Per-head recall tracks the number of
// positives and the cliff is around 140: every subtype already in this list had 137-162 and recall
// 0.87-1.00, while `1.3.1:fake-heading` (41, recall 0.54), `1.1.1:filename-alt` (42, 0.71) and
// `1.1.1:generic-alt` (38, 0.76) were absent from it. Appearing here is what multiplies a subtype's
// positives across every host, which is why the original five are healthy and these three were not.
//
// GROWING THIS LIST RE-ROLLS EVERY MULTI-DEFECT CASE, and there is no version of it that does not.
//
// The rotation is chosen by `rotation % ROTATIONS.length`, so going from 5 entries to 11 changes which
// pairing every existing host gets. Measured when this was extended: all 237 multi-defect cases changed
// (sha256 ff29f3f903cf4694 -> beb80b93ae7cb105), invalidating 474 captures.
//
// I first wrote "appending is safe" here, by analogy with CASES. It is not, and the difference is worth
// understanding: a case's FURNITURE is keyed on a hash of its own id, so it depends on nothing else; a
// case's ROTATION is a choice from a shared list, so it depends on how many choices exist. Hashing would
// not fix it — `hash % length` moves too. Enlarging an option space necessarily re-rolls selections from
// it, and the only honest response is to treat it like a CAPTURE_PROTOCOL_VERSION bump: do it
// deliberately, bundled, and pay the recapture once.
const ROTATIONS = Object.freeze([
  ["vague-link", "generic-heading"],
  ["unnamed-graphic", "position-only-table"],
  ["bare-edit", "vague-link"],
  ["generic-heading", "unnamed-graphic"],
  ["position-only-table", "bare-edit"],
  ["fake-heading", "vague-link"],
  ["filename-alt", "bare-edit"],
  ["generic-alt", "position-only-table"],
  ["fake-heading", "unnamed-graphic"],
  ["filename-alt", "generic-heading"],
  ["generic-alt", "fake-heading"],
  // ADDED 2026-08-31 on the SECOND attempt. The first re-rolled `2.4.3` into furniture starvation when it
  // had 8 cases; it now has 35, because the stale `component-index` exclusion was lifted the same day.
  // `furniture-spread` is the guard that refused it then and passes it now.
  ["silent-toggle-inert", "generic-heading"],
]);

/**
 * How many DIFFERENT host cases each subtype contributes, and how many rotations each host gets.
 *
 * The first version took ONE host per subtype and gave it three rotations — 60 cases, each
 * host-plus-accompanying pairing seen once or twice. Measured (ADR 0015, 2026-08-23): that was enough to
 * demonstrate the mechanism and not enough to learn from. The false positives in the retrained candidate
 * were the multi-defect pages themselves — 9 of 10 for 2.4.1, 12 of 13 for 2.4.3 — because removing the
 * veto shortcut replaced an easy question ("my defect, or clean?") with a hard one ("my defect, or
 * somebody else's?") that the corpus barely taught.
 *
 * So: more hosts, so a pairing appears on many different pages rather than one. `HOSTS_PER_SUBTYPE` is
 * what actually varies the page; `ROUNDS_PER_HOST` varies which defects accompany it.
 *
 * The cost is capture time and it is bounded by `scale-buckets.test.ts`, which holds the night budget
 * against MEASURED fleet throughput. Raise these only with that test passing.
 */
const HOSTS_PER_SUBTYPE = 5;
const ROUNDS_PER_HOST = 3;

function multiDefectCases(/** @type {any} */ built) {
  // Every case per subtype, not just the first, so the hosts differ in their page content and not only in
  // which defect was bolted on. A pairing repeated across five different pages teaches the distinction;
  // the same page five times teaches the page.
  const bySubtype = new Map();
  for (const testCase of built) {
    const key = `${testCase.criterion}:${testCase.subtype}`;
    const hosts = bySubtype.get(key) ?? [];
    if (hosts.length < HOSTS_PER_SUBTYPE) bySubtype.set(key, [...hosts, testCase]);
  }
  /** @type {any[]} */
  const generated = [];
  // DEALT WITHIN THE SUBTYPE, from a hash of the subtype key — never a global running position.
  //
  // `rotation` was a counter advanced across every host in subtype-sorted order, so inserting a case in
  // ONE subtype shifted the accompanying defects of every host sorting after it. Those hosts' ids are
  // built from the defects they carry (`X+also-vague-link-generic-heading`), so shifting the defect
  // RENAMES the case — and a renamed case has no captures under its new id. Measured 2026-08-26: adding
  // five `1.3.1:no-headings` cases renamed **164 of 1,401** across 55 base cases, every one in a subtype
  // sorting after `1.3.1`, and none before it. `check-signals --require-complete` then refused the whole
  // corpus, naming cases nobody had touched.
  //
  // This is the SAME defect the furniture buckets already had and already fixed, in a sibling mechanism
  // that was never revisited — the shape this file's own header calls a fix reaching one of several paths.
  // So it takes the same remedy, and `bucketFor` is the model: an offset from the subtype's hash, plus the
  // host's index WITHIN that subtype. Inserting into another subtype now moves nothing (measured: 0
  // renames, against 164), while the rotations are still dealt rather than drawn independently, so a
  // subtype with several hosts still sees several combinations.
  //
  // The remaining cost is the same one furniture carries and is the deliberate trade: inserting a host
  // MID-SUBTYPE re-rotates the hosts after it within that subtype only.
  for (const [key, hosts] of [...bySubtype.entries()].sort(([a], [z]) => a.localeCompare(z))) {
    hosts.forEach((/** @type {any} */ template, /** @type {any} */ indexInSubtype) => {
      generated.push(...roundsForHost(template, fnv1a(key) + indexInSubtype * ROUNDS_PER_HOST));
    });
  }
  return generated;
}

/** The rounds of one host page, each taking the next rotation slot. */
function roundsForHost(/** @type {any} */ template, /** @type {any} */ rotation) {
  const made = [];
  for (let round = 0; round < ROUNDS_PER_HOST; round += 1) {
    const one = withAccompanyingDefects(template, ROTATIONS[(rotation + round) % ROTATIONS.length], round);
    if (one) made.push(one);
  }
  return made;
}

/**
 * One case per starved subtype: the host failure, unchanged, on a page that ALSO behaves correctly.
 *
 * The host's own defect is untouched and its signal must still discriminate — `check-signals` is the
 * adjudicator and has to stay 1303/0/0 for the existing corpus. What changes is that a positive of this
 * subtype now carries interaction evidence, so the head can no longer treat that evidence as proof the page
 * is somebody else's business.
 *
 * APPENDED, never inserted. Furniture is keyed on an FNV-1a hash of the case ID, so adding cases cannot
 * re-size any existing one's pages — proven when 60 new cases left `check-signals` reporting the identical
 * stale count. A sixth `SCALE_BUCKETS` entry would have changed `hash % 5` to `hash % 6` and invalidated
 * all 2,606 captures; this invalidates none.
 */
function withConformantBehaviour(/** @type {any} */ template, /** @type {any} */ name) {
  const piece = ACCOMPANYING_CONFORMANT[name];
  // A host with its own control cannot take a second one: `probeForms` would have two things to press and
  // which it chooses is a difference the label does not describe.
  //
  // Gated on the PIECE needing a control, not applied to every piece. It was unconditional while both
  // pieces were button-and-live-region shapes, so the distinction never mattered; a static piece excluded
  // from every host that happens to contain a `<form>` would lose most of its reach for a hazard it does
  // not create.
  if (piece.probeForms && (HAS_OWN_CONTROL.test(template.bad) || HAS_OWN_CONTROL.test(template.good))) {
    return null;
  }
  // A piece must not accompany a case whose own failure it would imitate. `component-index` carries the
  // word "Details", which is exactly what two 2.4.4 cases use as their vague example — so on those hosts it
  // would satisfy the badSignal on the GOOD variant and the pair would report CONTAMINATED.
  if ((piece.notFor ?? []).includes(template.criterion)) return null;
  // Keyed on the GENERATED case id, never on a running counter.
  //
  // It was `round % markup.length`, and adding a second conformant piece immediately re-picked the variant
  // for all 26 existing cases: the counter now advanced twice per host, so every page changed and 52 valid
  // captures went stale. Hashing the id makes a case's markup depend on nothing but its own name — the same
  // remedy `bucketFor` already applies to furniture, for the same reason, one layer up.
  const markup = piece.markup[fnv1a(`${template.id}+with-${name}`) % piece.markup.length];
  return pair({
    ...template,
    id: `${template.id}+with-${name}`,
    family: `conformant-behaviour-${template.criterion}`,
    mutation: `${template.mutation} The page ALSO carries correct behaviour: ${name}.`,
    // `?? template.*`, never the piece's value outright. Both existing pieces declare a `probeForms` and a
    // `task` because both are button-and-live-region shapes, so nothing ever noticed that assigning them
    // unconditionally ERASES the host's own. A static piece declares neither, and it silently turned
    // `form-error-silent` from `probeForms: true, task: "Submit the request..."` into `false` and `""` --
    // so the form was never submitted, no validation error was announced on EITHER variant, and six cases
    // reported CONTAMINATED. An accompaniment adds to a case; it does not get to disarm its probes.
    probeForms: piece.probeForms ?? template.probeForms,
    task: piece.task ?? template.task,
    // BOTH variants. A conformant accompaniment on the failing page alone would correlate with the label.
    good: template.good.replace("</body>", `${markup}</body>`),
    bad: template.bad.replace("</body>", `${markup}</body>`),
  });
}

/** One host per subtype starved of interaction evidence, chosen the same way multi-defect hosts are. */
function conformantBehaviourCases(/** @type {any} */ built) {
  const bySubtype = new Map();
  for (const testCase of built) {
    const key = `${testCase.criterion}:${testCase.subtype}`;
    const hosts = bySubtype.get(key) ?? [];
    if (hosts.length < CONFORMANT_HOSTS_PER_SUBTYPE) bySubtype.set(key, [...hosts, testCase]);
  }
  const generated = [];
  for (const [, hosts] of [...bySubtype.entries()].sort(([a], [z]) => a.localeCompare(z))) {
    for (const template of hosts) generated.push(...everyConformantPiece(template));
  }
  return generated;
}

/** Each conformant accompaniment applied to one host, skipping the ones it cannot take. */
function everyConformantPiece(/** @type {any} */ template) {
  return Object.keys(ACCOMPANYING_CONFORMANT).sort()
    .map((piece) => withConformantBehaviour(template, piece))
    .filter(Boolean);
}

// APPENDED. Appending is cheap and INSERTING is not, which is the opposite of what this comment said
// until 2026-08-26 — furniture was keyed on the case ID, and is now dealt by position WITHIN the subtype
// so no subtype can miss a bucket by chance (see `bucketFor`). Appending a case to the end of its
// subtype leaves the earlier ones alone; inserting one re-buckets everything after it in that subtype,
// and those pages recapture. That is the price of the ADR 0015 guarantee.
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
const CONSENT_FOCUS_GUARD = "var consenting = true;"
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
function CONSENT_WALLED_PAGE(withAlt) {
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

cases.push(
  pair({
    id: "image-missing-alt-behind-consent",
    criterion: "1.1.1",
    task: "Read the project update and understand what the illustration shows.",
    source: "Practical Web Accessibility, chapter 22; WCAG 1.1.1 Understanding",
    mutation: "The informative illustration has no alternative text. A consent banner confines Tab to its "
      + "own three controls on BOTH variants, which is conformant and is not the defect under test.",
    // THE PAGE THE CORPUS COULD NOT EXPRESS, and the reason four consecutive 2.1.2 rules scored 4/4 EXACT
    // here and were withdrawn on real pages. See `docs/determinism-plan.md` D1.
    //
    // The defect is a missing alt — nothing to do with focus. The banner is FURNITURE, identical on both
    // variants, and it reproduces what tfl.gov.uk and networkrail.co.uk do: Tab is held in a ring of
    // `link, button, button` while the sweep walks the four form fields BEHIND it.
    //
    // That makes this page a FALSE-POSITIVE DETECTOR for the whole focus family:
    //
    //   - ring 3 distinct, swept 4 form fields, so the withdrawn tab-stop and form-field rules both FIRE —
    //     on a page whose only defect is an image. `rules:gate` counts that on the good variant.
    //   - the sweep and the tab walk return DISJOINT sets, which is what made 2.1.1 report all four fields
    //     as keyboard-unreachable on a conformant page.
    //
    // Every rule that reads focus is now scored against a conformant page carrying an overlay, which is the
    // condition none of them had ever been tested under.
    badSignal: { type: "regex", pattern: "graphic[, ]+" + UNNAMED_GRAPHIC, flags: "i" },
    probeFocus: true,
    // ONE TITLE, not the corpus's usual "…with an informative/unlabelled illustration" pair. Most cases
    // describe their defect in the title, which is a second difference between the variants and therefore a
    // second thing a head could key on. On a page whose entire job is "exactly one difference", that
    // difference has to be the alt and nothing else.
    good: page({
      title: "Project update",
      heading: "Project update",
      body: CONSENT_WALLED_PAGE(true),
      script: CONSENT_FOCUS_GUARD,
    }),
    bad: page({
      title: "Project update",
      heading: "Project update",
      body: CONSENT_WALLED_PAGE(false),
      script: CONSENT_FOCUS_GUARD,
    }),
  }),
);

export const CASES = Object.freeze(withRealisticScale(
  [...cases, ...multiDefectCases(cases), ...conformantBehaviourCases(cases)],
));

function structuralTextParts(/** @type {any} */ capture) {
  return [
    ...(capture.structure?.headings || []),
    ...(capture.structure?.landmarks || []),
    ...(capture.structure?.formFields || []),
    ...(capture.structure?.tableCells || []),
  ];
}

function interactionTextParts(/** @type {any} */ capture) {
  return [
    ...(capture.interaction?.controls || []),
    ...(capture.interaction?.stateChanges || []).flatMap((/** @type {any} */ { control, after }) => [control, after]),
    ...(capture.interaction?.formChanges || []).flatMap((/** @type {any} */ { control, after }) => [control, after]),
    ...(capture.interaction?.postSubmitFields || []),
  ];
}

function captureTextParts(/** @type {any} */ capture) {
  return [
    ...(capture.transcript || []),
    ...structuralTextParts(capture),
    ...interactionTextParts(capture),
  ];
}

function flattenCapture(/** @type {any} */ capture) {
  return captureTextParts(capture).filter((value) => typeof value === "string").join("\n");
}

function regexMatches(/** @type {any} */ capture, /** @type {any} */ signal) {
  return new RegExp(signal.pattern, signal.flags || "i").test(flattenCapture(capture));
}

function structureIsEmpty(/** @type {any} */ capture, /** @type {any} */ signal) {
  return (capture.structure?.[signal.field] || []).length === 0;
}

function headingIsMissing(/** @type {any} */ capture, /** @type {any} */ signal) {
  return !(capture.structure?.headings || []).some((/** @type {any} */ heading) => heading.toLowerCase().includes(signal.text.toLowerCase()));
}

function hasMissingRole(/** @type {any} */ capture, /** @type {any} */ signal) {
  const values = [
    ...(capture.transcript || []),
    ...(capture.structure?.formFields || []),
    ...(capture.interaction?.controls || []),
  ];
  return values.some((value) => value.toLowerCase().includes(signal.text.toLowerCase())
    && !/button|link|checkbox|radio|menu|switch|heading/i.test(value));
}

const STATE_WORD = /\b(expanded|collapsed|open|closed|pressed|checked)\b/i;

const stateWordOf = (/** @type {any} */ text) => (text.match(STATE_WORD)?.[1] ?? "").toLowerCase();

// The disclosure failure is "operating the control did not change the announced state".
//
// This used to test whether the announcement was EMPTY, which was right when the probe
// listened for a spontaneous announcement. The probe now re-reads the control after
// activating it, so `after` always carries a state word and the emptiness test could never
// fire again -- it silently stopped discriminating and took three cases with it. A probe and
// its signal are coupled; changing one means revisiting the other.
function stateChangeIsSilent(/** @type {any} */ capture, /** @type {any} */ signal) {
  const changes = capture.interaction?.stateChanges || [];
  return changes.some((/** @type {any} */ { control, after }) => {
    if (!control.toLowerCase().includes(signal.control.toLowerCase())) return false;
    const before = stateWordOf(control);
    const now = stateWordOf(after);
    // No state word at all is still a failure: nothing was conveyed either way.
    return now === "" || now === before;
  });
}

// Two failures that both involve activating a control, but whose evidence lives in
// different channels. Conflating them cost three cases: a single matcher tuned for one
// reported the other's GOOD page as failing.
//
// (a) 4.1.3 Status Messages -- a filter updates results and says nothing. The status IS the
// announcement, so it lands in `formChanges.after`: the good page carries "Showing 2 bags.",
/**
 * States NVDA speaks for a control that TOGGLES — the control's own answer, not the page's.
 *
 * A button announces nothing of its own, so an empty delta means the page said nothing. A checkbox always
 * says "checked", so on a page with no live region the delta reads `"checked"` — not empty — and a silence
 * test written for buttons cannot fire. `filter-status-silent-checkbox` was withdrawn BLIND for exactly
 * that, and the withdrawal blamed the live region when the fault was here.
 *
 * Measured 2026-09-01, the two variants differing only in the region:
 *
 *     good  {kind: "toggle", after: "Showing 2 bags."}    <- the page answered
 *     bad   {kind: "toggle", after: "checked"}            <- only the control did
 *
 * The typing probe's echo problem one control along, and the same remedy: separate what the SCREEN READER
 * said about the control from what the PAGE said, then ask the question of the remainder.
 */
const TOGGLE_OWN_STATE = /^(?:not\s+)?(?:checked|pressed|selected|expanded|collapsed)$/i;

/**
 * What the PAGE announced, with the control's own state removed.
 *
 * Only for `kind: "toggle"`, deliberately. A button's delta is the page's answer entire, and stripping a
 * state word there would silence a real announcement that happened to be one word long.
 *
 * @param {{kind?: string, after?: string}} change
 */
function pageResponseTo(change) {
  const after = String(change.after ?? "");
  if (change.kind !== "toggle") return after;
  return after.split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !TOGGLE_OWN_STATE.test(part))
    .join(" | ");
}

/**
 * A LINK's own state, which NVDA announces on activation and which says nothing about the page's response.
 *
 * `probeRouteChange`'s own comment records why this has to be stripped rather than counted: the stale-title
 * page announced `"visited"`, so *"was anything announced?"* is not on its own the question. That is the
 * same reasoning `TOGGLE_OWN_STATE` applies to a checkbox, in a second alphabet.
 *
 * It does not fire on the corpus -- `activateAndCaptureDelta` subtracts the baseline, and a link's state is
 * already in it, so the corpus pair reads `""` outright. It is here for REAL pages, where a link that
 * changes to `visited` on click puts exactly that word in the delta, and it is unit-tested directly for
 * that reason: a guard nothing exercises is a guard nobody has seen fail.
 */
const LINK_OWN_STATE = /^(?:visited|link|same page|internal link|clickable)$/i;

/**
 * (4.1.3) A link filters the page and the new state is never announced.
 *
 * The evidence is `routeChange.announced` -- what NVDA said after a press this tool ALREADY performs.
 * `probeNavigation` is opt-in and sanctioned; recording what that press produced needs no new consent.
 *
 * Every early return is `false`, and that is the point rather than an oversight: "the probe did not run",
 * "there was no link", "the measurement errored" and "the page answered nothing" are four different states,
 * and only the last is the finding. Reading the first three as silence is the defect that put
 * `postSubmitFields: []` on 2,122 captures and read 604 logged crashes as pages with nothing to say.
 *
 * @param {any} routeChange
 */
export function linkStatusIsSilent(routeChange) {
  if (!routeChange) return false;                       // probeNavigation never ran
  if (routeChange.error) return false;                  // a failed measurement is not a silent page
  if (!routeChange.control) return false;               // no link on the page to press
  if (typeof routeChange.announced !== "string") return false;  // `null` is the error sentinel
  return String(routeChange.announced)
    .split("|")
    .map((/** @type {string} */ part) => part.trim())
    .filter((/** @type {string} */ part) => part !== "" && !LINK_OWN_STATE.test(part))
    .join(" | ") === "";
}

// the bad page carries "".
function formActivationIsSilent(/** @type {any} */ capture, /** @type {any} */ signal) {
  const changes = capture.interaction?.formChanges || [];
  const target = changes.filter((/** @type {any} */ { control }) => control.toLowerCase().includes(signal.control.toLowerCase()));
  if (signal.expected) return target.length === 0 || target.every((/** @type {any} */ { after }) => !after.includes(signal.expected));
  return target.length === 0
    || target.every((/** @type {any} */ change) => pageResponseTo(change).trim() === "");
}

/**
 * A remedy is a FORMAT or an ACTION -- what to type, or what to do about it.
 *
 * Kept deliberately narrow and structural rather than a vocabulary of "good words". The corpus's remedies
 * name a format ("as DD/MM/YYYY"), give an example, or issue an instruction ("enter", "use", "choose"),
 * and its problem-only messages assert a state ("Invalid entry", "This value is not accepted"). Matching
 * the INSTRUCTION rather than the sentiment is what keeps this from being the `vague_link_present`
 * shortcut in a new costume -- that feature was removed for answering a different criterion's question
 * with a wordlist, and it took 2.4.4 from 27 false positives to 0.
 */
// PUNCTUATION DOES NOT SURVIVE SPEECH, so no alternative here may depend on it. NVDA announces "e.g."
// as "e dot g." and "DD/MM/YYYY" as "DD slash MM slash YYYY" -- measured, not assumed. The first version
// carried `e\.g\.` and `dd\/mm`, and neither could EVER match an announcement: patterns that look like
// coverage and match nothing. `gate:stability`'s corpus caught it as a CONTAMINATED case, because the
// good page's remedy went unrecognised and the signal then fired on both variants.
//
// The deeper mistake was in the CHECK, not the regex. I validated all 32 messages offline against the
// SOURCE strings and they passed -- but the predicate reads what NVDA SAID. A check run against a shape
// you did not verify is this repo's oldest recurring defect, and it passed here having examined the
// wrong text entirely.
const REMEDY_PHRASE =
  /\b(?:enter|use|choose|select|pick|include|must (?:be|start|contain)|for example|such as|format|as dd|at least|between \d)/i;

/**
 * (3.3.3) The error WAS announced and named only the problem.
 *
 * Requires the announcement to have happened: a page that says nothing is a 3.3.1 failure, not this one,
 * and reading silence as "no remedy" would make every 3.3.1 positive a 3.3.3 positive too. That is the
 * same single-criterion discipline `errorVariant`'s comment records paying for once already.
 */
function errorRemedyIsMissing(/** @type {any} */ capture, /** @type {any} */ signal) {
  const announced = announcedErrorText(capture, signal);
  if (announced === null) return false;   // nothing was announced -- 3.3.1's finding, not ours
  return !REMEDY_PHRASE.test(announced);
}

/**
 * What the screen reader actually said about the error, or `null` if it said nothing.
 *
 * Reads BOTH channels for the reason `validationErrorIsSilent` documents: NVDA versions place the durable
 * invalid-field announcement in either the post-submit structural sweep or the activation delta.
 */
function announcedErrorText(/** @type {any} */ capture, /** @type {any} */ signal) {
  const interaction = capture.interaction || {};
  const submitted = (interaction.formChanges || [])
    .filter((/** @type {any} */ { control }) =>
      String(control).toLowerCase().includes(String(signal.control).toLowerCase()));
  if (submitted.length === 0) return null;   // the submit never happened -- we could not ask
  const spoken = [
    ...submitted.map((/** @type {any} */ change) => String(change.after ?? "")),
    ...(interaction.postSubmitFields || []).map((/** @type {any} */ value) => String(value)),
  ].filter((/** @type {string} */ text) => ANNOUNCED_ERROR.test(text));
  return spoken.length ? spoken.join(" | ") : null;
}

/**
 * (3.2.1 / 3.2.2) The page's TITLE changed from focusing a control, or from typing into one.
 *
 * One predicate for both criteria because the evidence is the same shape and only the CHANNEL differs —
 * 3.2.2 is 3.2.1 "on change rather than focus", which is `criterion-coverage.ts`'s own wording.
 *
 * Every early return is `false`, and that is the design rather than an oversight: "the probe never ran",
 * "nothing was focusable", "the measurement errored" and "the title did not change" are four states, and
 * only the last is conformant while only a real CHANGE is the finding. The probes return `null` titles
 * rather than `""` for exactly this — an empty title compares equal to another empty title, which would
 * read as "context did not change" on a capture where nothing was asked.
 *
 * @param {any} channel
 */
export function contextChangedOn(channel) {
  if (!channel) return false;                                   // the probe was not asked for
  if (channel.error) return false;                              // a failed measurement is not a stable page
  if (typeof channel.titleBefore !== "string") return false;    // null sentinel: nothing was focused/typed
  if (typeof channel.titleAfter !== "string") return false;
  return channel.titleBefore !== channel.titleAfter;
}

// An announced validation error leaves a durable trace on the field: NVDA reports
// "invalid entry" for aria-invalid, plus the message via the field's description.
const ANNOUNCED_ERROR = /invalid|\berror\b/i;

// (b) 3.3.1 Error Identification -- submitting bad input announces no error. Here
// `formChanges.after` is useless: it records the focus move after submit and reads
// "Newsletter signup, document" on BOTH pages. The evidence is in `postSubmitFields`, the
// deliberate re-read of durable field state -- persistent state over transient speech, which
// is the lesson the NVDA correctness audit already drew (its Root 2).
function validationErrorIsSilent(/** @type {any} */ capture, /** @type {any} */ signal) {
  const changes = capture.interaction?.formChanges || [];
  const submitted = changes.some((/** @type {any} */ { control }) => control.toLowerCase().includes(signal.control.toLowerCase()));
  if (!submitted) return true; // the submit never happened, so nothing could be announced
  // NVDA versions place the durable invalid-field announcement in either the post-submit
  // structural sweep or the activation change's `after` value. Both are screen-reader
  // evidence; relying on only one made a correctly announced error look silent.
  const announcedEvidence = [
    ...(capture.interaction?.postSubmitFields || []),
    ...changes.map((/** @type {any} */ { after }) => after),
  ];
  return !announcedEvidence.some((field) => ANNOUNCED_ERROR.test(field));
}

// A data cell in a properly-marked-up table is announced with its header
// ("Departs, column 2, 09:15"); without header association NVDA can only announce the
// position ("column 2, 09:15"). Read the dedicated table-cell probe only: the normal transcript
// is not a stable cell boundary and cell counts are not evidence of header relationships.
const POSITION_ONLY_CELL = /^column\s+\d+\b/i;

function tableHeadersAreUnassociated(/** @type {any} */ capture) {
  if ((capture.structure?.tableCells || []).some((/** @type {any} */ cell) =>
    typeof cell === "string" && POSITION_ONLY_CELL.test(cell.trim()))) return true;

  // Some NVDA table probes return only the table summary in `tableCells`, while the
  // ordered transcript still contains the decisive cell announcements. Once a data row
  // starts, a line that begins with only "column N, value" proves that the header name
  // was not carried into that cell. Header-row lines are intentionally ignored.
  let inDataRow = false;
  for (const line of capture.transcript || []) {
    const text = typeof line === "string" ? line.trim() : "";
    if (/^row\s+[2-9]\d*\b/i.test(text)) {
      inDataRow = true;
      continue;
    }
    if (inDataRow && POSITION_ONLY_CELL.test(text)) return true;
  }
  return false;
}

/**
 * 3.3.2 — a field whose only label is its placeholder, announced as the placeholder text and nothing else.
 *
 * The guard used to be `if (formFields.length > 0) return false` — "the form sweep found a named field
 * anywhere on this page, so this is not the placeholder case". That is the ADR 0015 defect in the SIGNAL
 * layer: it reasons about the page when the evidence is about one field, so a page with a properly
 * labelled field AND a placeholder-only one reports nothing. Every real page has at least one labelled
 * field, and it made the corpus structurally unable to contain a page with both — which is exactly the
 * separation that taught the heads to veto.
 *
 * It now asks the narrower question the criterion asks: **is the placeholder text itself standing in for a
 * name?** Measured on the corpus captures, the bad variant announces `"form, Example value, edit"` with
 * `formFields: []`, and the good variant announces `"Booking reference, edit, Example value"` — so the
 * discriminator is whether the placeholder arrives with a real name in front of it, not whether any other
 * field on the page has one.
 */
function placeholderOnlyIsPresent(/** @type {any} */ capture, /** @type {any} */ signal) {
  const placeholder = String(signal.placeholder || "").toLowerCase();
  if (!placeholder) return false;
  // A NAMED field carrying the placeholder as its value ("Booking reference, edit, Example value") is the
  // conformant announcement, so it must not satisfy this. Only a field whose announcement STARTS with the
  // placeholder — nothing said before it — is the failure.
  return captureTextParts(capture).some((value) => {
    const text = value.toLowerCase().replace(/^form,\s*/, "").trim();
    return text.startsWith(placeholder) && /\bedit(?: text)?\b/i.test(text);
  });
}

// A form field NVDA announces as a bare role, with no name in front of it: "edit" rather
// than "Recipient name, edit".
//
// This replaces a transcript regex for a trailing "edit", which fired on the GOOD page too
// and so discriminated nothing -- NVDA announces a correctly labelled field across two
// lines, the label then the role, leaving a line that is only "edit". The structural
// form-field sweep does not have that ambiguity: the name and role arrive together.
// Same rule as the 4.1.2 check in src/spike/rules.ts.
const LEADING_ROLE = /^(?:\ufffc\s*,\s*)?(edit(\s+text)?|button|checkbox|radio|combo\s*box|list\s*box|slider|spin\s*button)\b/i;

function hasUnnamedFormField(/** @type {any} */ capture) {
  return (capture.structure?.formFields || []).some((/** @type {any} */ field) => LEADING_ROLE.test(field.trim()));
}

/**
 * 2.1.2 — Tab stopped moving, read from the PROBE's own observation rather than re-derived.
 *
 * `probeFocusOrder` records `stalled: true` in its `focusOrder` diagnostic when it saw the same control
 * `TRAP_REPEATS` times running and gave up. That is the capture saying "Tab stopped moving" in its own
 * words, and its comment is explicit that deciding WHY is the judge's business, not the probe's.
 *
 * Deliberately a DIFFERENT signal from the one `addKeyboardTrap` reasons over. The rule reads the stop list
 * — trailing repeats, corroborated against how many controls the form-field sweep found — and if this signal
 * duplicated that logic then `rules:gate` would be comparing the rule against a copy of itself and calling
 * the agreement validation. Two independent expressions of the same claim is the whole point of having a
 * labelled corpus.
 *
 * Absent diagnostics mean the probe did not run, which is NOT a trap. `probeFocus` is opt-in per case, so a
 * case that forgets it would otherwise label every capture clean and look like a passing signal.
 */
/**
 * 2.4.2: the route changed and the screen reader never said where you went.
 *
 * TWO signals, both required, for the same reason `addKeyboardTrap` needs two: the view MOVED and the title
 * did NOT. A title that stays put is unremarkable if nothing navigated — and this probe activates the first
 * link on the page, which on a real site may be a skip link or a plain fragment jump.
 *
 * **The obvious second signal — "was anything announced?" — is wrong, and the first capture proved it.**
 * The failing page announced `"visited"`: NVDA reporting the link's own state. Not silence, and it names
 * nothing about where the user now is, so a rule keyed on silence would never fire on the page it was
 * written for. The measurable difference is that the view moved and the title did not follow.
 *
 * An unprobed or errored capture is NOT a finding. `routeChange` is absent unless asked for and carries an
 * `error` when the measurement failed, and both are distinguishable from a page that navigated silently.
 */
function routeTitleIsStale(/** @type {any} */ capture) {
  const route = (capture.interaction || {}).routeChange;
  if (!route || route.error || !route.navigated) return false;
  const viewMoved = route.headingBefore !== route.headingAfter;
  return viewMoved && route.titleBefore === route.titleAfter;
}

/**
 * 2.4.3: Tab visits the controls in a different order from the one the page reads in.
 *
 * Both sequences are already captured and neither is an inference: `structure.formFields` is what a screen
 * reader reads walking the page, `interaction.focusOrder` is what Tab visits. Compared on accessible NAME,
 * because the same control is announced differently by the two paths — the sweep says "Postcode, edit" and
 * focus says "Postcode, edit, focused, blank".
 *
 * Restricted to the controls present in BOTH. `focusOrder` also contains links and anything else focusable,
 * and the form-field sweep contains controls Tab may never reach; neither absence is a 2.4.3 failure, and
 * treating it as one would fire on every page with a nav bar.
 */
/**
 * 2.4.1: the skip link was activated and focus did not move past the block.
 *
 * "Did not move" is measured against what the SECOND item in the ordinary tab order would have been — i.e.
 * the next Tab landed exactly where it would have landed without ever touching the skip link. That is a
 * stronger statement than "focus is still near the top", and it needs no knowledge of where the block ends.
 *
 * Requires the control activated to actually BE a skip link, by its announced name. The probe activates the
 * first link on the page, which on some pages is a logo or a cookie banner; activating one of those and
 * finding focus unmoved says nothing about bypassing blocks.
 */
/**
 * 2.1.1: a control the page announces as operable that Tab never reaches.
 *
 * POSITIONAL, because the focus probe truncates. Measured: every corpus page stops at 12 tab stops, so
 * "absent from `focusOrder`" on its own usually means the probe stopped rather than that the control is
 * unreachable. A control is only unreachable if it is missing from the tab order while a control that comes
 * LATER in reading order was reached — the probe demonstrably got past it and never landed on it.
 */
/**
 * Names identifying exactly ONE control. Mirrors `unambiguous` in `rules.ts` — two controls can announce
 * identically ("Toggle" twice on MDN), and a name-based comparison then invents a reordering.
 */
function unambiguousNames(/** @type {any} */ names) {
  return new Set(names.filter((/** @type {any} */ name) => names.indexOf(name) === names.lastIndexOf(name)));
}

function controlUnreachableByKeyboard(/** @type {any} */ capture) {
  const reading = namesOf(capture.structure?.formFields);
  const tabbed = new Set(namesOf(capture.interaction?.focusOrder));
  if (reading.length < 2 || tabbed.size === 0) return false;
  // The WHOLE tab cycle, or no claim — mirrors `cycleClosed` in rules.ts. Tab wraps to the first control,
  // so a recording that revisits its start has seen every focusable; without that, the probe's fixed stop
  // cap is indistinguishable from the page trapping the keyboard.
  const tabList = namesOf(capture.interaction?.focusOrder);
  if (!(tabList.length > 1 && tabList.lastIndexOf(tabList[0]) > 0)) return false;
  const trackable = unambiguousNames(reading);
  return reading.some((/** @type {any} */ name) => trackable.has(name) && !tabbed.has(name));
}

function skipLinkIsInert(/** @type {any} */ capture) {
  const route = (capture.interaction || {}).routeChange;
  if (!route || route.error || !route.navigated) return false;
  if (!/\b(skip|jump)\b/i.test(String(route.control ?? ""))) return false;
  const landed = route.nextFocusAfter;
  if (typeof landed !== "string" || !landed) return false; // not measured, or silent — no claim
  // THE FIRST TWO ordinary stops, not just the second. Index 1 is "the link changed nothing"; index 0 is
  // "the link put you back before you started", which is strictly worse and was uncovered until
  // 2026-08-28. `skip-link-target-hidden` lands on index 0 — the skip link itself — because its target is
  // in neither the rendering nor the accessibility tree, so focus resets to the top of the document.
  //
  // Kept identical to `addInertSkipLink` in `rules.ts`, and pinned by `skip-link.corpus.test.ts`: a corpus
  // labelled by one predicate while users are told by another is the defect that pin exists for.
  const ordinary = namesOf(capture.interaction?.focusOrder).slice(0, 2);
  if (ordinary.length < 2) return false;
  return ordinary.includes(namesOf([landed])[0]);
}

function focusOrderIsScrambled(/** @type {any} */ capture) {
  const readingOrder = namesOf(capture.structure?.formFields);
  const tabOrder = firstVisitEach(namesOf(capture.interaction?.focusOrder));
  if (readingOrder.length < 2 || tabOrder.length < 2) return false;
  const readingOnce = unambiguousNames(readingOrder), tabOnce = unambiguousNames(tabOrder);
  const shared = new Set([...readingOnce].filter((name) => tabOnce.has(name)));
  if (shared.size < 2) return false;
  const reading = readingOrder.filter((/** @type {any} */ name) => shared.has(name));
  const tabbed = tabOrder.filter((/** @type {any} */ name) => shared.has(name));
  return reading.join("|") !== tabbed.join("|");
}

/**
 * The accessible name, with container, role and state words stripped, so the two channels are comparable.
 *
 * **It used to exist TWICE** — here for the dataset signals and as `comparableNames` in `rules.ts` for the
 * findings — on the stated grounds that "the corpus generator runs under plain node and cannot import
 * TypeScript". That premise was false by 2026-08-24: five `.mjs` files in this package already import
 * `@a11y-witness/evidence`, `repeat-capture.mjs` among them, in this very directory.
 *
 * The duplication cost what duplication costs. The two drifted within an hour of being written, which
 * `check-signals` caught as a CONTAMINATED 2.1.1 case. `name-normalisation.test.ts` then pinned them
 * equal — and pinned them on CORPUS announcements, where a container is one comma group. Real sites name
 * their landmarks, which NVDA announces as two (`"Main navigation, navigation landmark"`), and neither
 * copy handled that or knew `frame` or `grouping`. The rule reduced
 * `"banner landmark, Main navigation, navigation landmark, list, with 6 items, About us, button"` to
 * `"main navigation navigation with 6 items about us"`, matched it against nothing in the tab order, and
 * reported a keyboard-unreachable control on 23 of 35 CONFORMANT real pages.
 *
 * So the copy is gone rather than corrected a fifth time. `parseAnnouncement` is channel-aware and
 * validated on 6,555 cross-channel comparisons at 0.08% disagreement; the test above still pins the two
 * call sites equal, and now does it on real-page shapes too.
 */
export function namesOf(/** @type {any} */ entries) {
  return (entries || [])
    .map((/** @type {any} */ entry) => parseAnnouncement(String(entry), "sweep").objects[0]?.name ?? "")
    .map((/** @type {any} */ name) => name.replace(/[\s,]+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Each control's FIRST visit, in order. The tab order is a CYCLE — past the last control Tab wraps to the
 * first — so a faithful recording ends by repeating something it began with, and comparing that raw made
 * the CONFORMANT variant differ from itself. Measured: five fields, six links, then "Full name" again.
 */
function firstVisitEach(/** @type {any} */ names) {
  const seen = new Set();
  return names.filter((/** @type {any} */ name) => (seen.has(name) ? false : (seen.add(name), true)));
}

/**
 * Does this capture show focus TRAPPED — by either shape the probe can express?
 *
 * 1. STALLED: the last control repeats consecutively, which is Tab not moving at all.
 * 2. A CLOSED CYCLE over a strict SUBSET of the page's controls, which is the modal trap.
 *
 * The second was a declared blind spot until 2026-08-28, and `keyboard-trap-blur-revalidate`'s comment
 * records why: its first version used the canonical modal shape and the probe could not see it, because
 * "a guard that cycles focus among several fields moves focus every press, so it reads as `cycled`,
 * which is exactly what a conformant page's tab order does when it wraps".
 *
 * That is true of the CYCLE and not of its CONTENTS. A conformant wrap visits everything the page has;
 * a modal cycle visits what the dialog has. Measured on `keyboard-trap-modal-cycle`: the trapped variant
 * closes over 3 distinct stops against 5 form fields, the conformant one over 14. The evidence was in
 * every capture already taken — no probe change, no recapture.
 *
 * DECIDED FROM THE STOPS ALONE, not from the probe's `cycled`/`truncated` mark, and that is deliberate:
 * the RULE in `rules.ts` reads `input.interaction.focusOrder` and has no diagnostics, so a formulation
 * needing the mark could not be the same decision in both places. This repo pays more for one fact
 * stated two ways than for a slightly indirect test.
 *
 * A truncated probe cannot produce a false fire here for the same reason: truncation cuts the walk short,
 * and a walk cut short before it wrapped has no repeat at all. A repeat means the cycle CLOSED.
 *
 * COUNTS, never names. Comparing a focus stop ("Postcode, edit, focused, blank") against a swept field
 * ("Postcode, edit") would need name normalisation, which already exists in two places pinned equal by a
 * test; a third copy is how those come apart.
 *
 * @param {string[]} stops        `interaction.focusOrder`
 * @param {string[]} formFields   `structure.formFields` — the ANNOUNCEMENTS, not a count, because the
 *                                corroboration is which of them the ring never reached
 */
/**
 * Did the capture OBSERVE Escape leaving the dialog? The twin of `escapeReleasedFocus` in `rules.ts`.
 *
 * Two copies because this file runs under plain `node` and cannot import TypeScript -- the same constraint
 * `namesOf`/`comparableNames` has -- so the remedy is the documented one: pin them equal with a test.
 * `focus-trap-parity.corpus.test.ts` compares the whole decision on every capture on disk, and
 * `escape-parity.test.ts` compares these two directly on the cases the corpus does not happen to contain.
 *
 * A release is EITHER an announcement or focus moving elsewhere, never both: NVDA re-announces the same
 * control differently depending on how the caret reached it, so requiring both would make this deaf. The
 * asymmetry matches which error costs more -- this SILENCES an accusation, and 2.1.2 is non-interference.
 */
export function escapeReleasedFocusIn(/** @type {any} */ dialogEscape) {
  if (!dialogEscape || typeof dialogEscape !== "object") return false;
  if (String(dialogEscape.announced ?? "").trim() !== "") return true;
  const settle = (/** @type {unknown} */ v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const before = settle(dialogEscape.focusBefore);
  const after = settle(dialogEscape.focusAfter);
  if (before === "" || after === "") return false;
  return after !== before && !after.startsWith(before);
}

/**
 * @param {string[]} stops        `interaction.focusOrder`
 * @param {string[]} formFields   `structure.formFields`, as announcements
 * @param {any} [dialogEscape]    `interaction.dialogEscape`; ABSENT means the probe never ran, which is
 *                                not evidence of a trap and not evidence against one
 */
export function focusIsTrappedIn(stops, formFields, dialogEscape) {
  if (!Array.isArray(stops) || stops.length < 3) return false;
  // AN OBSERVED ESCAPE SILENCES THIS, on both paths below. `rules.ts`'s twin carries the measurement that
  // required it: the claim that `anchorToTop`'s Escape already tests this is false, because that press
  // happens in browse mode with focus on the body and a real dialog scopes its handler to itself.
  if (escapeReleasedFocusIn(dialogEscape)) return false;
  // THE CORROBORATION: announced controls the ring never reached. Empty means focus covered everything
  // the page announced, which is a short document rather than a trap -- and it is why a conformant wrap,
  // which visits every control, never fires.
  const unreached = announcedControlsTheRingNeverReached(stops, formFields);
  if (unreached.length === 0) return false;
  const reached = new Set(stops).size;
  let trailing = 0;
  for (let i = stops.length - 1; i >= 0 && stops[i] === stops[stops.length - 1]; i -= 1) trailing += 1;
  // STALLED, AND WITH NO WAY OUT. The second half was missing, and `rules.ts` had the same gap: a stall
  // inside a cookie banner whose ring holds "Accept all cookies" is not a trap, because focus CAN be moved
  // away. Measured on nrscotland.gov.uk, a page its publisher declares conformant.
  if (trailing >= 2 && ringOffersNoWayOut(stops)) return true;
  // A closed cycle over a ring smaller than the page, AND nothing in the ring that can be activated.
  //
  // The last clause is the whole rule. Three earlier versions asked how MUCH of the page the ring covers
  // and each was exact here and wrong on the web — size is exactly what a consent banner also differs by,
  // so a rule fitted to it learns "is there a modal". Measured on the pages that refuted them: tfl ring 5
  // reads link, link, button, button, button ("Accept all cookies"); networkrail ring 4 reads link,
  // button, button, button; the corpus trap reads edit, edit, edit. Every banner offers a way out.
  //
  // `tabRingCoverage` in `rules.ts` is the twin, and `focus-trap-parity.corpus.test.ts` pins them equal.
  return reached < stops.length && ringOffersNoWayOut(stops);
}

/**
 * Roles whose activation is a keyboard means of LEAVING. Broad on purpose: every role here makes the
 * signal quieter, and 2.1.2 is non-interference — a wrong one says the page is unusable outright.
 *
 * A ROLE test, never the words, so it cannot become the 2.4.4 wordlist shortcut and behaves the same on a
 * banner in any language.
 */
const OFFERS_A_WAY_OUT = /\b(button|link|tab|menu item)\b/;

/** @param {string[]} stops */
function ringOffersNoWayOut(stops) {
  return stops.every((stop) => parseAnnouncement(stop, "sweep").objects
    .every((object) => !OFFERS_A_WAY_OUT.test(object.role)));
}

/**
 * WHICH announced controls the tab ring never reached. The mirror of `tabRingCoverage` in `rules.ts`, and
 * the two are pinned equal by `focus-trap-parity.corpus.test.ts` because they decide the same question in
 * two languages.
 *
 * @param {string[]} stops       `interaction.focusOrder`
 * @param {string[]} formFields  `structure.formFields`
 * @returns {string[]} the announced control names focus never visited — empty means the ring covered them
 */
function announcedControlsTheRingNeverReached(stops, formFields) {
  // A SET DIFFERENCE, NOT A COUNT — and the difference is the whole defect this replaced.
  //
  // This was `reached < onPage`: the number of distinct tab stops against the number of swept form
  // fields. That assumes the ring is a SUBSET of the announced controls, and for a MODAL it is disjoint
  // from them BY CONSTRUCTION — the dialog hides the page, so the sweep announces what is behind it and
  // Tab visits what is inside it. Two different sets, compared by size.
  //
  // Measured on `keyboard-trap-modal-cycle`, which went BLIND on two of its three variants:
  //
  //     swept  (onPage 4):  Full name, Email, Phone, Delivery notes    <- outside the dialog
  //     ring   (reached 4): House number, Street, Town, County         <- inside it
  //
  // `4 < 4` is false, so the trap was invisible. The one variant that DID discriminate only did so
  // because its furniture happened to add a fifth swept field -- the signal was returning the right
  // answer for a reason unrelated to the page. That is the same shape as `channelRelation.disjoint`:
  // two channels describing different things, compared as though they described one.
  //
  // Named, not counted, so the report can say WHICH controls a keyboard user cannot reach. "Four
  // unreached" and "Full name, Email, Phone, Delivery notes unreached" are different claims, and only the
  // second can be checked by a human against the page.
  const reached = new Set(namesOf(stops));
  return namesOf(formFields).filter((/** @type {string} */ name) => !reached.has(name));
}

/**
 * Characters were typed into a field and NOTHING was announced — live validation nobody can hear.
 *
 * Reads `interaction.typedFeedback`, which exists only when `probeTyping` AND `probeFocus` both ran: a
 * sweep is browse mode, where letters are quick-navigation COMMANDS rather than input, and typing there
 * is the 353-capture contamination this repo has already paid for once.
 *
 * `echoed` is separated from `announced` and that separation is the whole predicate. NVDA echoes typed
 * characters back by default, so a page that says nothing still produces speech — and counting the echo as
 * feedback would make every page pass. What is asked is whether anything was said BEYOND the echo.
 *
 * `null` makes no claim. A capture that never typed cannot say whether the page responds to typing.
 */
export function typedFeedbackIsSilent(/** @type {any} */ typedFeedback) {
  if (!typedFeedback || typeof typedFeedback !== "object") return false;
  // The probe must have been able to type at all. `typed: false` means focus was not in an editable
  // control, which is a fact about where the focus probe finished and not about the page.
  if (typedFeedback.typed !== true) return false;
  return String(typedFeedback.announced ?? "").trim() === "";
}

/**
 * Arrows were pressed inside a group and NOTHING moved — the evidence 2.1.1 abstains without.
 *
 * Reads `interaction.arrowNavigation`, which exists only when `probeArrows` AND `probeFocus` both ran:
 * arrows in BROWSE mode navigate the document, not the widget, so a reading taken without DOM focus inside
 * the group is a measurement of the page. That is the same precondition the dialog probe needed, and the
 * same one it cost three captures to discover.
 *
 * `SHARES_ONE_TAB_STOP` exists because a capture could not tell *reachable by arrows* from *unreachable*:
 * a native radio group and a broken one both present ONE tab stop, so the tab ring cannot separate them.
 * This is the observation that can — press the arrow and see whether the screen reader says anything new.
 *
 * A MOVE IS EITHER AN ANNOUNCEMENT OR A CHANGED FOCUS, never both required. NVDA re-announces the same
 * option differently depending on how the caret arrived, so demanding both would call a working group
 * broken. The asymmetry is deliberate and matches which error costs more: this ACCUSES, so it must be hard
 * to satisfy -- it fires only when the page said nothing AND focus did not move.
 *
 * `null` is not a finding. A capture that never pressed an arrow cannot say whether one works, and reading
 * that absence as inert is this corpus's oldest defect wearing a new criterion.
 */
export function arrowKeysAreInert(/** @type {any} */ arrowNavigation) {
  if (!arrowNavigation || typeof arrowNavigation !== "object") return false;
  if (String(arrowNavigation.announced ?? "").trim() !== "") return false;
  const settle = (/** @type {unknown} */ v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const before = settle(arrowNavigation.focusBefore);
  const after = settle(arrowNavigation.focusAfter);
  // An unreadable focus on either side means the probe could not observe, which is not evidence of
  // inertness. Same rule as `escapeReleasedFocusIn`, and for the same reason.
  if (before === "" || after === "") return false;
  return after === before || after.startsWith(before);
}

/**
 * Escape was pressed inside a dialog and NOTHING happened — no announcement, and focus did not move.
 *
 * Reads `interaction.dialogEscape`, which only exists when `probeDialog` AND `probeFocus` both ran: Escape
 * from the browse caret measures the document, not a dialog, and the first version of this probe did
 * exactly that on every page.
 *
 * BOTH halves are required and neither alone is sound. Silence on its own is the ambiguity this repo has
 * paid for repeatedly -- a probe that gave up early and a page that said nothing are the same observation.
 * Focus alone is not enough either: NVDA re-announces the SAME control differently depending on how the
 * caret arrived ("T, o, w, n" then "Town, edit, focused, blank" on one real capture), so raw inequality
 * reads as movement on a page where nothing moved. Requiring silence AND a stationary focus means each
 * covers the other's failure mode.
 *
 * `null` is NOT a finding. A capture that never ran the probe cannot say whether the dialog can be left,
 * and reading that absence as a trap is this corpus's oldest defect wearing a new criterion.
 */
export function escapeDoesNotRelease(/** @type {any} */ dialogEscape) {
  if (!dialogEscape || typeof dialogEscape !== "object") return false;
  const announced = String(dialogEscape.announced ?? "").trim();
  if (announced !== "") return false;
  const settle = (/** @type {unknown} */ v) =>
    String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return settle(dialogEscape.focusBefore) === settle(dialogEscape.focusAfter)
    || settle(dialogEscape.focusAfter).startsWith(settle(dialogEscape.focusBefore));
}

function focusIsTrapped(/** @type {any} */ capture) {
  return focusIsTrappedIn(
    capture.interaction?.focusOrder ?? [],
    capture.structure?.formFields ?? [],
    capture.interaction?.dialogEscape,
  );
}

/**
 * Which predicate decides each signal type — a TABLE rather than a chain of fifteen `if`s.
 *
 * It was the chain, and it grew four entries in a day as criteria were added; ESLint stopped it at a
 * complexity of 16. That limit was doing its job: the branches never interacted, so the chain was a lookup
 * written the long way, and every new criterion made the function measurably harder to read while changing
 * nothing about how it works.
 *
 * A missing type returns false rather than throwing, deliberately. A signal type nobody implements is a
 * case that can never fire, which `check-signals` reports as BLIND with the case named — a better error
 * than a crash inside a corpus run, and one that says which case is affected.
 */
/** @type {Record<string, any>} */
const SIGNAL_PREDICATES = Object.freeze({
  "unnamed-form-field": (/** @type {any} */ capture) => hasUnnamedFormField(capture),
  regex: (/** @type {any} */ capture, /** @type {any} */ signal) => regexMatches(capture, signal),
  "structure-empty": (/** @type {any} */ capture, /** @type {any} */ signal) => structureIsEmpty(capture, signal),
  "missing-heading": (/** @type {any} */ capture, /** @type {any} */ signal) => headingIsMissing(capture, signal),
  "missing-role": (/** @type {any} */ capture, /** @type {any} */ signal) => hasMissingRole(capture, signal),
  "state-change-silent": (/** @type {any} */ capture, /** @type {any} */ signal) => stateChangeIsSilent(capture, signal),
  "form-activation-silent": (/** @type {any} */ capture, /** @type {any} */ signal) => formActivationIsSilent(capture, signal),
  "link-status-silent": (/** @type {any} */ capture) => linkStatusIsSilent(capture.interaction?.routeChange),
  "error-remedy-missing": (/** @type {any} */ capture, /** @type {any} */ signal) =>
    errorRemedyIsMissing(capture, signal),
  "focus-context-change": (/** @type {any} */ capture) =>
    contextChangedOn(capture.interaction?.focusContext),
  "input-context-change": (/** @type {any} */ capture) =>
    contextChangedOn(capture.interaction?.typedFeedback),
  "validation-error-silent": (/** @type {any} */ capture, /** @type {any} */ signal) => validationErrorIsSilent(capture, signal),
  "placeholder-only": (/** @type {any} */ capture, /** @type {any} */ signal) => placeholderOnlyIsPresent(capture, signal),
  "table-unassociated": (/** @type {any} */ capture) => tableHeadersAreUnassociated(capture),
  "focus-trapped": (/** @type {any} */ capture) => focusIsTrapped(capture),
  "escape-does-not-release": (/** @type {any} */ capture) =>
    escapeDoesNotRelease(capture.interaction?.dialogEscape),
  "arrow-keys-inert": (/** @type {any} */ capture) =>
    arrowKeysAreInert(capture.interaction?.arrowNavigation),
  "typed-feedback-silent": (/** @type {any} */ capture) =>
    typedFeedbackIsSilent(capture.interaction?.typedFeedback),
  "route-title-stale": (/** @type {any} */ capture) => routeTitleIsStale(capture),
  "focus-order-scrambled": (/** @type {any} */ capture) => focusOrderIsScrambled(capture),
  "skip-link-inert": (/** @type {any} */ capture) => skipLinkIsInert(capture),
  "control-unreachable-by-keyboard": (/** @type {any} */ capture) => controlUnreachableByKeyboard(capture),
});

/**
 * Every signal type the checker can evaluate — the KEYS, exported as a value.
 *
 * `acceptance-matrix.test.ts` needs this to assert that no case declares a signal nothing implements, and
 * used to obtain it by regex-scraping this file for `type === "..."`. That was the right instinct — its
 * comment says a hand-maintained list "would go stale the first time a signal type is added" — reaching
 * for the only mechanism available at the time. The moment the chain became a table the scrape found
 * nothing, and a test that derives its expectations from source text is one refactor away from asserting
 * over an empty set. The list is now a value, so it cannot be read wrongly.
 */
export const SIGNAL_TYPES = Object.freeze(Object.keys(SIGNAL_PREDICATES));

export function signalMatches(/** @type {any} */ capture, /** @type {any} */ signal) {
  return SIGNAL_PREDICATES[signal?.type]?.(capture, signal) ?? false;
}

// `evidenceUnits` and `captureEvidenceText` MOVED to `@a11y-witness/scorer/evidence-units`.
//
// They define the model's input contract -- which capture field becomes evidence, under which channel name
// -- and the featurizer embeds the channel name as tokens in every feature vector, versioned by
// FEATURE_SCHEMA_VERSION. So the contract has to version with the WEIGHTS, not with this file.
//
// Living here is why it got duplicated: the table sat inside a generator of SYNTHETIC cases, so a consumer
// that needed units for REAL pages wrote its own and the two silently disagreed on seven channel names.
// Re-exported rather than repointed at every call site, because `signalMatches` and `CASES` come from here
// too and one import per consumer is the smaller change.
export { evidenceUnits, captureEvidenceText } from "@a11y-witness/scorer/evidence-units";
