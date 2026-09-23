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
  // `3.3.2:unnamed-form-field` WAS HERE AND THE SUBTYPE NO LONGER EXISTS. It was deleted on 2026-09-05
  // and its 133 records moved to `4.1.2:unnamed-control` — W3C does not require a label to be ASSOCIATED
  // for 3.3.2, that is 1.3.1, and every one of its bad pages carried visible label text, so it had zero
  // genuine 3.3.2 failures. Five dependents were moved with it and this was the SIXTH, missed.
  //
  // It cost the whole acceptance gate. A held-out case labelled with a subtype no head predicts is not an
  // error anywhere visible — `eligible_records` simply drops it — so the 10 cases carrying it scored
  // 0.088 against a 0.668 cut and read as false negatives. And `rules:gate` cannot catch it, for the
  // reason `iconPair` records twenty lines down: that gate reads the TRAINING export and never looks at
  // the held-out set. The acceptance matrix is the one place a stale subtype survives every other check.
  "bare-edit": { markup: "<p><input name=\"ref-code\" type=\"text\"></p>",
    adds: ["4.1.2:unnamed-control"], describes: "an unlabelled field" },
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
    // TWO CRITERIA FROM ONE GENERATOR, and they are genuinely different failures — corrected 2026-09-05.
    //
    // The placeholder-only half really does fail 3.3.2: W3C treats a placeholder as an inadequate label
    // because it disappears the moment the user types, so nothing is presented to them while they enter.
    //
    // The other half does NOT. Its bad page is `<span>Company name</span><input>` — text presented to the
    // user that identifies the control, which is WCAG's definition of a label — and 3.3.2 does not require
    // a label to be marked up or ASSOCIATED, that being 1.3.1's subject. A label IS provided. All six of
    // these acceptance pairs carried it, as did all 133 corpus cases, so the count of genuine 3.3.2
    // failures in that subtype was ZERO. Worse, their `alsoFails` was empty, so they claimed a criterion
    // the page meets and omitted the one it fails.
    criterion: placeholderOnly ? "3.3.2" : "4.1.2",
    subtype: placeholderOnly ? "placeholder-only" : "unnamed-control",
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

/**
 * #1115: HELD-OUT PAIRS FOR 4.1.3'S OTHER TWO STATUS CATEGORIES.
 *
 * `acceptance-matrix.test.ts` refused the corpus cases without these, and its refusal is the right one:
 * a subtype with corpus cases and no acceptance pair means `training:evaluate-acceptance` reports
 * `passed: true` having never examined it.
 *
 * NOT ledgered as SUBTYPES_WITHOUT_ACCEPTANCE_COVERAGE, and the ledger's own entries say why that would
 * be dishonest: every one there is a subtype with NO TRAINED HEAD, where an acceptance pair would test
 * the rule instead. These two will have heads the moment #34's round captures them — so the held-out
 * measurement is exactly what they need, and skipping it is how a subtype ships unmeasured.
 *
 * SYNCHRONOUS, for the reason the corpus builders are: a polite region waits for idle, so an
 * asynchronous update announces intermittently and `gate:stability` refuses that evidence.
 *
 * @param {TitledPair & { control: string, waiting: string }} spec
 */
function waitingStatusPair({ id, title, control, waiting, task }) {
  const body = `<button id="go" type="button">${control}</button><p id="state"></p>`;
  const script = `document.querySelector('#go').addEventListener('click',()=>{document.querySelector('#state').textContent='${waiting}'})`;
  return pair({
    id,
    criterion: "4.1.3",
    subtype: "status-waiting",
    task,
    mutation: "A waiting state appears without being announced.",
    badSignal: { type: "form-activation-silent", control, expected: waiting },
    probeForms: true,
    good: page({ title, heading: title, script,
      body: body.replace('id="state"', 'id="state" role="status" aria-live="polite" aria-atomic="true"') }),
    bad: page({ title, heading: title, body, script }),
  });
}

