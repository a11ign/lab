// @ts-check
/**
 * Fresh screen-reader acceptance pairs. These are deliberately outside CASES and are
 * never exported into the training JSONL. They measure generalisation after training.
 */

const STYLE = "body{font:16px system-ui,sans-serif;line-height:1.5;max-width:48rem;margin:2rem auto;padding:0 1rem}main{display:grid;gap:1rem}img{display:block;max-width:100%;margin:1rem 0}label{display:block;margin-top:.75rem}.fake-heading{font-size:1.4rem;font-weight:700;margin-top:1rem}.error{color:#9b1c1c}.card{border:1px solid #bbb;padding:1rem}[hidden]{display:none}";

// NVDA speaks image filenames rather than spelling punctuation: "orchard-gate-03.jpg"
// becomes "orchard-gate-03 dot jpg". Keep acceptance signals aligned with the
// screen-reader transcript instead of the source attribute spelling.
/** @param {string} text */
function spokenForm(text) {
  return text.replaceAll("_", "[ _]").replaceAll(".", "(?:\\.| dot )");
}

/**
 * @typedef {{ id: string, task: string }} PairBase
 *   What `pair()` itself needs. It does NOT take a `title` -- the first version of this typedef said it
 *   did, from a glance at the generators rather than at `pair`, and every one of its twelve call sites
 *   became an error. The generators build a title and pass a page; `pair` never sees one.
 *
 * @typedef {PairBase & { title: string }} TitledPair
 *   What the twelve page generators take. Named once because there are twelve of them and twelve inline
 *   shapes is twelve chances for one to drift from the rest.
 *
 * @param {{ title: string, heading: string, body: string, script?: string, landmark?: boolean }} spec
 */
function page({ title, heading, body, script = "", landmark = true }) {
  const content = "<h1>" + heading + "</h1>" + body;
  const container = landmark ? "<main>" + content + "</main>" : content;
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>"
    + title + "</title><style>" + STYLE + "</style></head><body>" + container
    + (script ? "<script>" + script + "</script>" : "") + "</body></html>";
}

/**
 * @param {PairBase & { criterion: string, subtype: string, mutation: string,
 *   badSignal: Record<string, any>, good: string, bad: string, probeForms?: boolean,
 *   probeTables?: boolean, alsoFails?: string[] }} spec
 */
function pair({ id, criterion, subtype, task, mutation, badSignal, good, bad, probeForms = false,
  probeTables = false, alsoFails = [] }) {
  return {
    id: "acceptance-" + id,
    family: "acceptance-" + id,
    criterion,
    subtype,
    task,
    source: "independent acceptance instrument",
    mutation,
    badSignal,
    probeForms,
    probeTables,
    // `alsoFails` was absent here entirely, so a multi-defect acceptance case was not expressible — which
    // is why 0 of 35 acceptance cases carried one, and why held-out acceptance passed a model that fails
    // on multi-defect pages. A gate that cannot represent the hard case cannot fail on it.
    alsoFails,
    good,
    bad,
  };
}

/**
 * The same case, with another criterion's failure added to its bad page.
 *
 * Measured 2026-08-23 and this is the whole reason it exists: the `varied` candidate scored 58 TP, 0 FP,
 * 0 FN on held-out acceptance — a perfect pass — while its own development figures showed
 * `3.3.2:placeholder-only` at precision 0.244. Acceptance could not see the difference because **0 of its
 * 35 cases had more than one defect**, and multi-defect pages are exactly where the trained heads now
 * struggle. That is ADR 0015's own lesson landing on the gate that judges ADR 0015's fix: a metric
 * computed on data that lacks the hard case cannot see failure on the hard case.
 *
 * Deliberately a SMALL set. Acceptance is held out and stays that way: these are new pages built on
 * acceptance's own instruments, never copies of training hosts, and the point is that the gate can
 * EXPRESS the case — not that it re-measures the whole corpus.
 */
