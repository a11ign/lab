// @ts-check
/**
 * Signal predicates: pure functions that read a CAPTURE and answer "did this signal fire".
 *
 * Split out of `case-matrix.mjs`, where they sat directly after `CASES` with no dependency running
 * either direction across that boundary -- the case-authoring machinery never reads a capture, and
 * these never build a page. `check-signals.mjs` is the consumer: it evaluates `SIGNAL_PREDICATES`
 * (via `signalMatches`) against real and synthetic captures to prove each case's `badSignal` fires on
 * the bad page and stays silent on the good one.
 */
import { parseAnnouncement } from "@a11y-witness/evidence";

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
 * Did NVDA announce a language change anywhere in what it said?
 *
 * NVDA speaks the language name when `[speech] reportLanguage` is on and the document language changes —
 * "French", not the BCP-47 tag — so the transcript is matched against the NAME the case declares.
 *
 * Word-bounded and case-insensitive, for a reason this repo has paid for twice. `SUBMIT_RE` matches
 * `\bbook\b` and so does NOT match "booking", which was right; and `isImage` once matched the word
 * *image* inside markup NVDA had read aloud character by character. A bare `includes` here would fire on
 * any page whose prose happens to contain the language's name — a page ABOUT France, say — and that
 * finding would be our own substring rather than NVDA's announcement.
 *
 * @returns {boolean} true when the language was NOT announced, which is the failure
 */
function languageIsUnannounced(/** @type {any} */ capture, /** @type {any} */ signal) {
  const name = String(signal?.language ?? "").trim();
  // NO NAME, NO CLAIM. A signal that cannot say which language it expects would otherwise report every
  // page as failing, which is the "a check that examines nothing still passes" shape.
  if (name === "") return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !spokenText(capture).some((line) => new RegExp(`\\b${escaped}\\b`, "i").test(line));
}

/**
 * EVERYTHING NVDA SAID during a capture — the read-through and every sweep, as lines.
 *
 * Extracted when a SECOND predicate needed it, rather than copied. Two signals now ask "did NVDA ever say
 * X?", and each answering it from its own idea of where speech lives is how the announcement grammar came
 * to have seven partial regexes across three languages before `announcement.ts` replaced them.
 *
 * Both channels, deliberately. A sweep line is speech too: NVDA announced it, this project recorded it,
 * and a signal reading only `transcript` would miss anything said while walking the page — which for an
 * emphasis or a language change inside a heading or a link is exactly where it would be said.
 *
 * @param {any} capture
 * @returns {string[]}
 */