/** @param {TitledPair & { control: string, progress: string }} spec */
function progressStatusPair({ id, title, control, progress, task }) {
  const body = `<button id="next" type="button">${control}</button><p id="progress">Step 1 of 4</p>`;
  const script = `document.querySelector('#next').addEventListener('click',()=>{document.querySelector('#progress').textContent='${progress}'})`;
  return pair({
    id,
    criterion: "4.1.3",
    subtype: "status-progress",
    task,
    mutation: "A progress indicator advances without being announced.",
    badSignal: { type: "form-activation-silent", control, expected: progress },
    probeForms: true,
    good: page({ title, heading: title, script,
      body: body.replace('id="progress"', 'id="progress" role="status" aria-live="polite" aria-atomic="true"') }),
    bad: page({ title, heading: title, body, script }),
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

/**
 * 1.4.13 Content on Hover or Focus — the DISMISSABLE bullet, on the trigger this tool can drive.
 *
 * The criterion covers "pointer hover OR KEYBOARD FOCUS" and asks, for the bullet this decides, that a
 * mechanism exist to dismiss the additional content "WITHOUT MOVING pointer hover or keyboard focus".
 * Both variants reveal a panel on focus and both obscure the content below it, so neither can take the
 * exception for content that "does not obscure or replace other content" — otherwise the conformant page
 * would pass for the wrong reason and the pair would measure the exception rather than the mechanism.
 *
 * The panel reveals a LINK because the census counts AX-tree nodes by role: new content has to arrive as a
 * node, not as restyled text, or the count is unchanged and the case is blind.
 *
 * THE PANEL WORDING IS A PARAMETER, and every value differs from the corpus's. These pairs measure
 * GENERALISATION: a passage reused from `case-matrix.mjs` would measure memorisation and report it as
 * success, which is what the held-out gate's own refusal message warns about.
 *
 * @param {{ id: string, title: string, field: string, note: string, linkText: string, task: string }} spec
 */
function focusRevealPair({ id, title, field, note, linkText, task }) {
  const body = "<form>"
    + "<p><label for=\"first\">Contact name</label><input id=\"first\"></p>"
    + "<p><label for=\"trigger\">" + field + "</label><input id=\"trigger\"></p>"
    + "<div id=\"panel\" hidden><p>" + note + "</p>"
    + "<a href=\"/help\">" + linkText + "</a></div>"
    + "<p><label for=\"last\">Daytime telephone</label><input id=\"last\"></p>"
    + "</form>";
  const reveal = "var p=document.getElementById('panel');"
    + "document.getElementById('trigger').addEventListener('focus', function(){ p.hidden = false; });";
  const dismiss = "document.addEventListener('keydown', function(e){"
    + "  if (e.key === 'Escape') { p.hidden = true; }"
    + "});";
  return pair({
    id,
    criterion: "1.4.13",
    subtype: "focus-panel-undismissable",
    task,
    mutation: "Focusing the field opens a panel over the content below, and Escape does not close it.",
    badSignal: { type: "focus-panel-undismissable" },
    good: page({ title, heading: title, body, script: reveal + dismiss }),
    bad: page({ title, heading: title, body, script: reveal }),
    probeFocus: true,
    probeFocusReveal: true,
    probeOrder: "focus-first",
  });
}

// `focusRemovedOnReceiptPair` WAS HERE and went with its corpus cases — withdrawn 2026-09-05 pending the
// 2.4.7 probe, which ran but did not discriminate on its first capture. The diagnosis and the leading
// hypothesis are in `case-matrix.mjs`, beside the cases.
//
// WITHDRAWING BOTH HALVES TOGETHER IS THE POINT. Removing only the corpus cases left three held-out pairs
// for `2.4.7:focus-removed-on-receipt`, and `acceptance-matrix.test.ts` refused at once: "acceptance pairs
// exist for subtypes the corpus never produces". That is the same defect that stopped the model chain at
// its ninth stage hours earlier — a held-out case labelled with a subtype no head predicts raises no error
// anywhere, because `eligible_records` drops it, and it surfaces as a false negative instead.
//
// The ledger caught it in one `npm test` rather than in a four-hour run, which is what the ledger is for.


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
  // TWO MORE PLACEHOLDER PAIRS, added 2026-09-05 because deleting a subtype left a criterion under-covered
  // in a way nothing pointed at. `3.3.2:unnamed-form-field` was removed and `placeholder-only` became
  // 3.3.2's ONLY subtype — at which point the criterion had two held-out positives against a gate that
  // requires three, and the gate said so as "3.3.2: fewer than 3 acceptance positives". That reads like a
  // coverage oversight and is really a consequence of the deletion nobody followed through.
  //
  // Field names and themes disjoint from the corpus's 44 `form-placeholder-*` cases, per this file's own
  // generalisation rule: a held-out case that reuses a training case's vocabulary measures memorisation.
  formPair({ id: "placeholder-postcode", title: "Delivery details", label: "Delivery postcode", name: "delivery-postcode", placeholderOnly: true, task: "Enter the delivery postcode." }),
  formPair({ id: "placeholder-reference", title: "Warranty claim", label: "Warranty reference", name: "warranty-reference", placeholderOnly: true, task: "Enter the warranty reference." }),
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
  // #1115: the held-out halves of 4.1.3's other two categories.
  waitingStatusPair({ id: "status-waiting-stock", title: "Stock check", control: "Check stock",
    waiting: "Checking stock, please wait.", task: "Check stock and notice whether anything is announced while it works." }),
  waitingStatusPair({ id: "status-waiting-postage", title: "Postage quote", control: "Check postage",
    waiting: "Checking postage, please wait.", task: "Check postage and notice whether anything is announced while it works." }),
  progressStatusPair({ id: "status-progress-application", title: "Application form", control: "Continue to step 2",
    progress: "Step 2 of 4", task: "Continue to step 2 and notice whether the step change is announced." }),
  progressStatusPair({ id: "status-progress-booking", title: "Booking form", control: "Continue to dates",
    progress: "Step 2 of 4", task: "Continue to dates and notice whether the step change is announced." }),
  statusPair({ id: "status-local", title: "Local items", control: "Show local items", task: "Show local items and notice the result count." }),
  // ---- subtypes the held-out set could not previously express (2026-09-05) ----
  contextChangePair({ id: "focus-renames-page", title: "Grant enquiry", field: "Grant reference", changedTitle: "Results for the grant reference you typed", task: "Enter the grant reference and notice whether the page stays where you were.", on: "focus" }),
  contextChangePair({ id: "input-renames-page", title: "Licence enquiry", field: "Licence number", changedTitle: "Licences matching your entry", task: "Enter the licence number and notice whether the page stays where you were.", on: "input" }),
  noHeadingsPair({ id: "sections-not-headings", title: "Allotment rules", sections: ["Waiting list", "Plot sizes", "Water use"], task: "Move between the sections of the allotment rules." }),
  focusOrderPair({ id: "tab-order-contradicts-reading", title: "Delivery details", task: "Move through the delivery form with the keyboard in the order it reads." }),
  // "Delete this entry", NOT "Delete this search" — the old wording matched SUBMIT_RE on the word
  // "search" and cost a release. `probeKindFor` classifies a control's `kind` by testing its ANNOUNCED
  // NAME against that regex, so this inert `<button type="button">` — no script, no behaviour, present
  // only to test keyboard reachability — was labelled `kind: "submit"`. `validation_error_missing` then
  // read its empty `after` as a submit that announced no error and scored 1.000 on BOTH variants, which
  // the held-out gate correctly reported as two 3.3.1 false positives.
  //
  // Its own training-corpus sibling `NATIVE_ACTION_PAGE` already says "Delete draft" and collides with
  // nothing, so the model had never seen this shape and had no benign reading to fall back on.
  //
  // The FIXTURE is renamed rather than SUBMIT_RE narrowed, deliberately. Narrowing "search" to head a
  // phrase would change how every capture ever taken classifies a control, for one wording collision —
  // an evidence change to fix a test fixture. The regex matching by NAME rather than by BEHAVIOUR is a
  // real and general weakness and belongs on the backlog, not in this commit.
  unreachableControlPair({ id: "button-off-the-tab-order", title: "Saved searches", action: "Delete this entry", task: "Reach the delete action for a saved entry using the keyboard alone." }),
  focusTrapPair({ id: "field-will-not-release-focus", title: "Membership form", task: "Move through the membership form and out the other side with the keyboard." }),
  inertSkipLinkPair({ id: "skip-link-target-hidden", title: "Local collection", task: "Use the skip link to reach the main content." }),
  staleRouteTitlePair({ id: "route-changes-title-does-not", title: "Civic Office", task: "Open the Permits view and confirm where you are." }),
  focusRevealPair({ id: "focus-panel-stuck", title: "Permit application", field: "Permit reference", note: "Your reference appears on the top right of the letter we sent you.", linkText: "Where to find your reference", task: "Focus the permit reference and try to dismiss the panel it opens." }),
  focusRevealPair({ id: "focus-panel-stuck-grant", title: "Grant claim", field: "Claim number", note: "Claim numbers begin with two letters and are eight characters long.", linkText: "What a claim number looks like", task: "Focus the claim number and try to dismiss the panel it opens." }),
  focusRevealPair({ id: "focus-panel-stuck-tenancy", title: "Tenancy check", field: "Tenancy code", note: "The code is printed beneath the barcode on your rent statement.", linkText: "Locating your tenancy code", task: "Focus the tenancy code and try to dismiss the panel it opens." }),
  // 1.4.2:autoplay-uncontrollable's held-out pair -- added the same day as the training case (#9), because
  // this file's own header says "KEEP THIS LIST EMPTY IF YOU CAN" for SUBTYPES_WITHOUT_ACCEPTANCE_COVERAGE
  // and a case here costs one entry rather than a permanent exemption. Different subject matter from
  // `media-autoplay-audio` in case-matrix.mjs, per this file's generalisation rule: a held-out case reusing
  // a training case's vocabulary measures memorisation, not discrimination.
  pair({
    id: "media-autoplay-video",
    criterion: "1.4.2",
    subtype: "autoplay-uncontrollable",
    task: "Notice what starts playing when the page opens.",
    mutation: "A video autoplays, is not muted, and exposes no controls attribute, so nothing lets a "
      + "screen-reader user pause or stop it competing with NVDA's own speech.",
    badSignal: { type: "autoplay-uncontrollable" },
    good: page({
      title: "Safety briefing",
      heading: "Safety briefing",
      body: "<p>A short safety briefing video plays automatically and can be paused or stopped at any time.</p>"
        + "<video autoplay controls "
        + "src=\"data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVl\"></video>",
    }),
    bad: page({
      title: "Safety briefing",
      heading: "Safety briefing",
      body: "<p>A short safety briefing video plays automatically and can be paused or stopped at any time.</p>"
        + "<video autoplay "
        + "src=\"data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVl\"></video>",
    }),
  }),
  // ---- #1852: growing the held-out set past 138 records (#37's next row, per #1797) ----
  // New topic vocabulary throughout (Blue Badges, growing plots, market pitches, tree work consent,
  // taxi licensing, noise complaints, fly-tipping, pools) -- distinct from both the training corpus
  // and this file's existing b2- batch, so these measure generalisation rather than memorisation.
  // Excluded from this batch: `landmarkPair`, `controlPair`, `languagePair` and `formPair` with
  // `placeholderOnly: true` -- their subtypes (`1.3.1:missing-landmark`, `4.1.2:missing-role`,
  // `3.1.2:language-unmarked`, `3.3.2:placeholder-only`) are all in `MODEL_EXCLUDED_SUBTYPES`
  // (export-screenreader-dataset.mjs), so more pairs there would not grow the exported record count.
  imagePair({ id: "b3-generic-treehouse", title: "Adventure playground", description: "The playground has a rope bridge between two towers.", file: "rope-bridge.jpg", goodAlt: "Rope bridge linking two play towers", badAlt: "image", subtype: "generic-alt", task: "Understand what the rope bridge looks like." }),
  imagePair({ id: "b3-generic-fountain", title: "Heritage trail", description: "The fountain marks the start of the heritage trail.", file: "fountain.jpg", goodAlt: "Stone fountain at the trailhead", badAlt: "photo", subtype: "generic-alt", task: "Understand what the fountain looks like." }),
  imagePair({ id: "b3-generic-greenhouse", title: "Community garden", description: "The greenhouse grows seedlings for spring planting.", file: "greenhouse.jpg", goodAlt: "Glass greenhouse with rows of seedling trays", badAlt: "picture", subtype: "generic-alt", task: "Understand what the greenhouse looks like." }),
  imagePair({ id: "b3-filename-towpath", title: "Canal towpath map", description: "The towpath entrance is beside the lock keeper's cottage.", file: "towpath-entrance-12.jpg", goodAlt: "Entrance to the canal towpath beside the lock cottage", badAlt: "towpath-entrance-12.jpg", subtype: "filename-alt", task: "Find the canal towpath entrance." }),
  imagePair({ id: "b3-filename-birdhide", title: "Nature reserve guide", description: "The bird hide overlooks the reed bed.", file: "bird_hide_04.jpg", goodAlt: "Timber bird hide overlooking the reed bed", badAlt: "bird_hide_04.jpg", subtype: "filename-alt", task: "Find the bird hide." }),
  imagePair({ id: "b3-filename-vineyard", title: "Vineyard trail map", description: "The vineyard gate marks the start of the tasting trail.", file: "vineyard-gate-09.jpg", goodAlt: "Gate at the start of the vineyard tasting trail", badAlt: "vineyard-gate-09.jpg", subtype: "filename-alt", task: "Find the vineyard gate." }),
  imagePair({ id: "b3-missing-bandstand", title: "Park events", description: "The bandstand hosts concerts on summer weekends.", file: "bandstand.png", goodAlt: "Painted bandstand in the park", badAlt: null, subtype: "missing-alt", task: "Understand what the bandstand looks like." }),
  imagePair({ id: "b3-missing-lighthouse", title: "Coastal walk", description: "The lighthouse marks the harbour entrance.", file: "lighthouse.png", goodAlt: "White lighthouse at the harbour entrance", badAlt: null, subtype: "missing-alt", task: "Understand what the lighthouse looks like." }),
  imagePair({ id: "b3-missing-windmill", title: "Heritage windmill", description: "The windmill still turns on windy days.", file: "windmill.png", goodAlt: "Timber windmill with its sails turning", badAlt: null, subtype: "missing-alt", task: "Understand what the windmill looks like." }),
  linkPair({ id: "b3-link-recycling", title: "Waste services", context: "Household recycling is collected on alternate weeks.", vague: "Here", descriptive: "Check your recycling collection day", task: "Check your recycling collection day." }),
  linkPair({ id: "b3-link-pool", title: "Leisure centre", context: "The pool has reduced hours in January.", vague: "More", descriptive: "Read the pool's January opening hours", task: "Read the pool's January opening hours." }),
  linkPair({ id: "b3-link-badge", title: "Parking services", context: "Blue Badge holders can renew online.", vague: "Click", descriptive: "Renew a Blue Badge online", task: "Renew a Blue Badge online." }),
  linkPair({ id: "b3-link-flytipping", title: "Environmental enforcement", context: "Fly-tipping can be reported with a photo.", vague: "This", descriptive: "Report fly-tipping with a photo", task: "Report fly-tipping with a photo." }),
  linkPair({ id: "b3-link-treework", title: "Tree services", context: "Tree work near a protected oak needs consent.", vague: "Info", descriptive: "Apply for tree work consent", task: "Apply for tree work consent." }),
  linkPair({ id: "b3-link-taxi", title: "Licensing office", context: "Taxi drivers renew their licence every year.", vague: "Go", descriptive: "Renew a taxi driver's licence", task: "Renew a taxi driver's licence." }),
  linkPair({ id: "b3-link-plot", title: "Growing plots", context: "A growing plot becomes free most winters.", vague: "Details", descriptive: "Join the growing plot waiting list", task: "Join the growing plot waiting list." }),
  linkPair({ id: "b3-link-noise", title: "Environmental health", context: "Noise complaints are logged by the environmental team.", vague: "Here", descriptive: "Log a noise complaint", task: "Log a noise complaint." }),
  headingPair({ id: "b3-heading-recycling", title: "Recycling guide", vague: "Info", descriptive: "What goes in each bin", task: "Find what goes in each bin." }),
  headingPair({ id: "b3-heading-pool", title: "Pool guide", vague: "Notes", descriptive: "Lane swimming times", task: "Find the lane swimming times." }),
  headingPair({ id: "b3-heading-badge", title: "Blue Badge guide", vague: "Details", descriptive: "Who can apply for a Blue Badge", task: "Find who can apply for a Blue Badge." }),
  headingPair({ id: "b3-heading-flytipping", title: "Fly-tipping guide", vague: "Stuff", descriptive: "How to report fly-tipping", task: "Find how to report fly-tipping." }),
  headingPair({ id: "b3-heading-treework", title: "Tree work guide", vague: "Overview", descriptive: "When consent is required", task: "Find when consent is required." }),
  headingPair({ id: "b3-heading-taxi", title: "Taxi licence guide", vague: "General", descriptive: "Documents needed to renew", task: "Find the documents needed to renew." }),
  headingPair({ id: "b3-heading-plot", title: "Growing plot guide", vague: "Welcome", descriptive: "Joining the waiting list", task: "Find how to join the waiting list." }),
  headingPair({ id: "b3-heading-noise", title: "Noise complaints guide", vague: "Things", descriptive: "What counts as a statutory nuisance", task: "Find what counts as a statutory nuisance." }),
  fakeHeadingPair({ id: "b3-fake-recycling", title: "Waste services", label: "Collection days", task: "Find the collection days." }),
  fakeHeadingPair({ id: "b3-fake-pool", title: "Leisure centre", label: "Opening hours", task: "Find the opening hours." }),
  fakeHeadingPair({ id: "b3-fake-badge", title: "Parking services", label: "Eligibility criteria", task: "Find the eligibility criteria." }),
  fakeHeadingPair({ id: "b3-fake-treework", title: "Tree services", label: "Consent process", task: "Find the consent process." }),
  fakeHeadingPair({ id: "b3-fake-taxi", title: "Licensing office", label: "Renewal steps", task: "Find the renewal steps." }),
  fakeHeadingPair({ id: "b3-fake-noise", title: "Environmental health", label: "How to complain", task: "Find how to complain." }),
  tablePair({ id: "b3-table-library", title: "Mobile library stops", destination: "Riverside green", task: "Compare the mobile library time and destination for Riverside green." }),
  tablePair({ id: "b3-table-pool", title: "Swim lesson times", destination: "Learner pool", task: "Compare the swim lesson time and destination for Learner pool." }),
  tablePair({ id: "b3-table-bins", title: "Bin collection rota", destination: "Elm Street", task: "Compare the bin collection time and destination for Elm Street." }),
  tablePair({ id: "b3-table-market", title: "Market stall pitches", destination: "Town square", task: "Compare the market stall time and destination for Town square." }),
  tablePair({ id: "b3-table-parkrun", title: "Park run results", destination: "Meadow loop", task: "Compare the park run time and destination for Meadow loop." }),
  tablePair({ id: "b3-table-tennis", title: "Tennis court bookings", destination: "Court 3", task: "Compare the tennis court time and destination for Court 3." }),
  errorPair({ id: "b3-error-plot", title: "Growing plot request", field: "Plot size", submit: "Request the plot", task: "Submit the growing plot request without a plot size." }),
  errorPair({ id: "b3-error-badge", title: "Blue Badge application", field: "National Insurance number", submit: "Apply for the badge", task: "Submit the Blue Badge application without a National Insurance number." }),
  errorPair({ id: "b3-error-market", title: "Market stall booking", field: "Stall number", submit: "Book the stall", task: "Submit the stall booking without a stall number." }),
  errorPair({ id: "b3-error-pool", title: "Swim lesson booking", field: "Child's age", submit: "Book the lesson", task: "Submit the swim lesson booking without a child's age." }),
  errorPair({ id: "b3-error-flytipping", title: "Fly-tipping report", field: "Location description", submit: "Submit the report", task: "Submit the fly-tipping report without a location description." }),
  errorPair({ id: "b3-error-noise", title: "Noise complaint", field: "Time of the noise", submit: "Submit the complaint", task: "Submit the noise complaint without a time." }),
  errorPair({ id: "b3-error-taxi", title: "Taxi licence renewal", field: "Badge number", submit: "Renew the licence", task: "Submit the taxi licence renewal without a badge number." }),
  errorPair({ id: "b3-error-tree", title: "Tree work application", field: "Tree reference", submit: "Submit the application", task: "Submit the tree work application without a tree reference." }),
  errorRemedyPair({ id: "b3-remedy-plot", title: "Growing plot renewal", field: "Plot size", submit: "Request the plot", remedy: "Enter the plot size in square metres.", problemOnly: "Invalid entry.", task: "Request a growing plot with an unusable plot size." }),
  errorRemedyPair({ id: "b3-remedy-badge", title: "Blue Badge renewal", field: "National Insurance number", submit: "Apply for the badge", remedy: "Enter the number as two letters six digits and one letter.", problemOnly: "Invalid entry.", task: "Renew a Blue Badge with a malformed National Insurance number." }),
  errorRemedyPair({ id: "b3-remedy-market", title: "Market pitch booking", field: "Stall number", submit: "Book the stall", remedy: "Enter the stall number shown on the market map.", problemOnly: "Invalid entry.", task: "Book a market stall with an unrecognised stall number." }),
  errorRemedyPair({ id: "b3-remedy-pool", title: "Swim lesson booking", field: "Child's age", submit: "Book the lesson", remedy: "Enter the child's age in years.", problemOnly: "Invalid entry.", task: "Book a swim lesson with an unusable age." }),
  errorRemedyPair({ id: "b3-remedy-flytipping", title: "Fly-tipping report", field: "Location description", submit: "Submit the report", remedy: "Describe the location using a nearby street name.", problemOnly: "Invalid entry.", task: "Submit a fly-tipping report with a location description that is too short." }),
  errorRemedyPair({ id: "b3-remedy-noise", title: "Noise complaint", field: "Time of the noise", submit: "Submit the complaint", remedy: "Enter the time using hours and minutes.", problemOnly: "Invalid entry.", task: "Submit a noise complaint with an unusable time." }),
  errorRemedyPair({ id: "b3-remedy-taxi", title: "Taxi licence renewal", field: "Badge number", submit: "Renew the licence", remedy: "Enter the badge number printed on the plate.", problemOnly: "Invalid entry.", task: "Renew a taxi licence with an unrecognised badge number." }),
  errorRemedyPair({ id: "b3-remedy-tree", title: "Tree work application", field: "Tree reference", submit: "Submit the application", remedy: "Enter the tree reference shown on the survey letter.", problemOnly: "Invalid entry.", task: "Submit a tree work application with an unrecognised tree reference." }),
  formPair({ id: "b3-field-badge", title: "Blue Badge form", label: "Badge number", name: "badge-number", task: "Enter the Blue Badge number." }),
  formPair({ id: "b3-field-plot", title: "Growing plot form", label: "Plot number", name: "plot-number", task: "Enter the growing plot number." }),
  formPair({ id: "b3-field-stall", title: "Market stall form", label: "Stall number", name: "stall-number", task: "Enter the market stall number." }),
  formPair({ id: "b3-field-tree", title: "Tree work form", label: "Tree reference", name: "tree-reference", task: "Enter the tree reference." }),
  formPair({ id: "b3-field-noise", title: "Noise complaint form", label: "Complaint reference", name: "complaint-reference", task: "Enter the complaint reference." }),
  formPair({ id: "b3-field-taxi", title: "Taxi vehicle form", label: "Vehicle registration", name: "vehicle-registration", task: "Enter the taxi's vehicle registration." }),
  iconPair({ id: "b3-icon-filters", title: "Filters", label: "Open filters", task: "Open filters." }),
  iconPair({ id: "b3-icon-menu", title: "Navigation menu", label: "Open menu", task: "Open the menu." }),
  iconPair({ id: "b3-icon-notifications", title: "Notifications", label: "Open notifications", task: "Open notifications." }),
  iconPair({ id: "b3-icon-help", title: "Help", label: "Open help", task: "Open help." }),
  iconPair({ id: "b3-icon-profile", title: "Account", label: "Open your account", task: "Open your account." }),
  iconPair({ id: "b3-icon-print", title: "Print", label: "Print this page", task: "Print this page." }),
  disclosurePair({ id: "b3-disclosure-badge", title: "Blue Badge", control: "Blue Badge eligibility", task: "Open the Blue Badge eligibility details." }),
  disclosurePair({ id: "b3-disclosure-plot", title: "Growing plots", control: "Growing plot rules", task: "Open the growing plot rules." }),
  disclosurePair({ id: "b3-disclosure-market", title: "Market stalls", control: "Market stall fees", task: "Open the market stall fees." }),
  disclosurePair({ id: "b3-disclosure-flytipping", title: "Fly-tipping", control: "Fly-tipping penalties", task: "Open the fly-tipping penalties." }),
  disclosurePair({ id: "b3-disclosure-noise", title: "Noise complaints", control: "Noise complaint process", task: "Open the noise complaint process." }),
  disclosurePair({ id: "b3-disclosure-tree", title: "Tree work", control: "Tree work consent", task: "Open the tree work consent details." }),
  waitingStatusPair({ id: "b3-status-waiting-badge", title: "Blue Badge check", control: "Check eligibility", waiting: "Checking eligibility, please wait.", task: "Check eligibility and notice whether anything is announced while it works." }),
  waitingStatusPair({ id: "b3-status-waiting-plot", title: "Plot availability", control: "Check availability", waiting: "Checking plot availability, please wait.", task: "Check plot availability and notice whether anything is announced while it works." }),
  waitingStatusPair({ id: "b3-status-waiting-market", title: "Pitch availability", control: "Check pitch", waiting: "Checking pitch availability, please wait.", task: "Check pitch availability and notice whether anything is announced while it works." }),
  waitingStatusPair({ id: "b3-status-waiting-tree", title: "Consent check", control: "Check consent", waiting: "Checking consent records, please wait.", task: "Check consent records and notice whether anything is announced while it works." }),
  waitingStatusPair({ id: "b3-status-waiting-taxi", title: "Licence check", control: "Check licence", waiting: "Checking licence records, please wait.", task: "Check licence records and notice whether anything is announced while it works." }),
  progressStatusPair({ id: "b3-status-progress-badge", title: "Blue Badge application", control: "Continue to documents", progress: "Step 2 of 3", task: "Continue to documents and notice whether the step change is announced." }),
  progressStatusPair({ id: "b3-status-progress-plot", title: "Growing plot application", control: "Continue to payment", progress: "Step 2 of 3", task: "Continue to payment and notice whether the step change is announced." }),
  progressStatusPair({ id: "b3-status-progress-market", title: "Market pitch application", control: "Continue to stall choice", progress: "Step 2 of 3", task: "Continue to stall choice and notice whether the step change is announced." }),
  progressStatusPair({ id: "b3-status-progress-tree", title: "Tree work application", control: "Continue to survey", progress: "Step 2 of 3", task: "Continue to survey and notice whether the step change is announced." }),
  progressStatusPair({ id: "b3-status-progress-taxi", title: "Taxi licence application", control: "Continue to vehicle details", progress: "Step 2 of 3", task: "Continue to vehicle details and notice whether the step change is announced." }),
  statusPair({ id: "b3-status-badge", title: "Blue Badge register", control: "Show approved badges", task: "Show approved badges and notice the result count." }),
  statusPair({ id: "b3-status-plot", title: "Growing plots", control: "Show available plots", task: "Show available plots and notice the result count." }),
  statusPair({ id: "b3-status-market", title: "Market pitches", control: "Show open pitches", task: "Show open pitches and notice the result count." }),
  statusPair({ id: "b3-status-tree", title: "Protected trees", control: "Show protected trees", task: "Show protected trees and notice the result count." }),
  statusPair({ id: "b3-status-taxi", title: "Licensed taxis", control: "Show licensed taxis", task: "Show licensed taxis and notice the result count." }),
  contextChangePair({ id: "b3-focus-badge", title: "Blue Badge enquiry", field: "Badge reference", changedTitle: "Results for the badge reference you typed", task: "Enter the badge reference and notice whether the page stays where you were.", on: "focus" }),
  contextChangePair({ id: "b3-input-plot", title: "Plot enquiry", field: "Plot number", changedTitle: "Plots matching your entry", task: "Enter the plot number and notice whether the page stays where you were.", on: "input" }),
  contextChangePair({ id: "b3-focus-market", title: "Stall enquiry", field: "Stall number", changedTitle: "Results for the stall number you typed", task: "Enter the stall number and notice whether the page stays where you were.", on: "focus" }),
  contextChangePair({ id: "b3-input-tree", title: "Tree reference enquiry", field: "Tree reference", changedTitle: "Records matching your entry", task: "Enter the tree reference and notice whether the page stays where you were.", on: "input" }),
  contextChangePair({ id: "b3-focus-taxi", title: "Taxi licence enquiry", field: "Badge number", changedTitle: "Results for the badge number you typed", task: "Enter the badge number and notice whether the page stays where you were.", on: "focus" }),
  contextChangePair({ id: "b3-input-noise", title: "Noise complaint enquiry", field: "Complaint reference", changedTitle: "Complaints matching your entry", task: "Enter the complaint reference and notice whether the page stays where you were.", on: "input" }),
  noHeadingsPair({ id: "b3-sections-recycling", title: "Recycling rules", sections: ["Collection days", "What goes where", "Missed bins"], task: "Move between the sections of the recycling rules." }),
  noHeadingsPair({ id: "b3-sections-pool", title: "Pool timetable", sections: ["Lane swimming", "Lessons", "Closures"], task: "Move between the sections of the pool timetable." }),
  noHeadingsPair({ id: "b3-sections-market", title: "Market rules", sections: ["Pitch fees", "Trading hours", "Waste"], task: "Move between the sections of the market rules." }),
  noHeadingsPair({ id: "b3-sections-tree", title: "Tree work rules", sections: ["When consent is needed", "How to apply", "Appeals"], task: "Move between the sections of the tree work rules." }),
  noHeadingsPair({ id: "b3-sections-taxi", title: "Taxi licensing rules", sections: ["Vehicle standards", "Driver checks", "Renewals"], task: "Move between the sections of the taxi licensing rules." }),
  noHeadingsPair({ id: "b3-sections-noise", title: "Noise complaint rules", sections: ["What counts as noise", "How to complain", "What happens next"], task: "Move between the sections of the noise complaint rules." }),
  focusOrderPair({ id: "b3-tab-order-plot", title: "Growing plot form", task: "Move through the growing plot form with the keyboard in the order it reads." }),
  focusOrderPair({ id: "b3-tab-order-market", title: "Market stall form", task: "Move through the market stall form with the keyboard in the order it reads." }),
  focusOrderPair({ id: "b3-tab-order-badge", title: "Blue Badge form", task: "Move through the Blue Badge form with the keyboard in the order it reads." }),
  focusOrderPair({ id: "b3-tab-order-tree", title: "Tree work form", task: "Move through the tree work form with the keyboard in the order it reads." }),
  focusOrderPair({ id: "b3-tab-order-taxi", title: "Taxi licence form", task: "Move through the taxi licence form with the keyboard in the order it reads." }),
  focusOrderPair({ id: "b3-tab-order-noise", title: "Noise complaint form", task: "Move through the noise complaint form with the keyboard in the order it reads." }),
  focusOrderPair({ id: "b3-tab-order-pool", title: "Swim lesson form", task: "Move through the swim lesson form with the keyboard in the order it reads." }),
  focusOrderPair({ id: "b3-tab-order-flytipping", title: "Fly-tipping report form", task: "Move through the fly-tipping report form with the keyboard in the order it reads." }),
  unreachableControlPair({ id: "b3-button-plot", title: "Growing plot list", action: "Withdraw this application", task: "Reach the withdraw action for a growing plot entry using the keyboard alone." }),
  unreachableControlPair({ id: "b3-button-market", title: "Market pitch list", action: "Cancel this booking", task: "Reach the cancel action for a market pitch entry using the keyboard alone." }),
  unreachableControlPair({ id: "b3-button-badge", title: "Blue Badge list", action: "Report this badge lost", task: "Reach the report-lost action for a badge entry using the keyboard alone." }),
  unreachableControlPair({ id: "b3-button-tree", title: "Tree survey list", action: "Flag this record", task: "Reach the flag action for a tree survey entry using the keyboard alone." }),
  unreachableControlPair({ id: "b3-button-taxi", title: "Taxi licence list", action: "Suspend this licence", task: "Reach the suspend action for a taxi licence entry using the keyboard alone." }),
  unreachableControlPair({ id: "b3-button-noise", title: "Noise complaint list", action: "Close this complaint", task: "Reach the close action for a noise complaint entry using the keyboard alone." }),
  unreachableControlPair({ id: "b3-button-pool", title: "Swim lesson list", action: "Cancel this lesson", task: "Reach the cancel action for a swim lesson entry using the keyboard alone." }),
  unreachableControlPair({ id: "b3-button-flytipping", title: "Fly-tipping report list", action: "Archive this report", task: "Reach the archive action for a fly-tipping report using the keyboard alone." }),
  focusTrapPair({ id: "b3-trap-plot", title: "Growing plot form", task: "Move through the growing plot form and out the other side with the keyboard." }),
  focusTrapPair({ id: "b3-trap-market", title: "Market pitch form", task: "Move through the market pitch form and out the other side with the keyboard." }),
  focusTrapPair({ id: "b3-trap-badge", title: "Blue Badge form", task: "Move through the Blue Badge form and out the other side with the keyboard." }),
  focusTrapPair({ id: "b3-trap-tree", title: "Tree work form", task: "Move through the tree work form and out the other side with the keyboard." }),
  focusTrapPair({ id: "b3-trap-taxi", title: "Taxi licence form", task: "Move through the taxi licence form and out the other side with the keyboard." }),
  focusTrapPair({ id: "b3-trap-noise", title: "Noise complaint form", task: "Move through the noise complaint form and out the other side with the keyboard." }),
  focusTrapPair({ id: "b3-trap-pool", title: "Swim lesson form", task: "Move through the swim lesson form and out the other side with the keyboard." }),
  focusTrapPair({ id: "b3-trap-flytipping", title: "Fly-tipping report form", task: "Move through the fly-tipping report form and out the other side with the keyboard." }),
  inertSkipLinkPair({ id: "b3-skip-plot", title: "Growing plots", task: "Use the skip link to reach the main content." }),
  inertSkipLinkPair({ id: "b3-skip-market", title: "Market pitches", task: "Use the skip link to reach the main content." }),
  inertSkipLinkPair({ id: "b3-skip-badge", title: "Blue Badge service", task: "Use the skip link to reach the main content." }),
  inertSkipLinkPair({ id: "b3-skip-tree", title: "Tree services", task: "Use the skip link to reach the main content." }),
  inertSkipLinkPair({ id: "b3-skip-taxi", title: "Taxi licensing", task: "Use the skip link to reach the main content." }),
  inertSkipLinkPair({ id: "b3-skip-noise", title: "Environmental health", task: "Use the skip link to reach the main content." }),
  inertSkipLinkPair({ id: "b3-skip-pool", title: "Leisure centre", task: "Use the skip link to reach the main content." }),
  inertSkipLinkPair({ id: "b3-skip-flytipping", title: "Waste enforcement", task: "Use the skip link to reach the main content." }),
  staleRouteTitlePair({ id: "b3-route-plot", title: "Growing Plots Office", task: "Open the Permits view and confirm where you are." }),
  staleRouteTitlePair({ id: "b3-route-market", title: "Market Services", task: "Open the Permits view and confirm where you are." }),
  staleRouteTitlePair({ id: "b3-route-badge", title: "Blue Badge Service", task: "Open the Permits view and confirm where you are." }),
  staleRouteTitlePair({ id: "b3-route-tree", title: "Tree Services", task: "Open the Permits view and confirm where you are." }),
  staleRouteTitlePair({ id: "b3-route-taxi", title: "Licensing Office", task: "Open the Permits view and confirm where you are." }),
  staleRouteTitlePair({ id: "b3-route-noise", title: "Environmental Health", task: "Open the Permits view and confirm where you are." }),
  staleRouteTitlePair({ id: "b3-route-pool", title: "Leisure Services", task: "Open the Permits view and confirm where you are." }),
  staleRouteTitlePair({ id: "b3-route-flytipping", title: "Waste Enforcement", task: "Open the Permits view and confirm where you are." }),
  focusRevealPair({ id: "b3-focus-panel-plot", title: "Growing plot renewal", field: "Plot reference", note: "Your plot reference is on the letter confirming your allocation.", linkText: "Where to find your plot reference", task: "Focus the plot reference and try to dismiss the panel it opens." }),
  focusRevealPair({ id: "b3-focus-panel-market", title: "Market pitch renewal", field: "Pitch reference", note: "Pitch references are printed on your trading licence.", linkText: "Locating your pitch reference", task: "Focus the pitch reference and try to dismiss the panel it opens." }),
  focusRevealPair({ id: "b3-focus-panel-badge", title: "Blue Badge renewal", field: "Badge reference", note: "The badge reference is on the back of the badge.", linkText: "Where to find your badge reference", task: "Focus the badge reference and try to dismiss the panel it opens." }),
  focusRevealPair({ id: "b3-focus-panel-tree", title: "Tree work consent", field: "Application reference", note: "Your application reference was emailed after you applied.", linkText: "Finding your application reference", task: "Focus the application reference and try to dismiss the panel it opens." }),
  focusRevealPair({ id: "b3-focus-panel-taxi", title: "Taxi licence renewal", field: "Licence reference", note: "The licence reference is printed on your current badge.", linkText: "Locating your licence reference", task: "Focus the licence reference and try to dismiss the panel it opens." }),
  pair({
    id: "b3-media-autoplay-announcement",
    criterion: "1.4.2",
    subtype: "autoplay-uncontrollable",
    task: "Notice what starts playing when the page opens.",
    mutation: "A video autoplays, is not muted, and exposes no controls attribute, so nothing lets a "
      + "screen-reader user pause or stop it competing with NVDA's own speech.",
    badSignal: { type: "autoplay-uncontrollable" },
    good: page({
      title: "Service update",
      heading: "Service update",
      body: "<p>A short service update video plays automatically and can be paused or stopped at any time.</p>"
        + "<video autoplay controls "
        + "src=\"data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVl\"></video>",
    }),
    bad: page({
      title: "Service update",
      heading: "Service update",
      body: "<p>A short service update video plays automatically and can be paused or stopped at any time.</p>"
        + "<video autoplay "
        + "src=\"data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVl\"></video>",
    }),
  }),
  pair({
    id: "b3-media-autoplay-tour",
    criterion: "1.4.2",
    subtype: "autoplay-uncontrollable",
    task: "Notice what starts playing when the page opens.",
    mutation: "A video autoplays, is not muted, and exposes no controls attribute, so nothing lets a "
      + "screen-reader user pause or stop it competing with NVDA's own speech.",
    badSignal: { type: "autoplay-uncontrollable" },
    good: page({
      title: "Virtual tour",
      heading: "Virtual tour",
      body: "<p>A short virtual tour video plays automatically and can be paused or stopped at any time.</p>"
        + "<video autoplay controls "
        + "src=\"data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVl\"></video>",
    }),
    bad: page({
      title: "Virtual tour",
      heading: "Virtual tour",
      body: "<p>A short virtual tour video plays automatically and can be paused or stopped at any time.</p>"
        + "<video autoplay "
        + "src=\"data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVl\"></video>",
    }),
  }),
  pair({
    id: "b3-media-autoplay-induction",
    criterion: "1.4.2",
    subtype: "autoplay-uncontrollable",
    task: "Notice what starts playing when the page opens.",
    mutation: "A video autoplays, is not muted, and exposes no controls attribute, so nothing lets a "
      + "screen-reader user pause or stop it competing with NVDA's own speech.",
    badSignal: { type: "autoplay-uncontrollable" },
    good: page({
      title: "Gym induction",
      heading: "Gym induction",
      body: "<p>A short gym induction video plays automatically and can be paused or stopped at any time.</p>"
        + "<video autoplay controls "
        + "src=\"data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVl\"></video>",
    }),
    bad: page({
      title: "Gym induction",
      heading: "Gym induction",
      body: "<p>A short gym induction video plays automatically and can be paused or stopped at any time.</p>"
        + "<video autoplay "
        + "src=\"data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVl\"></video>",
    }),
  }),
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