/**
 * @param {ReturnType<typeof pair>} base
 * @param {{ suffix: string, markup: string, adds: string[], describes: string }} extra
 * @returns {ReturnType<typeof pair>}
 *
 * IN AND OUT are the same shape, and saying so is what keeps `ALL_ACCEPTANCE_CASES` a homogeneous list.
 * Typed loosely, the multi-defect half of that array lost `criterion` and `subtype` from its type -- the
 * two fields `acceptance-matrix.test.ts` groups by, which is how the test noticed.
 */
function alsoCarrying(base, { suffix, markup, adds, describes }) {
  return {
    ...base,
    id: `${base.id}+also-${suffix}`,
    family: `${base.family}+also-${suffix}`,
    mutation: `${base.mutation} It ALSO carries ${describes}.`,
    alsoFails: [...new Set([...(base.alsoFails ?? []), ...adds])],
    bad: base.bad.replace("</body>", `${markup}</body>`),
  };
}

/** The accompanying failures, matching the training family's wording so the two teach the same thing. */
const ACCEPTANCE_ACCOMPANYING = Object.freeze({
  "vague-link": { markup: "<p><a href=\"#note\">Details</a></p>", adds: ["2.4.4:regex"],
    describes: "a vague link" },
  "bare-edit": { markup: "<p><input name=\"ref-code\" type=\"text\"></p>",
    adds: ["3.3.2:unnamed-form-field", "4.1.2:unnamed-control"], describes: "an unlabelled field" },
  "generic-heading": { markup: "<h2>Details</h2><p>Further notes are held with the records.</p>",
    adds: ["2.4.6:regex"], describes: "a vague heading" },
});

/**
 * @param {TitledPair & { description: string, file: string, goodAlt: string,
 *   badAlt: string | null, subtype: string }} spec
 *   `badAlt` is NULLABLE and that is the `missing-alt` case -- an image with no alternative at all, which
 *   is a different defect from one with a bad alternative. A non-null type here would have made the
 *   subtype this generator exists to produce unexpressible.
 */
function imagePair({ id, title, description, file, goodAlt, badAlt, subtype, task }) {
  const badName = badAlt === null
    ? "(?:\\ufffc|to get missing image descriptions)"
    : spokenForm(badAlt);
  return pair({
    id,
    criterion: "1.1.1",
    subtype,
    task,
    mutation: "The informative image loses a meaningful alternative.",
    badSignal: { type: "regex", pattern: "graphic.*" + badName, flags: "i" },
    good: page({ title, heading: title, body: "<p>" + description + "</p><img src=\"/" + file + "\" alt=\"" + goodAlt + "\">" }),
    bad: page({ title, heading: title, body: "<p>" + description + "</p><img src=\"/" + file + "\"" + (badAlt === null ? "" : " alt=\"" + badAlt + "\"") + ">" }),
  });
}

/** @param {TitledPair & { context: string, vague: string, descriptive: string }} spec */
function linkPair({ id, title, context, vague, descriptive, task }) {
  return pair({
    id,
    criterion: "2.4.4",
    subtype: "regex",
    task,
    mutation: "The link name does not identify its destination.",
    badSignal: { type: "regex", pattern: "link[, ]+" + vague + "\\b", flags: "i" },
    good: page({ title, heading: title, body: "<p>" + context + "</p><a href=\"/destination\">" + descriptive + "</a>" }),
    bad: page({ title, heading: title, body: "<p>" + context + "</p><a href=\"/destination\">" + vague + "</a>" }),
  });
}

/** @param {TitledPair & { vague: string, descriptive: string }} spec */
function headingPair({ id, title, vague, descriptive, task }) {
  return pair({
    id,
    criterion: "2.4.6",
    subtype: "regex",
    task,
    mutation: "The section heading does not identify its topic.",
    badSignal: { type: "regex", pattern: "heading.*\\b" + vague.toLowerCase() + "\\b", flags: "i" },
    good: page({ title, heading: title, body: "<h2>" + descriptive + "</h2><p>The section explains the next step.</p>" }),
    bad: page({ title, heading: title, body: "<h2>" + vague + "</h2><p>The section explains the next step.</p>" }),
  });
}

