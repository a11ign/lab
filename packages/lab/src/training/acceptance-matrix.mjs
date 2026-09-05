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
 * `heading` is OPTIONAL, and omitting it emits NO `<h1>` rather than an empty one. That distinction is the
 * whole of `1.3.1:no-headings`: the rule requires the census to CONFIRM zero headings, and `<h1></h1>` is
 * a heading with no name — a different failure, and one that would make the case measure 4.1.2 instead.
 * Absence read as a value, in the one place where absence IS the finding.
 *
 * @param {{ title: string, heading?: string, body: string, script?: string, landmark?: boolean }} spec
 */
function page({ title, heading, body, script = "", landmark = true }) {
  const content = (heading === undefined ? "" : "<h1>" + heading + "</h1>") + body;
  const container = landmark ? "<main>" + content + "</main>" : content;
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>"
    + title + "</title><style>" + STYLE + "</style></head><body>" + container
    + (script ? "<script>" + script + "</script>" : "") + "</body></html>";
}

/**
 * EVERY `probe*` FLAG IS FORWARDED BY PREFIX, and enumerating two of them was why seven corpus subtypes
 * had no held-out coverage at all.
 *
 * This took `probeForms` and `probeTables` by name and dropped everything else on the floor. So an
 * acceptance case could not ask for `probeFocus`, `probeFocusContext`, `probeTyping`, `probeNavigation`
 * or `probeOrder` — and the eight subtypes needing them (3.2.1, 3.2.2, 2.1.1, 2.1.2, 2.4.1, 2.4.2, 2.4.3
 * and, for a different reason, 1.3.1:no-headings) were not unwritten. **They were inexpressible.** A gate
 * that cannot represent a case cannot fail on it, which is the argument `alsoFails` is here for, one
 * field along.
 *
 * THE REMEDY ALREADY EXISTED AND HAD BEEN APPLIED TO ONE OF TWO PATHS. `generate-screenreader-dataset.mjs`
 * forwards `Object.entries(testCase).filter(([key]) => key.startsWith("probe"))` and its comment explains
 * why: "enumerating them is how this exact defect happened three times in one feature". The corpus hop was
 * fixed and the acceptance hop was not — this repo's most expensive recurring shape, a fix reaching one
 * call site when the behaviour reaches several, occurring inside the feature whose own comment records
 * the first three instances.
 *
 * `probeForms` and `probeTables` keep explicit `false` defaults because the manifest schema and
 * `chooseProbe` both read them as booleans; the rest pass through only when a case sets them.
 *
 * The type carries an INDEX SIGNATURE for the probe flags rather than naming them, for the same reason the
 * code forwards them by prefix: naming them here would reintroduce exactly the enumeration this fix
 * removed, one layer up, and `tsc` would then reject the case that the runtime happily forwards.
 *
 * @param {PairBase & { criterion: string, subtype: string, mutation: string,
 *   badSignal: Record<string, any>, good: string, bad: string, probeForms?: boolean,
 *   probeTables?: boolean, alsoFails?: string[] } & Record<string, any>} spec
 */
