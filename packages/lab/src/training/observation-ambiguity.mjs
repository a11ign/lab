// @ts-check
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
import { SWEEP_OF, sweepCompleteness, observationOf } from "@a11ign/evidence/verify";

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
// `elsewhere` (#951) is a capture defect too: the sweep ran out of a container and never examined the page.
const SWEEP_MISSED = new Set(["truncated", "phantom", "elsewhere"]);

/**
 * The interaction channels have no census to compare against, so their ambiguity used to be read from the
 * probe's own MARK: `formProbe` is written whenever `probeForms` (or a configured `formState`) RAN, whether
 * or not it activated anything. That is a different question from "was this channel asked about", and the
 * two definitions drifted: the capture's own protocol-9 record (`capture-pure.mjs`'s `recordWhatWasAsked`)
 * answers `observed.formChanges.asked` / `observed.postSubmitFields.asked` from whether a control was
 * ACTIVATED, not merely from whether the probe ran — a formState configured but matching no field, or an
 * opportunistic probe finding no submit-like control, marks `formProbe` and asked nothing. Measured on the
 * 40 local captures carrying the field: 18 "asked" by the mark against 8 by the record, disagreeing on
 * exactly the 10 where the probe ran and activated nothing.
 *
 * FIXED 2026-09-06, per the house order on a duplicated definition ("delete a copy" beats "pin them
 * equal" when one copy can simply be removed): `observationOf` (`packages/evidence/src/verify.ts`) already
 * states the rule this file was restating with a weaker instrument, so this now asks the capture directly
 * and falls back to the mark ONLY where `observationOf` returns `undefined` — a capture older than
 * protocol 9, which genuinely has no `observed` block to ask. `sweepCompleteness` in the same source file
 * already does exactly this fallback shape for `tableCells`; this mirrors it rather than inventing a
 * second one.
 */
const CHANNEL_TO_OBSERVED = { formChanges: "formChanges", postSubmitFields: "postSubmitFields" };
const FALLBACK_MARK = { formChanges: "formProbe", postSubmitFields: "formProbe" };

function probeMarked(/** @type {any} */ capture, /** @type {string} */ event) {
  const marks = Array.isArray(capture.diagnostics) ? capture.diagnostics : [];
  return marks.some((/** @type {any} */ mark) => mark && typeof mark === "object" && mark.event === event);
}

/**
 * Was this interaction channel asked about, and could the capture actually say?
 *
 * @param {any} capture @param {string} channel @param {string} fallbackEvent
 * @returns {{ asked: boolean, byRecord: boolean }}
 */
function channelWasAsked(capture, channel, fallbackEvent) {
  const recorded = observationOf(capture, channel);
  if (recorded) return { asked: recorded.asked === true, byRecord: true };
  // Pre-protocol-9: no `observed` block for this channel at all. The mark is a real fallback here, not a
  // decorative one — absent must not silently read as "not asked" when the probe demonstrably ran.
  return { asked: probeMarked(capture, fallbackEvent), byRecord: false };
}

/**
 * #947: WAS THE SWEEP ASKED, AND DID IT RUN OUT? -- from the capture's own `observed` record, never inferred.
 *
 * Every capture since protocol 9 (`1b4851a8`, 2026-08-31) records this for each sweep channel:
 * `sweepObservation` writes `{ asked: true, complete, stop }` when the sweep ran, and `notObserved(why)` writes
 * `{ asked: false, why }` when it was not asked (`tableCells` without `probeTables`, for one). This audit read
 * that record for the two interaction channels and not for the sweeps, so "this page has none" and "we did not
 * ask" shared one column wherever the census could not tell them apart. `sweepCompleteness` and
 * `capture:explain` already read it.
 *
 * FOUR ANSWERS, and the fourth is not folded into either of the others: a capture older than protocol 9 has no
 * `observed` entry to ask, and "no record" is a statement about the corpus's age, exactly as `cannotSay` is.
 * An entry that does not say `asked: true` or `asked: false` is no record too: it states nothing either way.
 * Only `complete === true` counts as run to exhaustion: an asked sweep with any other `complete` has not shown
 * it finished, and reading it as finished would claim an absence nobody established.
 *
 * The key is `CHANNEL_FIELD[channel]`: the structure field the sweep fills, which IS the name the capture
 * records it under (`observedAs`). `observation-ambiguity.test.ts` pins that against the capture's source.
 *
 * @param {any} capture @param {string} channel
 * @param {string} verdict the channel's `sweepCompleteness` verdict, which carries the one #951 verdict
 * @returns {"emptyAskedComplete" | "emptyAskedShort" | "emptyNotAsked" | "emptyNoRecord"}
 */