/** @param {TitledPair & { label: string }} spec */
function landmarkPair({ id, title, label, task }) {
  return pair({
    id,
    criterion: "1.3.1",
    subtype: "missing-landmark",
    task,
    mutation: "A meaningful page region is not exposed as a landmark.",
    badSignal: { type: "structure-empty", field: "landmarks" },
    good: page({ title, heading: title, body: "<section aria-label=\"" + label + "\"><h2>" + label + "</h2><p>Information is available here.</p></section>" }),
    bad: page({ title, heading: title, landmark: false, body: "<div><h2>" + label + "</h2><p>Information is available here.</p></div>" }),
  });
}

/** @param {TitledPair & { label: string }} spec */
function fakeHeadingPair({ id, title, label, task }) {
  return pair({
    id,
    criterion: "1.3.1",
    subtype: "fake-heading",
    task,
    mutation: "Visible heading text is not exposed with a heading role.",
    badSignal: { type: "missing-heading", text: label },
    good: page({ title, heading: title, body: "<h2>" + label + "</h2><p>The section contains useful guidance.</p>" }),
    bad: page({ title, heading: title, body: "<div class=\"fake-heading\">" + label + "</div><p>The section contains useful guidance.</p>" }),
  });
}

/** @param {TitledPair & { destination: string }} spec */
function tablePair({ id, title, destination, task }) {
  const good = "<table><caption>Service schedule</caption><thead><tr><th scope=\"col\">Destination</th><th scope=\"col\">Time</th></tr></thead><tbody><tr><th scope=\"row\">" + destination + "</th><td>10:20</td></tr></tbody></table>";
  const bad = "<table><caption>Service schedule</caption><tr><td>Destination</td><td>Time</td></tr><tr><td>" + destination + "</td><td>10:20</td></tr></table>";
  return pair({
    id,
    criterion: "1.3.1",
    subtype: "unassociated-table",
    task,
    mutation: "Table headers are visible but not associated with data cells.",
    badSignal: { type: "table-unassociated" },
    probeTables: true,
    good: page({ title, heading: title, body: good }),
    bad: page({ title, heading: title, body: bad }),
  });
}

/** @param {TitledPair & { field: string, submit: string }} spec */
function errorPair({ id, title, field, submit, task }) {
  const message = "Enter the " + field.toLowerCase() + " before submitting.";
  const good = "<form id=\"form\" onsubmit=\"event.preventDefault(); document.querySelector('#field').setAttribute('aria-invalid', 'true'); document.querySelector('#error').hidden = false; document.querySelector('#field').focus();\"><label for=\"field\">" + field + "</label><input id=\"field\" aria-describedby=\"error\"><button type=\"submit\">" + submit + "</button><p id=\"error\" role=\"alert\" hidden>" + message + "</p></form>";
  const bad = "<form id=\"form\" onsubmit=\"event.preventDefault(); document.querySelector('.error').hidden = false;\"><label for=\"field\">" + field + "</label><input id=\"field\"><button type=\"submit\">" + submit + "</button><p class=\"error\" hidden>" + message + "</p></form>";
  return pair({
    id,
    criterion: "3.3.1",
    subtype: "validation-error-silent",
    task,
    mutation: "The validation message appears visually but is not announced.",
    badSignal: { type: "validation-error-silent", control: submit },
    probeForms: true,
    good: page({ title, heading: title, body: good }),
    bad: page({ title, heading: title, body: bad }),
  });
}

/**
 * (3.3.3 Error Suggestion) held out. BOTH sides announce; only the message differs.
 *
 * The same construction as the training corpus and for the same reason: if the bad variant failed to
 * announce, every 3.3.3 positive here would also be a 3.3.1 positive and the held-out set could not tell
 * the two heads apart. So both use `errorPair`'s CONFORMANT markup and differ only in what is said.
 *
 * REMEDIES ARE SPOKEN IN WORDS, never punctuation. Measured 2026-09-01 on the training corpus: NVDA says
 * "e.g." as "e dot g." and "DD/MM/YYYY" as "DD slash MM slash YYYY", so a remedy that leans on a symbol
 * is not recognisable in the announcement and its own case stops discriminating. That cost a chain.
 *
 * @param {TitledPair & { field: string, submit: string, remedy: string, problemOnly: string }} spec
 */
