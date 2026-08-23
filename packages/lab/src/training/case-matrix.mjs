/**
 * Controlled page pairs for collecting screen-reader-only evidence.
 *
 * The page is an instrument: it creates a known contrast so the capture
 * pipeline can produce labels without putting HTML, DOM, CSS, or axe results
 * into the model input. The wording is original and the accessibility topics
 * are paraphrased from the repository's bookctx references and existing eval
 * fixtures.
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

const escapeHtml = (value) => String(value)
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
 * - **Headings are safe** — `missing-heading` asserts a NAMED heading is absent, not that none exist, so
 *   distinctly-worded filler cannot satisfy it. Sequence numbers make collision impossible.
 */
function filler(bucket) {
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
function namedField(bucket) {
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
function disclosure(bucket) {
  if (!bucket.disclosure) return "";
  return "<p><button type=\"button\" id=\"ref-notes-toggle\" aria-expanded=\"false\" "
    + "aria-controls=\"ref-notes-panel\" onclick=\"var b=this,p=document.getElementById('ref-notes-panel');"
    + "var open=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',String(!open));"
    + "p.hidden=open;\">Reference notes archive</button></p>"
    + "<div id=\"ref-notes-panel\" hidden><p>Archived reference notes are retained for seven years.</p></div>";
}

function dataTable(bucket) {
  if (!bucket.dataTable) return "";
  // Headers associated by `scope`, so this sets `table_header_associated` and NOT `table_position_only`.
  // The position-only variant is a 1.3.1 FAILURE, so it cannot be furniture — a page that needs it has to
  // fail two criteria at once, which is a case definition rather than a bucket.
  return "<table><caption>Reference notes index</caption>"
    + "<tr><th scope=\"col\">Note</th><th scope=\"col\">Reviewed</th></tr>"
    + "<tr><td>Site safety</td><td>2019</td></tr></table>";
}

function page({ title, heading, body, script = "", landmark = true }) {
  const content = "<h1>" + escapeHtml(heading) + "</h1>" + body;
  const container = landmark ? "<main>" + content + "</main>" : content;
  return "<!doctype html>\n"
    + "<html lang=\"en\">\n"
    + "<head><meta charset=\"utf-8\"><title>" + escapeHtml(title)
    + "</title><style>" + BASE_STYLE + "</style></head>\n"
    + "<body>" + container + "\n"
    + (script ? "<script>" + script + "</script>" : "")
    + "</body></html>";
}

function defaultSubtype({ id, criterion, badSignal }) {
  if (criterion === "1.1.1") {
    if (id.includes("missing")) return "missing-alt";
    if (id.includes("generic")) return "generic-alt";
    if (id.includes("filename")) return "filename-alt";
  }
  if (criterion === "1.3.1") {
    if (badSignal.type === "structure-empty") return "missing-landmark";
    if (badSignal.type === "missing-heading") return "fake-heading";
    if (badSignal.type === "table-unassociated") return "unassociated-table";
  }
  if (criterion === "3.3.2" && id.includes("placeholder")) return "placeholder-only";
  return badSignal.type;
}

function pair({
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
  probeNavigation = false,
  family = id,
  subtype = null,
  // Criteria this case ALSO breaks. `pair` names every field it forwards, so a case declaring
  // `alsoFails` without this line is silently dropped -- which it was, and the count read 0 while
  // three case definitions carried it. A constructor that enumerates its fields must be updated
  // with them.
  alsoFails = [],
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
function spokenForm(text) {
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

function imageVariant({ id, title, heading, description, file, goodAlt, badAlt, task }) {
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

function linkVariant({ id, title, heading, context, vague, descriptive, task }) {
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

function vagueHeadingVariant({ id, title, heading, vague, descriptive, task }) {
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

function fakeHeadingVariant({ id, title, heading, label, task }) {
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

function landmarkVariant({ id, title, heading, label, text, task }) {
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

function unlabelledFieldVariant({ id, title, heading, label, name, task }) {
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

function placeholderOnlyVariant({ id, title, heading, label, name, task }) {
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

function customControlVariant({ id, title, heading, label, task }) {
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

function unnamedIconVariant({ id, title, heading, name, task }) {
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

function disclosureVariant({ id, title, heading, control, content, task }) {
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

function errorVariant({ id, title, heading, field, submit, message, task }) {
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

function statusVariant({ id, title, heading, control, task }) {
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

function tableVariant({ id, title, heading, destination, task }) {
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

function variedTableVariant({ id, title, heading, caption, headers, row, task }) {
  const good = "<table><caption>" + caption + "</caption><thead><tr>"
    + headers.map((header) => "<th scope=\"col\">" + header + "</th>").join("")
    + "</tr></thead><tbody><tr><th scope=\"row\">" + row[0] + "</th>"
    + row.slice(1).map((value) => "<td>" + value + "</td>").join("")
    + "</tr></tbody></table>";
  const bad = "<table><caption>" + caption + "</caption><tr>"
    + headers.map((header) => "<td>" + header + "</td>").join("")
    + "</tr><tr>" + row.map((value) => "<td>" + value + "</td>").join("") + "</tr></table>";
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

function labelledControlVariant({ id, title, heading, label, name, control, selector = "input", task }) {
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
const independent = (testCase) => ({ ...testCase, family: testCase.id });

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
    ["form-error-silent-clinic", "Clinic booking", "Clinic booking", "Patient identifier", "Confirm booking", "Enter the patient identifier before confirming.", "Submit the clinic booking without an identifier."],
  ].map(([id, title, heading, field, submit, message, task]) => independent(errorVariant({ id, title, heading, field, submit, message, task }))),
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

function bulkTopic(index) {
  const code = String(index).padStart(3, "0");
  const place = BULK_TOPICS[(index - 1) % BULK_TOPICS.length];
  const slug = place.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + code;
  return { code, place, slug, label: place + " " + code };
}

function bulkImageCase(index) {
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

function bulkLinkCase(index) {
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

function bulkHeadingCase(index) {
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

function bulkLandmarkCase(index) {
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

function bulkTableCase(index) {
  const topic = bulkTopic(index);
  return independent(tableVariant({
    id: "table-bulk-" + topic.slug,
    title: topic.label + " schedule",
    heading: topic.label + " schedule",
    destination: topic.place,
    task: "Compare the departure time and platform for " + topic.place + ".",
  }));
}

function bulkFieldCase(index) {
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

function bulkCustomControlCase(index) {
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

function bulkDisclosureCase(index) {
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

function bulkErrorCase(index) {
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

function bulkStatusCase(index) {
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
    ["field-followup-date", "Garden booking", "Garden booking", "Visit date", "visit-date", "input", ({ labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the date for the garden visit."],
    ["field-followup-number", "Sports booking", "Sports booking", "Number of visitors", "visitor-count", "input", ({ labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the number of visitors."],
    ["field-followup-email", "Archive contact", "Archive contact", "Contact email", "contact-email", "input", ({ labelled, name }) => `<input type="email" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the archive contact email."],
    ["field-followup-select", "Ferry booking", "Ferry booking", "Passenger type", "passenger-type", "select", ({ labelled, name }) => `<select ${labelled ? `id="${name}"` : ""} name="${name}"><option>Adult</option><option>Child</option></select>`, "Choose the passenger type."],
    ["field-followup-select-route", "Travel booking", "Travel booking", "Route preference", "route", "select", ({ labelled, name }) => `<select ${labelled ? `id="${name}"` : ""} name="${name}"><option>Step-free route</option><option>Fastest route</option></select>`, "Choose a route preference."],
    ["field-followup-textarea", "Volunteer details", "Volunteer details", "Relevant experience", "experience", "textarea", ({ labelled, name }) => `<textarea ${labelled ? `id="${name}"` : ""} name="${name}"></textarea>`, "Describe the relevant experience."],
    ["field-followup-textarea-notes", "Clinic booking", "Clinic booking", "Appointment notes", "notes", "textarea", ({ labelled, name }) => `<textarea ${labelled ? `id="${name}"` : ""} name="${name}"></textarea>`, "Enter appointment notes."],
    ["field-followup-time", "Class booking", "Class booking", "Preferred start time", "start-time", "input", ({ labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Choose the preferred start time."],
    ["field-followup-tel", "Support request", "Support request", "Telephone number", "telephone", "input", ({ labelled, name }) => `<input type="tel" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the telephone number."],
    ["field-followup-search", "Library search", "Library search", "Search phrase", "search-phrase", "input", ({ labelled, name }) => `<input type="search" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter a library search phrase."],
    ["field-followup-text", "Market pitch", "Market pitch", "Trader name", "trader-name", "input", ({ labelled, name }) => `<input type="text" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the trader name."],
    ["field-followup-text-reference", "Housing repair", "Housing repair", "Repair reference", "repair-reference", "input", ({ labelled, name }) => `<input type="text" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the repair reference."],
    ["field-followup-date-departure", "Ferry departure", "Ferry departure", "Departure date", "departure-date", "input", ({ labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the departure date."],
    ["field-followup-select-language", "Museum tour", "Museum tour", "Tour language", "tour-language", "select", ({ labelled, name }) => `<select ${labelled ? `id="${name}"` : ""} name="${name}"><option>English</option><option>Welsh</option></select>`, "Choose the tour language."],
    ["field-followup-textarea-message", "Contact office", "Contact office", "Message", "message", "textarea", ({ labelled, name }) => `<textarea ${labelled ? `id="${name}"` : ""} name="${name}"></textarea>`, "Write a message to the office."],
    ["field-followup-number-group", "Workshop booking", "Workshop booking", "Group size", "group-size", "input", ({ labelled, name }) => `<input type="text" inputmode="numeric" ${labelled ? `id="${name}"` : ""} name="${name}">`, "Enter the workshop group size."],
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

// A single targeted case rather than a family: 2.1.2 needs exactly one pair to become validatable, and
// it is pushed here beside the other explicit pushes rather than buried in a generated block.
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
 * Give every case realistic page furniture, identical in both of its variants.
 *
 * Done HERE rather than inside `page()` deliberately. `page()` sees only a title and a body, and those
 * differ between the good and bad variant — so any size derived from them could differ across a pair and
 * introduce a second difference into a controlled comparison. That is the one defect this corpus cannot
 * carry. Keyed on the case's index instead, the furniture is provably identical for both variants and
 * stable across regenerations.
 *
 * **But the index is the ARRAY POSITION, so INSERTING a case re-sizes the furniture of every case after
 * it** — new page bytes, new `pageHash`, new cache key, and those captures become stale. Measured
 * 2026-08-22: adding `route-title-stale` immediately before `keyboard-trap-postcode` changed exactly one
 * page, and `check-signals` reported `1 stale` and exited 1. One case is cheap; the same insertion into the
 * middle of a generated family would invalidate hundreds, silently, with the only symptom being a stale
 * count nobody was watching for.
 *
 * **So APPEND new cases at the end.** Keying the bucket on a hash of the case ID instead would make
 * insertion free forever, and is the better design — but it re-sizes every page in the corpus once, which
 * is a full recapture. Worth doing bundled with a recapture that is happening anyway, not on its own.
 */
/**
 * Which furniture bucket a case gets — from its ID, never from its position in the array.
 *
 * It was `index % SCALE_BUCKETS.length`, and the comment above records what that cost: inserting a case
 * re-sized the furniture of every case after it, changing their page bytes, their `pageHash` and their
 * cache key, with the only symptom a stale count nobody was watching. The rule that fell out —
 * "APPEND to CASES, never insert" — is a thing a human has to remember, which this repo's own housekeeping
 * rule says does not happen.
 *
 * FNV-1a over the case id instead. A case's furniture now depends on nothing but its own name, so cases can
 * be inserted, reordered or removed and every other case's pages are byte-identical. Changing an id still
 * re-buckets that one case, which is correct: a renamed case is a different case.
 */
function bucketFor(id) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return SCALE_BUCKETS[hash % SCALE_BUCKETS.length];
}

function withRealisticScale(list) {
  return list.map((testCase) => {
    const bucket = bucketFor(testCase.id);
    // A case that drives tables itself never gets the furniture table. Not to avoid a signal collision —
    // the furniture table is conformant, so `tableHeadersAreUnassociated` cannot see it — but because
    // `probeTables` walks the page's tables, and a second one changes what the case's own probe reports.
    // These cases already carry `table_present`, so the correlation this furniture breaks is not theirs.
    const usable = testCase.probeTables ? { ...bucket, dataTable: false } : bucket;
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
    const inject = (html) => html.replace("</body>", extra + "</body>");
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
function FOCUS_ORDER_FORM(mode) {
  const tab = (n) => (mode === " tabindex-trap" ? ` tabindex="${n}"` : "");
  return "<form>"
    + "<label for=\"a\">Full name</label><input id=\"a\" name=\"a\">"
    + "<label for=\"b\">Email</label><input id=\"b\" name=\"b\">"
    + `<label for="c">Postcode</label><input id="c" name="c"${tab(2)}>`
    + `<label for="d">Phone</label><input id="d" name="d"${tab(1)}>`
    + "<label for=\"e\">Notes</label><input id=\"e\" name=\"e\">"
    + "</form>";
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
function SKIP_LINK_PAGE(targetId) {
  return `<a href="#${targetId}">Skip to main content</a>`
    + "<nav><ul>"
    + "<li><a href=\"/news\">News and updates</a></li>"
    + "<li><a href=\"/events\">Events calendar</a></li>"
    + "<li><a href=\"/contact\">Contact the team</a></li>"
    + "</ul></nav>"
    + "<div id=\"content\" tabindex=\"-1\">"
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
function KEYBOARD_ACTION_PAGE(focusable) {
  const tab = focusable ? ' tabindex="0"' : "";
  return `<div role="button"${tab} aria-label="Delete draft" class="card">Delete draft</div>`
    + "<form>"
    + "<label for=\"a\">Full name</label><input id=\"a\" name=\"a\">"
    + "<label for=\"b\">Email</label><input id=\"b\" name=\"b\">"
    + "</form>";
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
    criterion: "2.1.1",
    good: page({ title: "Drafts", heading: "Drafts", body: KEYBOARD_ACTION_PAGE(true) }),
    bad: page({ title: "Drafts", heading: "Drafts", body: KEYBOARD_ACTION_PAGE(false) }),
    badSignal: { type: "control-unreachable-by-keyboard" },
    probeFocus: true,
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
const ACCOMPANYING_DEFECTS = Object.freeze({
  "vague-link": {
    markup: "<p><a href=\"#detail-note\">Read more</a></p>",
    subtypes: ["2.4.4:regex"],
    grants: "vague_link_present",
  },
  "generic-heading": {
    markup: "<h2>Welcome</h2><p>General notes about this service.</p>",
    subtypes: ["2.4.6:regex"],
    grants: "generic_heading_present",
  },
  "unnamed-graphic": {
    markup: "<img src=\"/missing-chart.png\">",
    subtypes: ["1.1.1:missing-alt"],
    grants: "unnamed_graphic_present",
  },
  "position-only-table": {
    // No `scope`, so NVDA announces the data cells by position and never carries the header name into
    // them — `row 2, column 1, ...` rather than `row 2, Note, column 1, ...`. That is the announcement
    // `tableHeadersAreUnassociated` reads, and it is why this cannot be furniture: it is the 1.3.1 failure.
    markup: "<table><caption>Archive index</caption>"
      + "<tr><td>Period</td><td>Held</td></tr><tr><td>2019</td><td>Yes</td></tr></table>",
    subtypes: ["1.3.1:unassociated-table"],
    grants: "table_position_only",
  },
  "bare-edit": {
    // Announced as a bare role with no name. Two heads, for the reason `form-unlabelled` documents at
    // length: an unnamed field is 3.3.2 and 4.1.2 as squarely as each other.
    markup: "<p><input name=\"note-ref\" type=\"text\"></p>",
    subtypes: ["3.3.2:unnamed-form-field", "4.1.2:unnamed-control"],
    grants: "bare_edit_present",
  },
});

/**
 * Pairings whose ANNOUNCEMENTS collide, so the accompanying defect satisfies the host's own signal.
 *
 * Named individually rather than inferred from the criterion, because the collision is a fact about what
 * NVDA says and not about WCAG numbering. `1.1.1:generic-alt`'s signal is /graphic.*\bimage\b/ and an
 * unnamed graphic announces as "graphic, to get missing image descriptions" — one phrase satisfying two
 * different subtypes' patterns. `filler-collision.test.ts` fails on anything missing from this list.
 */
const COLLIDING_PAIRINGS = Object.freeze({
  "1.1.1:generic-alt": ["unnamed-graphic"],
  "1.1.1:filename-alt": ["unnamed-graphic"],
  "1.3.1:unassociated-table": ["position-only-table"],
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
function withAccompanyingDefects(template, names) {
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
  const chosen = names.filter((name) => !collides.includes(name)
    && !ACCOMPANYING_DEFECTS[name].subtypes.some((s) => s === `${template.criterion}:${template.subtype}`));
  if (chosen.length === 0) return null;
  const markup = chosen.map((name) => ACCOMPANYING_DEFECTS[name].markup).join("");
  const added = chosen.flatMap((name) => ACCOMPANYING_DEFECTS[name].subtypes);
  return pair({
    ...template,
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
const ROTATIONS = Object.freeze([
  ["vague-link", "generic-heading"],
  ["unnamed-graphic", "position-only-table"],
  ["bare-edit", "vague-link"],
  ["generic-heading", "unnamed-graphic"],
  ["position-only-table", "bare-edit"],
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

function multiDefectCases(built) {
  // Every case per subtype, not just the first, so the hosts differ in their page content and not only in
  // which defect was bolted on. A pairing repeated across five different pages teaches the distinction;
  // the same page five times teaches the page.
  const bySubtype = new Map();
  for (const testCase of built) {
    const key = `${testCase.criterion}:${testCase.subtype}`;
    const hosts = bySubtype.get(key) ?? [];
    if (hosts.length < HOSTS_PER_SUBTYPE) bySubtype.set(key, [...hosts, testCase]);
  }
  const generated = [];
  let rotation = 0;
  for (const [, hosts] of [...bySubtype.entries()].sort(([a], [z]) => a.localeCompare(z))) {
    for (const template of hosts) {
      for (let round = 0; round < ROUNDS_PER_HOST; round += 1) {
        const made = withAccompanyingDefects(template, ROTATIONS[rotation % ROTATIONS.length]);
        rotation += 1;
        if (made) generated.push(made);
      }
    }
  }
  return generated;
}

// APPENDED, and appending is now free: furniture is keyed on the case ID, so adding cases cannot
// re-size any existing one's pages.
export const CASES = Object.freeze(withRealisticScale([...cases, ...multiDefectCases(cases)]));

function structuralTextParts(capture) {
  return [
    ...(capture.structure?.headings || []),
    ...(capture.structure?.landmarks || []),
    ...(capture.structure?.formFields || []),
    ...(capture.structure?.tableCells || []),
  ];
}

function interactionTextParts(capture) {
  return [
    ...(capture.interaction?.controls || []),
    ...(capture.interaction?.stateChanges || []).flatMap(({ control, after }) => [control, after]),
    ...(capture.interaction?.formChanges || []).flatMap(({ control, after }) => [control, after]),
    ...(capture.interaction?.postSubmitFields || []),
  ];
}

function captureTextParts(capture) {
  return [
    ...(capture.transcript || []),
    ...structuralTextParts(capture),
    ...interactionTextParts(capture),
  ];
}

function flattenCapture(capture) {
  return captureTextParts(capture).filter((value) => typeof value === "string").join("\n");
}

function regexMatches(capture, signal) {
  return new RegExp(signal.pattern, signal.flags || "i").test(flattenCapture(capture));
}

function structureIsEmpty(capture, signal) {
  return (capture.structure?.[signal.field] || []).length === 0;
}

function headingIsMissing(capture, signal) {
  return !(capture.structure?.headings || []).some((heading) => heading.toLowerCase().includes(signal.text.toLowerCase()));
}

function hasMissingRole(capture, signal) {
  const values = [
    ...(capture.transcript || []),
    ...(capture.structure?.formFields || []),
    ...(capture.interaction?.controls || []),
  ];
  return values.some((value) => value.toLowerCase().includes(signal.text.toLowerCase())
    && !/button|link|checkbox|radio|menu|switch|heading/i.test(value));
}

const STATE_WORD = /\b(expanded|collapsed|open|closed|pressed|checked)\b/i;

const stateWordOf = (text) => (text.match(STATE_WORD)?.[1] ?? "").toLowerCase();

// The disclosure failure is "operating the control did not change the announced state".
//
// This used to test whether the announcement was EMPTY, which was right when the probe
// listened for a spontaneous announcement. The probe now re-reads the control after
// activating it, so `after` always carries a state word and the emptiness test could never
// fire again -- it silently stopped discriminating and took three cases with it. A probe and
// its signal are coupled; changing one means revisiting the other.
function stateChangeIsSilent(capture, signal) {
  const changes = capture.interaction?.stateChanges || [];
  return changes.some(({ control, after }) => {
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
// the bad page carries "".
function formActivationIsSilent(capture, signal) {
  const changes = capture.interaction?.formChanges || [];
  const target = changes.filter(({ control }) => control.toLowerCase().includes(signal.control.toLowerCase()));
  if (signal.expected) return target.length === 0 || target.every(({ after }) => !after.includes(signal.expected));
  return target.length === 0 || target.every(({ after }) => after.trim() === "");
}

// An announced validation error leaves a durable trace on the field: NVDA reports
// "invalid entry" for aria-invalid, plus the message via the field's description.
const ANNOUNCED_ERROR = /invalid|\berror\b/i;

// (b) 3.3.1 Error Identification -- submitting bad input announces no error. Here
// `formChanges.after` is useless: it records the focus move after submit and reads
// "Newsletter signup, document" on BOTH pages. The evidence is in `postSubmitFields`, the
// deliberate re-read of durable field state -- persistent state over transient speech, which
// is the lesson the NVDA correctness audit already drew (its Root 2).
function validationErrorIsSilent(capture, signal) {
  const changes = capture.interaction?.formChanges || [];
  const submitted = changes.some(({ control }) => control.toLowerCase().includes(signal.control.toLowerCase()));
  if (!submitted) return true; // the submit never happened, so nothing could be announced
  // NVDA versions place the durable invalid-field announcement in either the post-submit
  // structural sweep or the activation change's `after` value. Both are screen-reader
  // evidence; relying on only one made a correctly announced error look silent.
  const announcedEvidence = [
    ...(capture.interaction?.postSubmitFields || []),
    ...changes.map(({ after }) => after),
  ];
  return !announcedEvidence.some((field) => ANNOUNCED_ERROR.test(field));
}

// A data cell in a properly-marked-up table is announced with its header
// ("Departs, column 2, 09:15"); without header association NVDA can only announce the
// position ("column 2, 09:15"). Read the dedicated table-cell probe only: the normal transcript
// is not a stable cell boundary and cell counts are not evidence of header relationships.
const POSITION_ONLY_CELL = /^column\s+\d+\b/i;

function tableHeadersAreUnassociated(capture) {
  if ((capture.structure?.tableCells || []).some((cell) =>
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
function placeholderOnlyIsPresent(capture, signal) {
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

function hasUnnamedFormField(capture) {
  return (capture.structure?.formFields || []).some((field) => LEADING_ROLE.test(field.trim()));
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
function routeTitleIsStale(capture) {
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
function unambiguousNames(names) {
  return new Set(names.filter((name) => names.indexOf(name) === names.lastIndexOf(name)));
}

function controlUnreachableByKeyboard(capture) {
  const reading = namesOf(capture.structure?.formFields);
  const tabbed = new Set(namesOf(capture.interaction?.focusOrder));
  if (reading.length < 2 || tabbed.size === 0) return false;
  // The WHOLE tab cycle, or no claim — mirrors `cycleClosed` in rules.ts. Tab wraps to the first control,
  // so a recording that revisits its start has seen every focusable; without that, the probe's fixed stop
  // cap is indistinguishable from the page trapping the keyboard.
  const tabList = namesOf(capture.interaction?.focusOrder);
  if (!(tabList.length > 1 && tabList.lastIndexOf(tabList[0]) > 0)) return false;
  const trackable = unambiguousNames(reading);
  return reading.some((name) => trackable.has(name) && !tabbed.has(name));
}

function skipLinkIsInert(capture) {
  const route = (capture.interaction || {}).routeChange;
  if (!route || route.error || !route.navigated) return false;
  if (!/\b(skip|jump)\b/i.test(String(route.control ?? ""))) return false;
  const landed = route.nextFocusAfter;
  if (typeof landed !== "string" || !landed) return false; // not measured, or silent — no claim
  const ordinary = namesOf(capture.interaction?.focusOrder)[1];
  if (!ordinary) return false;
  return namesOf([landed])[0] === ordinary;
}

function focusOrderIsScrambled(capture) {
  const readingOrder = namesOf(capture.structure?.formFields);
  const tabOrder = firstVisitEach(namesOf(capture.interaction?.focusOrder));
  if (readingOrder.length < 2 || tabOrder.length < 2) return false;
  const readingOnce = unambiguousNames(readingOrder), tabOnce = unambiguousNames(tabOrder);
  const shared = new Set([...readingOnce].filter((name) => tabOnce.has(name)));
  if (shared.size < 2) return false;
  const reading = readingOrder.filter((name) => shared.has(name));
  const tabbed = tabOrder.filter((name) => shared.has(name));
  return reading.join("|") !== tabbed.join("|");
}

/**
 * The accessible name, with container, role and state words stripped, so the two channels are comparable.
 *
 * **This exists TWICE** — here for the dataset signals, and as `comparableNames` in `rules.ts` for the
 * findings — because one is `.mjs` read by the corpus tooling and the other is TypeScript compiled to
 * `dist`, and making the generator depend on a build is how a stale `dist` silently scored the wrong rules
 * earlier today. The duplication is deliberate and it is also a liability: the two drifted within an hour of
 * being written, when the container fix was applied to the rule and not to this, and `check-signals`
 * reported the 2.1.1 case CONTAMINATED — the signal firing on the conformant page while the rule stayed
 * silent on it. `name-normalisation.test.ts` now pins them equal.
 *
 * The leading container is the part that matters: the sweep announces `"form, Full name, edit"` where focus
 * says `"Full name, edit, focused"`, and every real nav bar is a list inside a landmark.
 */
export function namesOf(entries) {
  return (entries || [])
    // Mirrors `accessibleName` + `LEADING_CONTAINER` + `FOCUS_ONLY_STATES` in `rules.ts`, in the same
    // order, from the same token lists. It is a copy because the corpus generator runs under plain
    // `node` and cannot import TypeScript, and making it depend on a build is how a stale `dist`
    // scored the wrong rules earlier today. `name-normalisation.test.ts` pins the two equal on real
    // announcements, which is what makes a forced duplication safe rather than merely known.
    .map((entry) => String(entry)
      .split("\u{FFFC}").join(" ")
      .replace(/^(?:(?:[^,]+\s+)?(?:landmark|form|list|table|group|region|dialog)(?:\s*,\s*with\s+\d+\s+items?)?\s*,\s*)+/i, "")
      .replace(/\b(focused|blank|visited|same page|linked|has auto ?complete|autocomplete)\b/gi, " ")
      .replace(/\b(not checked|checked|not pressed|pressed|collapsed|expanded|not selected|selected|read only|required|invalid entry|out of list|out of region|clickable|multi ?line|level \d+)\b/gi, " ")
      .replace(/\b(navigation landmark|main landmark|banner landmark|radio button|edit text|combo box|list box|menu button|menu item|graphic|image|button|checkbox|heading|region|banner|navigation|radio|edit|link|list)\b/gi, " ")
      .replace(/[\s,]+/g, " ")
      .trim())
    .filter(Boolean);
}

/**
 * Each control's FIRST visit, in order. The tab order is a CYCLE — past the last control Tab wraps to the
 * first — so a faithful recording ends by repeating something it began with, and comparing that raw made
 * the CONFORMANT variant differ from itself. Measured: five fields, six links, then "Full name" again.
 */
function firstVisitEach(names) {
  const seen = new Set();
  return names.filter((name) => (seen.has(name) ? false : (seen.add(name), true)));
}

function focusIsTrapped(capture) {
  const mark = (capture.diagnostics || []).find((entry) => entry && entry.event === "focusOrder");
  return mark ? mark.stalled === true : false;
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
const SIGNAL_PREDICATES = Object.freeze({
  "unnamed-form-field": (capture) => hasUnnamedFormField(capture),
  regex: (capture, signal) => regexMatches(capture, signal),
  "structure-empty": (capture, signal) => structureIsEmpty(capture, signal),
  "missing-heading": (capture, signal) => headingIsMissing(capture, signal),
  "missing-role": (capture, signal) => hasMissingRole(capture, signal),
  "state-change-silent": (capture, signal) => stateChangeIsSilent(capture, signal),
  "form-activation-silent": (capture, signal) => formActivationIsSilent(capture, signal),
  "validation-error-silent": (capture, signal) => validationErrorIsSilent(capture, signal),
  "placeholder-only": (capture, signal) => placeholderOnlyIsPresent(capture, signal),
  "table-unassociated": (capture) => tableHeadersAreUnassociated(capture),
  "focus-trapped": (capture) => focusIsTrapped(capture),
  "route-title-stale": (capture) => routeTitleIsStale(capture),
  "focus-order-scrambled": (capture) => focusOrderIsScrambled(capture),
  "skip-link-inert": (capture) => skipLinkIsInert(capture),
  "control-unreachable-by-keyboard": (capture) => controlUnreachableByKeyboard(capture),
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

export function signalMatches(capture, signal) {
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