function sweepAskedCount(capture, channel, verdict) {
  const recorded = observationOf(capture, /** @type {Record<string, string>} */ (CHANNEL_FIELD)[channel]);
  // ASKED, BUT IT RAN OUT OF A CONTAINER (#951): the capture's own `complete: true` is true about a chat
  // widget, so it is short of the page, never "asked, ran out". Read from the one verdict, via `sweepCompleteness`.
  if (verdict === "elsewhere" && recorded?.asked === true) return "emptyAskedShort";
  // NOT ASKED IS A STATEMENT -- `notObserved` writes `asked: false` -- so only `false` earns it. An entry that
  // states neither (`{}`, `{ complete: true }`) says nothing about asking, and is no record, exactly like a
  // missing entry (worker-capture's review of #952). Today's writers always set `asked`; the next may not.
  if (recorded?.asked === false) return "emptyNotAsked";
  if (recorded?.asked !== true) return "emptyNoRecord";
  return recorded.complete === true ? "emptyAskedComplete" : "emptyAskedShort";
}

/** An empty tally for every channel and interaction field, so a channel with no records still prints. */
function emptyTally() {
  /** @type {Record<string, any>} */
  const channels = {};
  for (const channel of Object.keys(CHANNEL_FIELD)) {
    channels[channel] = { empty: 0, emptySupported: 0, sweepMissed: 0, cannotSay: 0, verdicts: {}, emptyAskedComplete: 0, emptyAskedShort: 0, emptyNotAsked: 0, emptyNoRecord: 0 };
  }
  /** @type {Record<string, any>} */
  const interaction = {};
  // `emptyByFallback` is read the denominator's own rule applied to this channel: it counts how many of
  // `emptyNotAsked` rest on the pre-protocol-9 mark rather than the capture's own record, so a reader can
  // tell "the corpus says so" from "an old capture's best guess" without re-deriving it.
  for (const field of Object.keys(CHANNEL_TO_OBSERVED)) {
    interaction[field] = { empty: 0, emptyNotAsked: 0, emptyByFallback: 0 };
  }
  return {
    channels, interaction,
    soundness: { entries: 0, quiet: 0, notQuiet: 0, unstated: 0, waits: /** @type {number[]} */ ([]) },
    instrument: { parked: 0, parkFailed: 0, failedIds: /** @type {string[]} */ ([]) },
  };
}

/** One capture's contribution to the swept channels, given the completeness verdicts computed for it. */
/** @param {any} capture @param {Record<string,string>} completeness @param {Record<string,any>} channels */
function tallySweptChannels(capture, completeness, channels) {
  for (const [channel, field] of Object.entries(CHANNEL_FIELD)) {
    const verdict = completeness[channel] ?? "unknown";
    const row = channels[channel];
    row.verdicts[verdict] = (row.verdicts[verdict] ?? 0) + 1;
    const announced = capture.structure?.[field];
    if (!Array.isArray(announced) || announced.length > 0) continue;
    row.empty++;
    row[sweepAskedCount(capture, channel, verdict)]++;
    if (SUPPORTS_ABSENCE.has(verdict)) row.emptySupported++;
    else if (SWEEP_MISSED.has(verdict)) row.sweepMissed++;
    else row.cannotSay++;
  }
}

/** The same question for the channels that have no census — answered from the capture's own record first. */
/** @param {any} capture @param {Record<string,any>} interaction */
function tallyInteraction(capture, interaction) {
  for (const [field, observedChannel] of Object.entries(CHANNEL_TO_OBSERVED)) {
    const value = capture.interaction?.[field];
    if (!Array.isArray(value) || value.length > 0) continue;
    interaction[field].empty++;
    const { asked, byRecord } = channelWasAsked(capture, observedChannel,
      /** @type {Record<string, string>} */ (FALLBACK_MARK)[field]);
    if (asked) continue;
    interaction[field].emptyNotAsked++;
    if (!byRecord) interaction[field].emptyByFallback++;
  }
}