function errorRemedyPair({ id, title, field, submit, remedy, problemOnly, task }) {
  const form = (/** @type {string} */ message) =>
    "<form id=\"form\" onsubmit=\"event.preventDefault(); document.querySelector('#field').setAttribute('aria-invalid', 'true');"
    + " document.querySelector('#error').hidden = false; document.querySelector('#field').focus();\">"
    + "<label for=\"field\">" + field + "</label><input id=\"field\" aria-describedby=\"error\">"
    + "<button type=\"submit\">" + submit + "</button>"
    + "<p id=\"error\" role=\"alert\" hidden>" + message + "</p></form>";
  return pair({
    id,
    criterion: "3.3.3",
    subtype: "error-remedy-missing",
    task,
    mutation: "The error is announced correctly but names only the problem, never how to fix it.",
    badSignal: { type: "error-remedy-missing", control: submit },
    probeForms: true,
    good: page({ title, heading: title, body: form(remedy) }),
    bad: page({ title, heading: title, body: form(problemOnly) }),
  });
}

/** @param {TitledPair & { label: string, name: string, placeholderOnly?: boolean }} spec */
function formPair({ id, title, label, name, task, placeholderOnly = false }) {
  const goodBody = "<form><label for=\"" + name + "\">" + label + "</label><input id=\"" + name + "\" name=\"" + name + "\" placeholder=\"Example value\"></form>";
  const badBody = placeholderOnly
    ? "<form><input name=\"" + name + "\" placeholder=\"Example value\"></form>"
    : "<form><span>" + label + "</span><input name=\"" + name + "\"></form>";
  return pair({
    id,
    criterion: "3.3.2",
    subtype: placeholderOnly ? "placeholder-only" : "unnamed-form-field",
    task,
    mutation: placeholderOnly ? "The field relies on a placeholder instead of a persistent label." : "The field loses its programmatic label.",
    badSignal: placeholderOnly
      ? { type: "placeholder-only", placeholder: "Example value" }
      : { type: "unnamed-form-field" },
    probeForms: true,
    good: page({ title, heading: title, body: goodBody, script: "document.querySelector('input').focus()" }),
    bad: page({ title, heading: title, body: badBody, script: "document.querySelector('input').focus()" }),
  });
}

/** @param {TitledPair & { label: string }} spec */
function iconPair({ id, title, label, task }) {
  return pair({
    id,
    criterion: "4.1.2",
    // MUST match the training vocabulary: the head is named `4.1.2:unnamed-control`, so a held-out case
    // labelled `4.1.2:regex` is a positive no head can predict -- `eligible_records` drops it, and the
    // gate then reports "fewer than 3 acceptance positives" for a criterion that is in fact covered.
    //
    // Renamed in `case-matrix.mjs` and missed here, which is the failure this repo names most often: a
    // change applied at one of the sites a behaviour reaches. The acceptance matrix is the one place
    // where a stale subtype cannot be caught by `rules:gate`, because that gate reads the TRAINING
    // export and never looks at the held-out set.
    subtype: "unnamed-control",
    task,
    mutation: "An icon-only button has no accessible name.",
    badSignal: { type: "regex", pattern: "(?:^|\\n)button[, ]*(?:(?:\\ufffc|to get missing image descriptions))?[, ]*(?:$|\\n)", flags: "im" },
    probeForms: true,
    good: page({ title, heading: title, body: "<button type=\"button\" aria-label=\"" + label + "\"><span aria-hidden=\"true\">⌕</span></button>", script: "document.querySelector('button').focus()" }),
    bad: page({ title, heading: title, body: "<button type=\"button\"><span aria-hidden=\"true\">⌕</span></button>", script: "document.querySelector('button').focus()" }),
  });
}

