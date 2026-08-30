/**
 * HOW MANY FEATURE ZEROS ARE CAPTURE ARTEFACTS RATHER THAN PAGE FACTS?
 *
 * Every structured feature in `screenreader_features.py` is `float(bool(channel))` or `float(any(...))`,
 * and `any([])` is `False`. So a `0` means BOTH "the page has none of these" and "nothing looked" — and
 * the model is trained on the two mixed together, with no column that can tell them apart.
 *
 * This is neither hypothetical nor new. `landmark_present` was DELETED on 2026-08-30 because **16 of its
 * 16 zeros were truncated sweeps**: the negative class was 100% capture artefact, so the feature taught
 * the model about the measuring instrument. `heading_present`, `form_field_present`, `table_present` and
 * every other channel-presence feature carry the identical exposure and NONE has ever been measured.
 * Deletion was the remedy that fit through the model boundary; it is not an answer to how large the
 * problem is, and the same free veto simply reappeared on `heading_present` at the next retrain.
 *
 * So this asks the question directly, before anything is changed:
 *
 *     of the records where a channel is EMPTY, on how many can we actually SAY the page has none?
 *
 * READ THE DENOMINATOR. A corpus whose captures predate `census.distinct` answers `unknown` for every
 * channel, which is honest and says nothing about the pages — hence `noCensus` and the per-verdict
 * counts on every row. `unknown` is a verdict about THIS TOOL, `truncated` is a verdict about the sweep,
 * and collapsing them is the mistake this whole module exists to name.
 *
 * Separated from the script that prints it so it can be tested against captures built to demonstrate each
 * verdict. An audit nothing has shown to distinguish its own cases is a count-based check in a new
 * costume — the first version of `verify.corpus.test.ts` read a field that did not exist and passed
 * against the very corpus carrying 604 crashes.
 */
import { SWEEP_OF, sweepCompleteness } from "@a11y-witness/evidence/verify";

/**
 * The channels a completeness verdict exists for, derived from `SWEEP_OF` rather than restated beside it.
 *
 * `tableCells` is appended because `sweepCompleteness` adds it separately: it has no census to compare
 * against, and `tableCompleteness` answers from whether the PROBE RAN at all — the one place in the
 * codebase that already tells "nobody asked" apart from "the sweep came up short".
 */
export const CHANNEL_FIELD = { ...SWEEP_OF, tableCells: "tableCells" };

/** Verdicts on which "this channel is empty" may be read as "the page has none". Only one qualifies. */
const SUPPORTS_ABSENCE = new Set(["exact"]);

/**
 * WHY THE UNSUPPORTED COUNT IS SPLIT, and it is the first thing this audit got wrong about itself.
 *
 * Its first run on the authoritative corpus reported `heading 94.9% UNSUPPORTED`, which reads as a capture
 * path that misses nine headings in ten. It is not what happened: 3,483 of 6,467 captures predate
 * `census.distinct` and therefore answer `unknown` for every channel, and those swamped the 37 that were
 * genuinely `truncated`.
 *
 * So the audit built to catch "two states collapsed into one number" collapsed two states into one number.
 * They need opposite responses and must never share a column:
 *
 *   `sweepMissed`  the census counted elements the sweep did not reach. A CAPTURE defect. 583 landmarks.
 *   `cannotSay`    no census to compare against. A statement about the corpus's AGE, not about any page.
 *
 * `unknown` also covers `tableCells` on a capture where `probeTables` never ran, which is the same
 * category -- nobody asked -- and is why that channel reads 100%.
 */
const SWEEP_MISSED = new Set(["truncated", "phantom"]);

/**
 * The interaction channels have no census to compare against, so their ambiguity is read from the probe's
 * OWN MARK: `formProbe` is written only when `probeForms` ran (`capture-core.mjs:1926`). Its absence is
 * therefore "nobody asked" — exactly the distinction `applicability.py:147-152` records as unavailable,
 * *"the record does not currently carry which probes ran"*.
 */
const ASKED_MARK = { formChanges: "formProbe", postSubmitFields: "formProbe" };

function probeMarked(/** @type {any} */ capture, /** @type {string} */ event) {
  const marks = Array.isArray(capture.diagnostics) ? capture.diagnostics : [];
  return marks.some((mark) => mark && typeof mark === "object" && mark.event === event);
}

/** An empty tally for every channel and interaction field, so a channel with no records still prints. */
function emptyTally() {
  /** @type {Record<string, any>} */
  const channels = {};
  for (const channel of Object.keys(CHANNEL_FIELD)) {
    channels[channel] = { empty: 0, emptySupported: 0, sweepMissed: 0, cannotSay: 0, verdicts: {} };
  }
  /** @type {Record<string, any>} */
  const interaction = {};
  for (const field of Object.keys(ASKED_MARK)) interaction[field] = { empty: 0, emptyNotAsked: 0 };
  return { channels, interaction };
}

/** One capture's contribution to the swept channels, given the completeness verdicts computed for it. */
function tallySweptChannels(capture, completeness, channels) {
  for (const [channel, field] of Object.entries(CHANNEL_FIELD)) {
    const verdict = completeness[channel] ?? "unknown";
    const row = channels[channel];
    row.verdicts[verdict] = (row.verdicts[verdict] ?? 0) + 1;
    const announced = capture.structure?.[field];
    if (!Array.isArray(announced) || announced.length > 0) continue;
    row.empty++;
    if (SUPPORTS_ABSENCE.has(verdict)) row.emptySupported++;
    else if (SWEEP_MISSED.has(verdict)) row.sweepMissed++;
    else row.cannotSay++;
  }
}

/** The same question for the channels that have no census — answered from the probe's own mark. */
function tallyInteraction(capture, interaction) {
  for (const [field, event] of Object.entries(ASKED_MARK)) {
    const value = capture.interaction?.[field];
    if (!Array.isArray(value) || value.length > 0) continue;
    interaction[field].empty++;
    if (!probeMarked(capture, event)) interaction[field].emptyNotAsked++;
  }
}

/**
 * @param {Iterable<any>} captures
 * @returns {{ scanned: number, noCensus: number, channels: Record<string, any>, interaction: Record<string, any> }}
 */
export function observationAmbiguity(captures) {
  const { channels, interaction } = emptyTally();
  let scanned = 0;
  let noCensus = 0;

  for (const capture of captures) {
    if (!capture || typeof capture !== "object" || !capture.structure) continue;
    scanned++;
    const completeness = sweepCompleteness(capture);
    if (Object.values(completeness).every((verdict) => verdict === "unknown")) noCensus++;
    tallySweptChannels(capture, completeness, channels);
    tallyInteraction(capture, interaction);
  }

  return { scanned, noCensus, channels, interaction };
}
