// @ts-check
/**
 * Does the EXPORTED dataset have the shape a model can learn from? Pure, so it can be proven.
 *
 * ## The failure this exists to catch
 *
 * `postSubmitFields` came back `[]` on **all 2,122 captures**, 604 of them with a logged crash, and every
 * check stayed green. CLAUDE.md's account of why is the whole argument for this file:
 *
 * > counts never moved, and an empty field is not a malformed one
 *
 * A rule then spent the entire corpus on a fallback its own comment calls useless, six cases could not
 * discriminate, and the failure looked like a page problem rather than a probe problem. Nothing existing
 * could have caught it: `evidence:check` compares fields and this field was empty on both sides.
 *
 * The distinguishing question is not "is this field empty here" — that is often the finding — but **"is
 * this field empty EVERYWHERE"**, which no page can cause and only a producer can.
 *
 * ## Why a distribution check and not more unit tests
 *
 * *Building ML Powered Applications* puts it plainly: an ML pipeline can execute with no errors and
 * produce an entirely useless model, because corrupted data is still numeric and still the right shape.
 * Its remedy, and the ML Test Score's data section, is to encode expectations about the DATA rather than
 * only about the code — presence, type, range, distribution.
 *
 * Everything here is a property of the export as a whole, which is exactly what no unit test of a
 * transform can see.
 */

/** Keys every record must carry. Their absence is a broken exporter, not a page with nothing to say. */
const REQUIRED_TOP_LEVEL = ["input", "target", "provenance"];

/**
 * Fields allowed to be empty on EVERY record, and why.
 *
 * A declaration, never a default: the point of the all-empty check is that a universally empty field is a
 * producer fault, so an exception must name the reason it is not. `probeTables` is opt-in, so a corpus
 * captured without it legitimately carries no cells anywhere — the ambiguity `applicability.py` records
 * as the reason `1.3.1:unassociated-table` stays unconditional.
 */
export const MAY_BE_EMPTY_EVERYWHERE = Object.freeze({
  "structure.tableCells": "probeTables is opt-in; a corpus captured without it has none anywhere",
  "input.unknownSubtypes": "populated only when a corpus label names a subtype the shipped model does not carry a head for, which is empty in any corpus the model was trained on",
  "target.unknownSubtypes": "the same fact on the target side; empty whenever the corpus and the model agree about which subtypes exist, which is the normal state",
});

/** Below this a label balance is collapsed and the head cannot learn the minority class. */
const MIN_MINORITY_SHARE = 0.15;

/** Array-valued leaves under `input`, as dotted paths, with how many records carry something. */
/** @param {Array<Record<string, any>>} records @returns {Map<string, number>} */
function arrayFieldCoverage(records) {
  /** @type {Map<string, number>} */
  const nonEmpty = new Map();
  const walk = (/** @type {unknown} */ value, /** @type {string} */ path) => {
    if (Array.isArray(value)) {
      nonEmpty.set(path, (nonEmpty.get(path) ?? 0) + (value.length > 0 ? 1 : 0));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) walk(inner, path ? `${path}.${key}` : key);
    }
  };
  for (const record of records) walk(record?.input ?? {}, "");
  return nonEmpty;
}

/**
 * Everything wrong with this export, as a list. Empty means nothing. PURE.
 *
 * @param {Array<Record<string, any>>} records
 * @returns {string[]}
 */
export function distributionProblems(records) {
  /** @type {string[]} */
  const problems = [];
  if (records.length === 0) {
    // Never a pass. An empty export reporting "no problems" is the examined-nothing failure this repo
    // names more than any other, committed inside the check written to prevent it.
    return ["the export is EMPTY, so this check examined nothing — that is a refusal, not a clean result"];
  }

  const missing = REQUIRED_TOP_LEVEL.filter((key) => records.some((r) => r?.[key] === undefined));
  if (missing.length) problems.push(`record(s) missing required key(s): ${missing.join(", ")}`);

  // THE ONE THAT MATTERS. Empty here is often the finding; empty EVERYWHERE is a producer that stopped.
  for (const [path, count] of arrayFieldCoverage(records)) {
    if (count > 0 || path in MAY_BE_EMPTY_EVERYWHERE) continue;
    problems.push(`\`${path}\` is empty on ALL ${records.length} record(s) — no page can cause that, so `
      + "the probe or the exporter that fills it has stopped. An empty field is not a malformed one, "
      + "which is why every count-based check passes while this is true");
  }

  const labels = new Map();
  for (const record of records) {
    const label = record?.target?.label ?? "(none)";
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  const smallest = Math.min(...labels.values());
  if (labels.size < 2) {
    problems.push(`every record carries the label "${[...labels.keys()][0]}" — a corpus of one class `
      + "teaches a head to answer that class, and every accuracy number will look excellent");
  } else if (smallest / records.length < MIN_MINORITY_SHARE) {
    problems.push(`label balance is collapsed: ${[...labels].map(([l, n]) => `${l}=${n}`).join(" ")} — the `
      + `minority class is ${(smallest / records.length * 100).toFixed(1)}% of the export`);
  }

  return problems;
}