/** @param {TitledPair & { label: string }} spec */
function controlPair({ id, title, label, task }) {
  return pair({
    id,
    criterion: "4.1.2",
    subtype: "missing-role",
    task,
    mutation: "A styled interactive element exposes no control role.",
    badSignal: { type: "missing-role", text: label },
    probeForms: true,
    good: page({ title, heading: title, body: "<button type=\"button\">" + label + "</button>", script: "document.querySelector('button').focus()" }),
    bad: page({ title, heading: title, body: "<div class=\"card\" tabindex=\"0\">" + label + "</div>", script: "document.querySelector('.card').focus()" }),
  });
}

/** @param {TitledPair & { control: string }} spec */
function disclosurePair({ id, title, control, task }) {
  const body = "<button id=\"toggle\" type=\"button\" aria-expanded=\"false\" aria-controls=\"content\">" + control + "</button><div id=\"content\" hidden>More information.</div>";
  const goodScript = "document.querySelector('#toggle').addEventListener('click',e=>{const b=e.currentTarget;const open=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',String(!open));document.querySelector('#content').hidden=open})";
  const badScript = "document.querySelector('#toggle').addEventListener('click',()=>{document.querySelector('#content').hidden=false})";
  return pair({
    id,
    criterion: "4.1.2",
    subtype: "state-change-silent",
    task,
    mutation: "Activating the disclosure changes content without updating the announced state.",
    badSignal: { type: "state-change-silent", control },
    probeForms: true,
    good: page({ title, heading: title, body, script: goodScript }),
    bad: page({ title, heading: title, body, script: badScript }),
  });
}

/** @param {TitledPair & { control: string }} spec */
function statusPair({ id, title, control, task }) {
  const body = "<button id=\"filter\" type=\"button\">" + control + "</button><p id=\"count\">Showing 8 items.</p><ul><li>First item</li><li>Second item</li></ul>";
  const script = "document.querySelector('#filter').addEventListener('click',()=>{document.querySelector('#count').textContent='Showing 2 matching items.'})";
  return pair({
    id,
    criterion: "4.1.3",
    subtype: "form-activation-silent",
    task,
    mutation: "A result count changes without a live status announcement.",
    badSignal: { type: "form-activation-silent", control, expected: "Showing 2 matching items." },
    probeForms: true,
    good: page({
      title,
      heading: title,
      body: body.replace(
        'id="count"',
        'id="count" role="status" aria-live="polite" aria-atomic="true"',
      ),
      script,
    }),
    bad: page({ title, heading: title, body, script }),
  });
}