function spokenText(capture) {
  return [
    ...(capture?.transcript ?? []),
    ...Object.values(capture?.structure ?? {}).flatMap((v) => (Array.isArray(v) ? v : [])),
  ].map((line) => String(line));
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
  // THROUGH THE GRAMMAR, NOT A HAND-ROLLED PREFIX STRIP — corrected 2026-09-05 after a browser upgrade
  // broke it. This read `value.replace(/^form,\s*/, "")`, which knew exactly ONE container prefix by name.
  // `w3c/html-aria#423` made the `form` role conditional on an accessible name, Edge 152 implemented it,
  // and an unnamed `<form>` began announcing as "section" — so the strip missed, the placeholder was no
  // longer at the start, and 18 cases went BLIND at the gate.
  //
  // `announcement.ts`'s own header lists this failure among the four it was written to end: "signal regexes
  // broke whenever a container prefix appeared in front of the text they matched". The grammar already
  // separates containers from the object; asking it is what stops the next container word doing this again.
  //
  // The DISCRIMINATION is unchanged and is the point of the case: a NAMED field carrying the placeholder as
  // its VALUE ("Booking reference, edit, name at example dot com") parses to name "Booking reference", so
  // it does not match — only a field whose NAME is the placeholder does.
  return captureTextParts(capture).some((value) => {
    const [object] = parseAnnouncement(String(value), "sweep").objects;
    if (!object) return false;
    const name = String(object.name || "").toLowerCase().replace(/[\s,]+/g, " ").trim();
    return name.startsWith(placeholder) && /\bedit(?: text)?\b/i.test(String(object.role || ""));
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
/**
 * 1.4.13 — content appeared on focus and Escape did not remove it, with focus never moving.
 *
 * Reads `interaction.focusReveal`, which `focusRevealVerdict` produced on the worker. The verdict is
 * computed there rather than here on purpose: three censuses and two focus reads are the probe's business,
 * and a signal that re-derived them would be a second copy of the same judgement.
 *
 * ABSENT means the probe never ran and the signal makes NO claim -- `asked: false` and a missing field are
 * both "nobody looked", which is not the same as "nothing appeared". `revealed: null` is the third state,
 * a census that did not answer, and it is equally not a finding.
 */
function focusPanelUndismissable(/** @type {any} */ capture) {
  const v = capture.interaction?.focusReveal;
  if (!v || v.revealed !== true) return false;
  // FOCUS MUST HAVE HELD. If Escape moved focus, the page did not demonstrate the mechanism the criterion
  // names -- "dismiss ... WITHOUT MOVING pointer hover or keyboard focus" -- and calling that a failure
  // would accuse a page for the wrong reason.
  return v.focusHeld === true && v.dismissed === false;
}

/**
 * F55 -- a control that received focus and had it removed by script before anything else happened.
 *
 * Reads `interaction.focusEvents`, which `focusEventVerdict` produced on the worker from the DOM's own
 * `focusin`/`focusout` log -- computed there rather than here for the same reason `focusPanelUndismissable`
 * above reads `focusReveal` rather than re-deriving it: the timing judgement belongs with the probe that
 * took the measurement, not with a second copy of it in the corpus layer.
 *
 * `checked !== true` means the oracle never ran (the field is absent) or could not be read (`checked:
 * false`, distinct from the finding array itself being empty) -- ABSENT, not a reading of zero, the same
 * distinction `focusRevealVerdict`'s own `revealed: null` exists to preserve one probe over.
 */
function focusRemovedOnReceipt(/** @type {any} */ capture) {
  const v = capture.interaction?.focusEvents;
  if (!v || v.checked !== true) return false;
  return Array.isArray(v.scriptRemovedFocus) && v.scriptRemovedFocus.length > 0;
}

/**
 * 1.4.2 -- audio or video that autoplays with neither native controls nor a mute.
 *
 * Reads `capture.media`, the DOM-only census `addAutoplayingAudio` (`rules.ts`) also reads -- `autoplay`
 * and `muted` have no accessibility-tree equivalent, so this is the one signal here that is not about what
 * NVDA said. DELIBERATELY DUPLICATED rather than imported, on the same basis `contextChanged` and
 * `focusRevealUndismissable` already are in `rules.ts`: this package does not depend on `packages/judge`,
 * and the condition is three field reads -- cheaper to state twice, in the two languages the packages are,
 * than to cross that boundary for.
 *
 * ABSENT (`capture.media` missing or empty) is not a finding -- only a probe's silence would be, and this
 * census runs unconditionally, so an empty array here means the page genuinely has no `<audio>`/`<video>`,
 * which is correctly not a 1.4.2 case.
 *
 * The criterion's own two gaps stay gaps here too, matching `rules.ts`'s stated scope: this cannot tell a
 * looping soundtrack from a three-second chime (duration is not a DOM attribute), and cannot recognise a
 * custom volume slider as the criterion's other alternative to native `controls`.
 */
function autoplayUncontrollable(/** @type {any} */ capture) {
  const elements = Array.isArray(capture.media) ? capture.media : [];
  return elements.some((/** @type {any} */ el) => el?.autoplay && !el?.muted && !el?.controls);
}

const SIGNAL_PREDICATES = Object.freeze({
  "autoplay-uncontrollable": (/** @type {any} */ capture) => autoplayUncontrollable(capture),
  "focus-panel-undismissable": (/** @type {any} */ capture) => focusPanelUndismissable(capture),
  "focus-removed-on-receipt": (/** @type {any} */ capture) => focusRemovedOnReceipt(capture),
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
  // 3.1.2 — did NVDA ANNOUNCE the language, or only change voice?
  //
  // Reads the TRANSCRIPT, never the page source. The whole point of this case is that the markup is the
  // one thing a static analyser already sees; what only a screen reader can answer is whether the change
  // was announced. Checking the HTML here would make the signal agree with axe-core and measure nothing
  // this project exists to measure — the mistake §"a cheap pre-check" records, where 32 corpus messages
  // were validated against the page SOURCE and NVDA turned out to say something else entirely.
  //
  // The BAD page fails by SILENCE: the passage is read in the page's own language with no announcement.
  // So the predicate fires when the language is ABSENT from the transcript, which is why it must be given
  // the language name rather than inferring one.
  "language-unmarked": (/** @type {any} */ capture, /** @type {any} */ signal) =>
    languageIsUnannounced(capture, signal),
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
  // TYPED AS A LOOKUP AND COERCED TO BOOLEAN. The frozen literal gives `SIGNAL_PREDICATES` an exact
  // key type, so indexing it with a runtime string is an implicit `any` -- and several predicates
  // return a truthy value rather than a boolean, which would leak out of a function every caller
  // treats as a yes/no.
  const predicates = /** @type {Record<string, (c: any, s: any) => unknown>} */ (SIGNAL_PREDICATES);
  return Boolean(predicates[signal?.type]?.(capture, signal));
}