/**
 * Was the pointer parked, or did the remedy silently not apply?
 *
 * `parkPointer` owns the mouse before any keystroke, because guidepup prefixes every captured action with
 * Ctrl and Edge turns Ctrl over an image into a MAGNIFIER OVERLAY. When it fails, the failure is marked
 * and the capture continues -- correctly, since a best-effort remedy should not fail a capture -- and
 * nothing read that mark. A caught and logged error is not a handled error.
 *
 * REPORTED, NEVER BLOCKING, and that placement is the decision rather than a softening. This describes the
 * capture path and the host's PowerShell, not a defect a commit introduced, which is the same reason the
 * rest of this audit reports: a gate that fails everyone's push for a transient hiccup on somebody else's
 * capture is one people learn to bypass.
 *
 * The id is recorded so the CALLER can ask the question that matters -- whether a failure split a PAIR.
 * A park that failed on both halves is symmetric and harms nothing; one that failed on a single half means
 * the two variants were measured with different instruments, which is the U+FFFC defect exactly.
 *
 * @param {any} capture @param {string} id @param {{parked: number, parkFailed: number, failedIds: string[]}} tally
 */
function tallyInstrument(capture, id, tally) {
  const marks = Array.isArray(capture.diagnostics) ? capture.diagnostics : [];
  const failed = marks.some((/** @type {any} */ m) => m && m.event === "pointerParkFailed");
  if (failed) { tally.parkFailed++; tally.failedIds.push(id); } else tally.parked++;
}

/**
 * Was the measurement behind each recorded activation SOUND?
 *
 * `capture-core` attaches `baselineQuiet` to every `formChanges` entry beside `kind`, because *"a consumer
 * deciding what this activation proves needs to know whether the measurement was sound"*. Nothing reads
 * it, and `not-working.md` §11 names the reason: a condition on a field whose distribution nobody has
 * measured could make the feature deaf, and "run `rules:gate` after any change that makes a rule quieter"
 * applies to a feature as well as to a rule.
 *
 * This IS that measurement. `false` means the speech baseline had not settled when the delta was taken, so
 * `after` is untrustworthy in EITHER direction — and `validation_error_missing` reads an empty `after` as
 * "nothing was announced", which is the fixed-sleep defect exactly.
 *
 * `unstated` is counted separately and is not folded into either: a capture taken before the field existed
 * has not said the baseline was noisy, and reading absence as `false` here would be this file's own subject
 * committed by the audit that reports it.
 *
 * @param {{entries: number, quiet: number, notQuiet: number, unstated: number, waits: number[]}} soundness
 * @param {any} capture
 */
function tallySoundness(capture, soundness) {
  const changes = capture.interaction?.formChanges;
  if (!Array.isArray(changes)) return;
  for (const change of changes) {
    soundness.entries++;
    if (typeof change?.baselineWaitedMs === "number") soundness.waits.push(change.baselineWaitedMs);
    if (change?.baselineQuiet === true) soundness.quiet++;
    else if (change?.baselineQuiet === false) soundness.notQuiet++;
    else soundness.unstated++;
  }
}

/**
 * @param {Iterable<any>} captures
 * @param {string[]} [ids] capture ids in the same order, so a failure can be attributed to a PAIR
 * @returns {{ scanned: number, noCensus: number, channels: Record<string, any>,
 *            interaction: Record<string, any>,
 *            soundness: {entries: number, quiet: number, notQuiet: number, unstated: number, waits: number[]},
 *            instrument: {parked: number, parkFailed: number, failedIds: string[]} }}
 */
export function observationAmbiguity(captures, ids = []) {
  const { channels, interaction, soundness, instrument } = emptyTally();
  let scanned = 0;
  let noCensus = 0;

  for (const capture of captures) {
    if (!capture || typeof capture !== "object" || !capture.structure) continue;
    scanned++;
    const completeness = sweepCompleteness(capture);
    if (Object.values(completeness).every((verdict) => verdict === "unknown")) noCensus++;
    tallySweptChannels(capture, completeness, channels);
    tallyInteraction(capture, interaction);
    tallySoundness(capture, soundness);
    tallyInstrument(capture, ids[scanned - 1] ?? "", instrument);
  }

  return { scanned, noCensus, channels, interaction, soundness, instrument };
}