export const ACCEPTANCE_CASES = Object.freeze([
  imagePair({ id: "generic-lantern", title: "Lantern collection", description: "The collection includes hand-painted lanterns.", file: "lantern.jpg", goodAlt: "Hand-painted lantern beside a window", badAlt: "image", subtype: "generic-alt", task: "Understand what the lantern image shows." }),
  imagePair({ id: "generic-rain", title: "Rain garden", description: "The rain garden collects water from the roof.", file: "rain-garden.jpg", goodAlt: "Rain garden beside the visitor centre", badAlt: "photo", subtype: "generic-alt", task: "Understand what the rain garden looks like." }),
  imagePair({ id: "filename-orchard", title: "Orchard map", description: "The orchard entrance is beside the old wall.", file: "orchard-gate-03.jpg", goodAlt: "Entrance gate to the orchard", badAlt: "orchard-gate-03.jpg", subtype: "filename-alt", task: "Find the orchard entrance." }),
  imagePair({ id: "missing-banners", title: "Festival banners", description: "The banners mark the route to the festival.", file: "festival-banners.png", goodAlt: "Colourful banners along the festival route", badAlt: null, subtype: "missing-alt", task: "Understand what the festival banners show." }),
  fakeHeadingPair({ id: "fake-hours", title: "Museum visits", label: "Opening hours", task: "Find the museum opening hours." }),
  fakeHeadingPair({ id: "fake-access", title: "Community centre", label: "Access information", task: "Find the community centre access information." }),
  landmarkPair({ id: "landmark-services", title: "Visitor services", label: "Visitor services", task: "Jump to visitor services." }),
  tablePair({ id: "table-bus", title: "Bus timetable", destination: "Market square", task: "Compare the bus time and destination for Market square." }),
  linkPair({ id: "link-guidance", title: "Cycling guidance", context: "The route avoids the main road.", vague: "Details", descriptive: "Read cycling route safety guidance", task: "Open cycling route safety guidance." }),
  linkPair({ id: "link-appointments", title: "Appointments", context: "Appointments are available next week.", vague: "Here", descriptive: "Book an appointment next week", task: "Book an appointment next week." }),
  linkPair({ id: "link-repairs", title: "Repairs", context: "The repair team handles bicycles.", vague: "More", descriptive: "Read bicycle repair information", task: "Read bicycle repair information." }),
  linkPair({ id: "link-permits", title: "Permits", context: "Permits are required for overnight stays.", vague: "Go", descriptive: "Apply for an overnight stay permit", task: "Apply for an overnight stay permit." }),
  headingPair({ id: "heading-guidance", title: "Cycling guide", vague: "Overview", descriptive: "Route safety guidance", task: "Find route safety guidance." }),
  headingPair({ id: "heading-permits", title: "Permit guide", vague: "More", descriptive: "Permit requirements", task: "Find the permit requirements." }),
  headingPair({ id: "heading-repairs", title: "Repair guide", vague: "Stuff", descriptive: "What to bring for a repair", task: "Find what to bring for a repair." }),
  headingPair({ id: "heading-visits", title: "Visit guide", vague: "Welcome", descriptive: "Planning your visit", task: "Find how to plan the visit." }),
  errorPair({ id: "error-name", title: "Membership request", field: "Member name", submit: "Join the scheme", task: "Submit the membership form without a name." }),
  errorPair({ id: "error-date", title: "Room booking", field: "Booking date", submit: "Book the room", task: "Submit the room booking without a date." }),
  errorPair({ id: "error-code", title: "Equipment loan", field: "Loan code", submit: "Request equipment", task: "Submit the equipment request without a code." }),
  errorPair({ id: "error-phone", title: "Callback request", field: "Phone number", submit: "Request a callback", task: "Submit the callback request without a phone number." }),
  formPair({ id: "placeholder-email", title: "Event registration", label: "Contact email", name: "contact-email", placeholderOnly: true, task: "Enter the contact email for registration." }),
  formPair({ id: "field-company", title: "Supplier form", label: "Company name", name: "company", task: "Enter the supplier company name." }),

  // ---- HOLD-OUT BATCH 2, added 2026-08-23 -------------------------------------------------------------
  //
  // A second set for the same criteria, on entirely different subject matter, because the first batch
  // stopped being held-out. It was measured roughly eight times in one day with changes made between
  // measurements, which turns a test set into a development set: the score it reports is optimistic by
  // construction, and this project's own ADR 0015 is about exactly that failure.
  //
  // What partly rescued the first batch's number is that most of the gain came from mechanism fixes found
  // by diagnosis rather than by score-chasing — a regex reading 3.4% of announcements, a rule reporting
  // the wrong criterion, a heuristic matching buttons. Those would have been right with no score attached.
  // The threshold and pooling experiments WERE score-driven, and both were reverted for failing.
  //
  // Different words, different domains, same failure modes. Nothing here reuses a noun from batch 1: the
  // point is that a model which learned batch 1's vocabulary gains nothing.
  imagePair({ id: "b2-generic-kiln", title: "Pottery kiln", description: "The kiln fires stoneware twice a week.", file: "kiln.jpg", goodAlt: "Brick kiln with its door open", badAlt: "picture", subtype: "generic-alt", task: "Understand what the kiln image shows." }),
  imagePair({ id: "b2-filename-quarry", title: "Quarry trail", description: "The trail follows the old quarry edge.", file: "quarry_path_07.jpg", goodAlt: "Gravel path along the quarry edge", badAlt: "quarry_path_07.jpg", subtype: "filename-alt", task: "Follow the quarry trail." }),
  imagePair({ id: "b2-missing-weir", title: "River weir", description: "The weir controls the level upstream.", file: "weir.png", goodAlt: "Stone weir across the river", badAlt: null, subtype: "missing-alt", task: "Understand what the weir looks like." }),
  fakeHeadingPair({ id: "b2-fake-collections", title: "Archive service", label: "Collection deposits", task: "Find how to deposit a collection." }),
  fakeHeadingPair({ id: "b2-fake-lending", title: "Tool library", label: "Lending conditions", task: "Find the tool lending conditions." }),
  tablePair({ id: "b2-table-ferry", title: "Ferry crossings", destination: "Harbour pier", task: "Compare the ferry time and destination for Harbour pier." }),
  linkPair({ id: "b2-link-grazing", title: "Grazing rights", context: "Common land is managed by the trust.", vague: "This", descriptive: "Read common grazing rights rules", task: "Open the common grazing rights rules." }),
  linkPair({ id: "b2-link-moorings", title: "Moorings", context: "Berths are allocated each spring.", vague: "Info", descriptive: "Apply for a seasonal mooring berth", task: "Apply for a seasonal mooring berth." }),
  headingPair({ id: "b2-heading-kiln", title: "Kiln guide", vague: "Things", descriptive: "Firing schedule and temperatures", task: "Find the firing schedule." }),
  headingPair({ id: "b2-heading-weir", title: "Weir guide", vague: "Details", descriptive: "Water level and safety notes", task: "Find the water level notes." }),
  errorPair({ id: "b2-error-plot", title: "Allotment request", field: "Plot number", submit: "Request the plot", task: "Submit the allotment request without a plot number." }),
  errorRemedyPair({ id: "remedy-membership", title: "Membership renewal", field: "Membership number",
    submit: "Renew membership", remedy: "Membership numbers must be six digits, for example 402117.",
    problemOnly: "That is wrong.", task: "Renew a membership with a short membership number." }),
  errorRemedyPair({ id: "remedy-collection", title: "Collection slot", field: "Collection window",
    submit: "Reserve slot", remedy: "Choose a window between 08:00 and 18:00.",
    problemOnly: "Unacceptable.", task: "Reserve a collection slot outside the opening hours." }),
  errorRemedyPair({ id: "remedy-vehicle", title: "Permit renewal", field: "Vehicle registration",
    submit: "Renew permit", remedy: "Enter the registration without spaces, such as AB12CDE.",
    problemOnly: "Not valid.", task: "Renew a permit with a spaced vehicle registration." }),
  errorRemedyPair({ id: "remedy-tenancy", title: "Repair report", field: "Tenancy reference",
    submit: "Report repair", remedy: "Tenancy references must start with a letter.",
    problemOnly: "Incorrect.", task: "Report a repair with a numeric tenancy reference." }),
  errorRemedyPair({ id: "remedy-account", title: "Refund request", field: "Account name",
    submit: "Request refund", remedy: "Use the name exactly as it appears on the account.",
    problemOnly: "This is an error.", task: "Request a refund with a shortened account name." }),
  errorPair({ id: "b2-error-vessel", title: "Berth application", field: "Vessel name", submit: "Apply for a berth", task: "Submit the berth application without a vessel name." }),
  formPair({ id: "b2-field-trust", title: "Trust contact form", label: "Trust name", name: "trust", task: "Enter the trust name." }),
  formPair({ id: "b2-field-vessel", title: "Vessel register", label: "Vessel registration", name: "vessel-reg", task: "Enter the vessel registration." }),
  formPair({ id: "field-ticket", title: "Support form", label: "Ticket number", name: "ticket", task: "Enter the support ticket number." }),
  formPair({ id: "field-route", title: "Route form", label: "Route name", name: "route", task: "Enter the route name." }),
  iconPair({ id: "icon-settings", title: "Settings", label: "Open settings", task: "Open settings." }),
  iconPair({ id: "icon-calendar", title: "Calendar", label: "Open calendar", task: "Open the calendar." }),
  controlPair({ id: "control-notify", title: "Notifications", label: "Save notification settings", task: "Save notification settings." }),
  // FOUR disclosure cases, not one, and the reason is a measurement rather than symmetry.
  //
  // `4.1.2:unnamed-control` is decided by the deterministic rules, so the acceptance evaluator correctly
  // excludes it from what the MODEL is answerable for -- leaving `state-change-silent` as 4.1.2's only
  // model-owned subtype. With a single case across two repeats that is 2 held-out positives against a
  // floor of 3, and the gate refused to call two records a generalisation claim. It was right to: the
  // model scored FP 0 / FN 0 on every criterion, and the failure was a shortage of EVIDENCE, not an
  // error. Four cases give 8 positives, matching the footing 4.1.3 and 3.3.1 already have.
  disclosurePair({ id: "disclosure-access", title: "Access advice", control: "Access advice", task: "Open the access advice." }),
  disclosurePair({ id: "disclosure-refunds", title: "Refund policy", control: "Refund policy", task: "Open the refund policy." }),
  disclosurePair({ id: "disclosure-lockers", title: "Locker hire", control: "Locker hire", task: "Open the locker hire details." }),
  disclosurePair({ id: "disclosure-cycling", title: "Cycle storage", control: "Cycle storage", task: "Open the cycle storage details." }),
  statusPair({ id: "status-red", title: "Colour catalogue", control: "Show red items", task: "Show red items and notice the result count." }),
  statusPair({ id: "status-large", title: "Size catalogue", control: "Show large items", task: "Show large items and notice the result count." }),
  statusPair({ id: "status-new", title: "New items", control: "Show new items", task: "Show new items and notice the result count." }),
  statusPair({ id: "status-local", title: "Local items", control: "Show local items", task: "Show local items and notice the result count." }),
]);