// EXPORTED for `probe-chain.test.ts` only. That file owns the question "which probe a case wants, across
// every hop", and it imported only case-matrix's `pair` -- so the corpus builder was guarded against
// dropping a probe flag and this one, which was actually dropping them, was not.
export function pair({ id, criterion, subtype, task, mutation, badSignal, good, bad, probeForms = false,
  probeTables = false, alsoFails = [], ...rest }) {
  const probes = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key.startsWith("probe")),
  );
  return {
    ...probes,
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

/**
 * 3.1.2 Language of Parts — a passage in another language, marked in one variant and not the other.
 *
 * ADDED 2026-09-04, and the reason it was missing is worth more than the cases.
 *
 * This file is a SEPARATE hand-written list of subtypes from `case-matrix.mjs`, and nothing compared
 * them. So the 29 language cases entered the corpus, a `3.1.2:language-unmarked` head was trained, and
 * the held-out set had ZERO examples of it — the gate then refused a model it could not evaluate, twice,
 * each time after a full capture-and-train. `acceptance-covers-the-corpus.test.ts` now answers that in
 * milliseconds instead.
 *
 * DIFFERENT CONTENT FROM THE CORPUS, deliberately: these measure generalisation, so a passage reused from
 * `case-matrix.mjs` would measure memorisation and report it as success. Different languages, different
 * sentences, different page shells.
 *
 * BOTH VARIANTS CARRY THE SAME FOREIGN PASSAGE and only the `lang` differs — the pair discipline the
 * corpus states: two pages differing by exactly the property under test, so nothing can separate them on
 * anything else. An earlier corpus generation put the foreign text only on the failing page and taught
 * the WORD rather than the defect.
 *
 * Observable only because `[speech] reportLanguage` is ON across the fleet. At NVDA's defaults a language
 * change is a change of VOICE with no text, and a pipeline capturing speech as text is blind to it.
 *
 * @param {TitledPair & { lead: string, passage: string, lang: string, langName: string }} spec
 */
function languagePair({ id, title, lead, passage, lang, langName, task }) {
  const body = (/** @type {boolean} */ marked) =>
    "<p>" + lead + "</p><p" + (marked ? " lang=\"" + lang + "\"" : "") + ">" + passage + "</p>";
  return pair({
    id,
    criterion: "3.1.2",
    subtype: "language-unmarked",
    task,
    mutation: "The passage is in " + langName + " and carries no `lang`, so a screen reader reads it with "
      + "the page's own language and announces no change.",
    badSignal: { type: "language-unmarked", language: langName },
    good: page({ title, heading: title, body: body(true) }),
    bad: page({ title, heading: title, body: body(false) }),
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

/**
 * 3.2.1 / 3.2.2 — the page renames itself when a field is focused, or when it is typed into.
 *
 * NEWLY EXPRESSIBLE 2026-09-05: `pair()` enumerated `probeForms` and `probeTables` and dropped every other
 * probe flag, so these two subtypes could not be written at all. Their mapping was downgraded to
 * `secondary` the same day after the criterion audit found the rule asserting a change of CONTEXT on any
 * change of CONTENT — and the held-out set could not see that change, because it had no case to see it
 * with. A gate blind to the head whose behaviour just moved.
 *
 * One generator for both, as the corpus has, because 3.2.2 is 3.2.1 "on change rather than focus" and
 * writing them apart would be the same fact twice.
 *
 * @param {{ id: string, title: string, field: string, changedTitle: string, task: string,
 *           on: "focus" | "input" }} spec
 */
function contextChangePair({ id, title, field, changedTitle, task, on }) {
  const body = (/** @type {boolean} */ changes) =>
    "<form><label for=\"ctl\">" + field + "</label><input id=\"ctl\"></form>"
    + (changes
      ? "<script>document.querySelector('#ctl').addEventListener('" + on + "', function () {"
        + "document.title = " + JSON.stringify(changedTitle) + "; });</script>"
      : "");
  const criterion = on === "focus" ? "3.2.1" : "3.2.2";
  return pair({
    id,
    criterion,
    subtype: on === "focus" ? "focus-context-change" : "input-context-change",
    task,
    mutation: on === "focus"
      ? "Focusing the field silently renames the page."
      : "Typing into the field silently renames the page.",
    badSignal: { type: on === "focus" ? "focus-context-change" : "input-context-change" },
    good: page({ title, heading: title, body: body(false) }),
    bad: page({ title, heading: title, body: body(true) }),
    probeFocus: true,
    ...(on === "focus" ? { probeFocusContext: true } : { probeTyping: true }),
  });
}

/**
 * 1.3.1 — a page whose sections are styled to look like headings and carry no heading role at all.
 *
 * THE ONE OF THE EIGHT THAT WAS NEVER BLOCKED. It needs no probe: the signal is `structure-empty` on
 * `headings`, which the unconditional sweep already answers. So unlike its seven neighbours this could
 * have been written at any time and simply was not — worth distinguishing, because "nobody could" and
 * "nobody did" need different fixes and the ledger in the test file now says which is which.
 *
 * The rule requires the census to CONFIRM zero headings rather than inferring it from an empty sweep,
 * which is why the bad page must have none at all rather than merely failing to announce them.
 *
 * @param {{ id: string, title: string, sections: string[], task: string }} spec
 */
function noHeadingsPair({ id, title, sections, task }) {
  const withHeadings = sections.map((t) => "<h2>" + t + "</h2><p>Guidance for this section follows.</p>").join("");
  const withoutHeadings = sections
    .map((t) => "<p><b>" + t + "</b></p><p>Guidance for this section follows.</p>").join("");
  return pair({
    id,
    criterion: "1.3.1",
    subtype: "no-headings",
    task,
    mutation: "Section titles are bold paragraphs rather than headings, so the page exposes no heading "
      + "structure and quick navigation has nothing to move between.",
    badSignal: { type: "structure-empty", field: "headings" },
    good: page({ title, heading: title, body: withHeadings }),
    // No `heading` argument, so this page carries no `<h1>` either -- the census must read ZERO.
    bad: page({ title, body: withoutHeadings }),
  });
}

/**
 * 2.4.3 — positive `tabindex` pulls two fields ahead of the rest, so the tab order contradicts reading
 * order while the page reads and looks correct.
 *
 * Newly expressible 2026-09-05 (see `pair()`): needs `probeFocus` and `probeOrder`, both of which were
 * being dropped. The pair differs ONLY in the two attributes -- same fields, same labels, same order in
 * the markup -- because the failure is the DIFFERENCE between two orderings and a page that also reads
 * differently would let a model separate them on something else.
 *
 * @param {{ id: string, title: string, task: string }} spec
 */
function focusOrderPair({ id, title, task }) {
  const form = (/** @type {boolean} */ scrambled) =>
    "<form>"
    + "<p><label for=\"nm\">Full name</label><input id=\"nm\"></p>"
    + "<p><label for=\"ad\">Street address</label><input id=\"ad\"></p>"
    + "<p><label for=\"pc\">Postcode</label><input id=\"pc\"" + (scrambled ? " tabindex=\"2\"" : "") + "></p>"
    + "<p><label for=\"ph\">Telephone number</label><input id=\"ph\"" + (scrambled ? " tabindex=\"1\"" : "") + "></p>"
    + "<button type=\"submit\">Continue</button>"
    + "</form>";
  return pair({
    id,
    criterion: "2.4.3",
    subtype: "focus-order-scrambled",
    task,
    mutation: "Positive tabindex pulls Telephone and Postcode ahead of every other control, so Tab visits "
      + "them first while the page still reads in its written order.",
    badSignal: { type: "focus-order-scrambled" },
    good: page({ title, heading: title, body: form(false) }),
    bad: page({ title, heading: title, body: form(true) }),
    probeFocus: true,
    probeForms: true,
    probeOrder: "focus-first",
  });
}

/**
 * 2.1.1 — a NATIVE `<button>` carrying `tabindex="-1"`, which announces exactly as its reachable twin.
 *
 * The corpus's own note explains why this shape rather than a `div role="button"`: a checker scanning for
 * "interactive element without a tabindex" passes this without comment, and `tabindex="-1"` removes it
 * from the tab order while leaving it in the accessibility tree. So the pair announces IDENTICALLY and
 * differs only in whether a keyboard can operate it.
 *
 * THREE controls, not one, because `controlUnreachableByKeyboard` refuses any claim unless the tab cycle
 * CLOSED -- Tab wraps to the first control, so a recording that revisits its start has seen every
 * focusable, and without that the probe's stop cap is indistinguishable from a page trapping the keyboard.
 *
 * @param {{ id: string, title: string, action: string, task: string }} spec
 */
function unreachableControlPair({ id, title, action, task }) {
  const body = (/** @type {boolean} */ reachable) =>
    "<form>"
    + "<p><label for=\"ref\">Reference number</label><input id=\"ref\"></p>"
    + "<p><button type=\"button\"" + (reachable ? "" : " tabindex=\"-1\"") + ">" + action + "</button></p>"
    + "<button type=\"submit\">Save changes</button>"
    + "</form>";
  return pair({
    id,
    criterion: "2.1.1",
    subtype: "control-unreachable-by-keyboard",
    task,
    mutation: "A real button carries tabindex=\"-1\", so it announces as a button and Tab never reaches it.",
    badSignal: { type: "control-unreachable-by-keyboard" },
    good: page({ title, heading: title, body: body(true) }),
    bad: page({ title, heading: title, body: body(false) }),
    probeFocus: true,
    probeForms: true,
    probeOrder: "focus-first",
  });
}

/**
 * 2.1.2 — a field that refuses to give up focus while it is empty.
 *
 * THE MECHANISM IS CHOSEN AGAINST THE PROBE, not merely against the criterion, and the corpus paid to
 * learn this: the canonical modal trap pulls focus back to a container's FIRST control, and
 * `probeFocusOrder` cannot see that. `stalled` requires the SAME control repeated consecutively; a guard
 * cycling among several fields moves focus every press and reads as `cycled`, which is what a conformant
 * tab order does when it wraps. Refocusing ONE field produces the consecutive repeat the probe detects.
 *
 * `focusout` rather than a key handler, because it fires whatever takes focus away — Tab, Shift+Tab, a
 * click, a script. Deferred with a microtask because Chromium ignores a focus move made during focus-event
 * dispatch.
 *
 * The known limitation stays and is not worked around here: a trap that lets you cycle inside a modal for
 * ever is a real 2.1.2 failure this tool cannot distinguish from a normal tab cycle, because the probe
 * presses only Tab.
 *
 * @param {{ id: string, title: string, task: string }} spec
 */
function focusTrapPair({ id, title, task }) {
  const body = "<form><fieldset><legend>Your details</legend>"
    + "<label for=\"t1\">Full name</label><input id=\"t1\">"
    + "<label for=\"t2\">Email address</label><input id=\"t2\">"
    + "<label for=\"t3\">Postcode</label><input id=\"t3\">"
    + "<label for=\"t4\">Telephone number</label><input id=\"t4\">"
    + "<label for=\"t5\">Notes</label><input id=\"t5\">"
    + "</fieldset></form>";
  return pair({
    id,
    criterion: "2.1.2",
    subtype: "focus-trapped",
    task,
    mutation: "One field refuses to release focus while it is empty, so Tab returns to it every time and "
      + "the keyboard cannot leave.",
    badSignal: { type: "focus-trapped" },
    good: page({ title, heading: title, body }),
    bad: page({ title, heading: title, body,
      script: "document.getElementById('t3').addEventListener('focusout', (event) => {"
        + "  if (!event.target.value) { queueMicrotask(() => event.target.focus()); }"
        + "});" }),
    probeFocus: true,
    probeForms: true,
    probeOrder: "focus-first",
  });
}

/**
 * 2.4.1 — a skip link whose target is `hidden`, so focus cannot land on it however correct the link is.
 *
 * NOT "the page has no skip link", which would be wrong: W3C is explicit that 2.4.1 does not require one
 * — headings alone satisfy it (H69), landmarks alone satisfy it (ARIA11) — so detecting absence would
 * fire on conformant pages. What is assessed is a mechanism that is PRESENT AND INERT.
 *
 * This is the variant a rewrite introduces, and the reason it is the interesting one: the target keeps
 * its `tabindex="-1"`, so somebody knew the pattern, and a later change hid the wrapper. Both obvious
 * checks pass — the id resolves and the tabindex is right — and the link is still inert, because `hidden`
 * removes the element from the rendering AND from the accessibility tree.
 *
 * @param {{ id: string, title: string, task: string }} spec
 */
function inertSkipLinkPair({ id, title, task }) {
  const body = (/** @type {string} */ targetAttrs) =>
    "<a href=\"#content\">Skip to main content</a>"
    + "<nav><ul>"
    + "<li><a href=\"/news\">News and updates</a></li>"
    + "<li><a href=\"/events\">Events calendar</a></li>"
    + "<li><a href=\"/contact\">Contact the team</a></li>"
    + "</ul></nav>"
    + "<div id=\"content\"" + targetAttrs + ">"
    + "<label for=\"q\">Search the collection</label><input id=\"q\" name=\"q\">"
    + "</div>";
  return pair({
    id,
    criterion: "2.4.1",
    subtype: "skip-link-inert",
    task,
    mutation: "The skip link's target is hidden, so it is in neither the rendering nor the accessibility "
      + "tree and focus cannot land on it. The link and its href are both correct.",
    badSignal: { type: "skip-link-inert" },
    good: page({ title, heading: title, body: body(" tabindex=\"-1\"") }),
    bad: page({ title, heading: title, body: body(" tabindex=\"-1\" hidden") }),
    probeFocus: true,
    probeNavigation: true,
  });
}

/**
 * 2.4.2 — a single-page app that swaps the view and leaves the title alone.
 *
 * BOTH variants are SPAs, because a real page load cannot express this failure: the browser reads the new
 * document's title whatever the author did. The conformant one updates the title AND moves focus to the
 * new heading — they answer different questions, focus being what NVDA announces at the moment of
 * navigation and the title being what a user hears when they ask where they are.
 *
 * THE NAVIGATING LINK IS FIRST IN THE NAV, and that is a constraint of the probe rather than a design
 * choice: `probeRouteChange` quick-navs to the first link and activates it. Written the natural way round
 * both variants activated a plain fragment link, nothing changed on either, and the conformant page was
 * indistinguishable from the failing one — a fixture whose good variant cannot pass is the same defect as
 * one whose bad variant cannot fail.
 *
 * @param {{ id: string, title: string, task: string }} spec
 */
function staleRouteTitlePair({ id, title, task }) {
  const body = "<nav><ul>"
    + "<li><a href=\"#permits\" id=\"nav-permits\">Permits</a></li>"
    + "<li><a href=\"#overview\">Overview</a></li>"
    + "</ul></nav>"
    + "<div id=\"view\"><p>Opening times and directions for the Civic Office.</p></div>";
  const swap = "var view = document.getElementById('view');"
    + "document.getElementById('nav-permits').addEventListener('click', function (event) {"
    + "event.preventDefault();"
    + "history.pushState({}, '', '#permits');";
  return pair({
    id,
    criterion: "2.4.2",
    subtype: "route-title-stale",
    task,
    mutation: "The route changes and the document title does not, so the page announces the old title and "
      + "a screen-reader user has no way to learn they went anywhere.",
    badSignal: { type: "route-title-stale" },
    good: page({ title, heading: title, body,
      script: swap
        + "view.innerHTML = '<h1 id=\"landed\" tabindex=\"-1\">Permits</h1>"
        + "<p>Apply for a residents parking permit.</p>';"
        + "document.title = 'Permits - " + title + "';"
        + "document.getElementById('landed').focus();"
        + "});" }),
    bad: page({ title, heading: title, body,
      script: swap
        + "view.innerHTML = '<h1>Permits</h1>"
        + "<p>Apply for a residents parking permit.</p>';"
        + "});" }),
    probeNavigation: true,
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
  // FOUR, not three. The gate wants three positives and a capture can fail, so a set sized exactly to the
  // floor makes one transient fault look like a corpus gap -- which is the reading that cost two pipeline
  // runs to correct.
  languagePair({ id: "language-plaque", title: "Harbour plaque",
    lead: "The plaque beside the steps carries a line from the harbour's founding charter:",
    passage: "Wie op zee vaart, vertrouwt op de sterren en op elkaar.", lang: "nl", langName: "Dutch",
    task: "Read the line quoted on the harbour plaque page." }),
  languagePair({ id: "language-epitaph", title: "Churchyard survey",
    lead: "The stone is transcribed in the survey exactly as cut:",
    passage: "Aqui jaz quem viveu sem pressa e partiu sem medo.", lang: "pt", langName: "Portuguese",
    task: "Read the transcription on the churchyard survey page." }),
  languagePair({ id: "language-proverb", title: "Weaving notes",
    lead: "The workshop keeps the proverb its founder taught:",
    passage: "Kto rano wstaje, temu Pan Bog daje.", lang: "pl", langName: "Polish",
    task: "Read the proverb printed on the weaving notes page." }),
  languagePair({ id: "language-toast", title: "Guildhall dinner",
    lead: "The toast is given in the original before the meal:",
    passage: "Skal for vennskap som varer lenger enn kvelden.", lang: "no", langName: "Norwegian",
    task: "Read the toast printed on the guildhall dinner page." }),
  statusPair({ id: "status-red", title: "Colour catalogue", control: "Show red items", task: "Show red items and notice the result count." }),
  statusPair({ id: "status-large", title: "Size catalogue", control: "Show large items", task: "Show large items and notice the result count." }),
  statusPair({ id: "status-new", title: "New items", control: "Show new items", task: "Show new items and notice the result count." }),
  statusPair({ id: "status-local", title: "Local items", control: "Show local items", task: "Show local items and notice the result count." }),
  // ---- subtypes the held-out set could not previously express (2026-09-05) ----
  contextChangePair({ id: "focus-renames-page", title: "Grant enquiry", field: "Grant reference", changedTitle: "Results for the grant reference you typed", task: "Enter the grant reference and notice whether the page stays where you were.", on: "focus" }),
  contextChangePair({ id: "input-renames-page", title: "Licence enquiry", field: "Licence number", changedTitle: "Licences matching your entry", task: "Enter the licence number and notice whether the page stays where you were.", on: "input" }),
  noHeadingsPair({ id: "sections-not-headings", title: "Allotment rules", sections: ["Waiting list", "Plot sizes", "Water use"], task: "Move between the sections of the allotment rules." }),
  focusOrderPair({ id: "tab-order-contradicts-reading", title: "Delivery details", task: "Move through the delivery form with the keyboard in the order it reads." }),
  unreachableControlPair({ id: "button-off-the-tab-order", title: "Saved searches", action: "Delete this search", task: "Reach the delete action for a saved search using the keyboard alone." }),
  focusTrapPair({ id: "field-will-not-release-focus", title: "Membership form", task: "Move through the membership form and out the other side with the keyboard." }),
  inertSkipLinkPair({ id: "skip-link-target-hidden", title: "Local collection", task: "Use the skip link to reach the main content." }),
  staleRouteTitlePair({ id: "route-changes-title-does-not", title: "Civic Office", task: "Open the Permits view and confirm where you are." }),
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