/**
 * MULTI-DEFECT acceptance cases — the hard case the gate could not previously express.
 *
 * Six, derived from acceptance's OWN pairs so they stay held out and disjoint from training. Each takes a
 * single-defect acceptance case and adds another criterion's failure to its bad page, exactly as the
 * training family does — so a model that has learned "my defect versus somebody else's" passes, and one
 * that has learned "this page has something wrong with it" does not.
 *
 * Chosen to cover the heads that actually struggled: 3.3.2 (both subtypes), 2.4.4, 1.3.1 and 4.1.2. A
 * pairing is never made with the host's own subtype, and never adds a focusable element to a host measured
 * on `focusOrder` — the two rules the training family learned the hard way.
 */
const MULTI_DEFECT_ACCEPTANCE = Object.freeze(
  [
    // `placeholder-email` paired with a bare edit is the single most important row here: it is exactly the
    // discrimination `3.3.2:placeholder-only` fails, and no page in either corpus contained both.
    ["placeholder-email", "bare-edit"],
    ["field-company", "vague-link"],
    ["disclosure-access", "generic-heading"],
    ["link-guidance", "generic-heading"],
    ["table-bus", "vague-link"],
    ["fake-hours", "bare-edit"],
    ["generic-lantern", "vague-link"],
  ]
    // `flatMap` rather than map-then-`filter(Boolean)`. The old shape was correct at runtime and left
    // `null` in the exported array's type, so every reader of `ALL_ACCEPTANCE_CASES` -- including its own
    // test -- had to treat a case as possibly absent. Deciding and building in one place needs no
    // narrowing to explain, and it is the same fix `parseProcessMemory` took for the same reason.
    .flatMap(([id, suffix]) => {
      const base = ACCEPTANCE_CASES.find((/** @type {{ id: string }} */ c) => c.id === `acceptance-${id}`);
      if (!base) return []; // an id that no longer exists is caught by `acceptance-matrix.test.ts`
      return [alsoCarrying(base, { suffix, .../** @type {Record<string, any>} */ (ACCEPTANCE_ACCOMPANYING)[suffix] })];
    }),
);

/** Everything the acceptance run captures: the single-defect instruments plus the multi-defect ones. */
export const ALL_ACCEPTANCE_CASES = Object.freeze([...ACCEPTANCE_CASES, ...MULTI_DEFECT_ACCEPTANCE]);

