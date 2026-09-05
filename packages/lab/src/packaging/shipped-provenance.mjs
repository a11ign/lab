// @ts-check

/**
 * Do the weights about to ship have a changelog entry that says where they came from?
 *
 * ADR 0007 makes the weights the scorer package's API, and `promote-model.mjs` writes the provenance —
 * corpus size, encoder hash, feature schema, per-subtype thresholds — into a changeset because *"which
 * model produced this finding"* is a question somebody will ask about a disputed WCAG assertion. That
 * entry is the ONLY place the answer is recorded.
 *
 * Nothing checked that it described the weights actually present. Measured 2026-08-27, on this repo:
 *
 *     shipped packages/scorer/models/screenreader-scorer   records 2485
 *     .changeset/promote-candidate-4.md                    records 2403
 *     .changeset/promote-candidate-6.md                    records 2403   (BYTE-IDENTICAL to -4)
 *
 * So the first release would have published weights whose provenance no entry states, beside two copies
 * of an entry describing a model that never shipped. Both failures are silent by construction: a
 * changeset is prose to every tool that reads it, and `changeset-provenance.test.ts` — which exists for
 * exactly this concern — asserts how a row RENDERS and never that the row describes the shipped model.
 * A gate that does not exercise what ships is not a gate, for the fifth time in this repo.
 *
 * The expected text is DERIVED, never spelled a second time. `provenanceLines` is the function
 * `promote-model.mjs` writes with, so a change to the format moves both sides together; a copy of the
 * format here is this project's most expensive recurring shape, and it would drift the first time a row
 * was added.
 */

/** @typedef {{ name: string, text: string }} Changeset */

/**
 * @param {object} input
 * @param {{representation?: {schema?: string}, [k: string]: unknown}|null} input.shippedReport  the
 *   shipped model's
 *   training-report.json, parsed. Typed only as far as this function READS it -- `representation.schema`
 *   is what decides whether a promotion note describes weights this tree could actually score with.
 *   Widening it to `object` is what let `.representation` past review here: the tests pass a typed
 *   fixture, so only `tsc` under checkJs could see it, and only if somebody runs `tsc`.
 * @param {Changeset[]} input.changesets     the PENDING `promote-*.md` entries
 * @param {string|null} input.changelog      the package's published CHANGELOG.md, or null if never released
 * @param {(training: object) => string} input.renderProvenance  `provenanceLines`, injected so the check
 *        cannot acquire its own copy of the format
 * @returns {string[]} one sentence per problem; empty means the release states where its weights came from
 */
export function provenanceProblems({ shippedReport, changesets, changelog, renderProvenance }) {
  if (!shippedReport) {
    return ["the shipped model directory carries no training-report.json, so what it IS cannot be "
      + "established — this is a refusal, not a pass"];
  }
  const problems = [];

  // TWO ENTRIES SAYING ONE THING is a defect in itself: `changeset version` renders every pending entry,
  // so a duplicate publishes the same release note twice under one version. It is also the fingerprint of
  // the naming bug that produced it — a filename derived from a COUNT of the directory, which reuses a
  // number as soon as anything is consumed or added.
  const byText = new Map();
  for (const entry of changesets) {
    const seen = byText.get(entry.text);
    if (seen) problems.push(`${entry.name} is byte-identical to ${seen} — one release note, twice`);
    else byText.set(entry.text, entry.name);
  }

  // A SUPERSEDED ENTRY IS THE SAME DEFECT AS A DUPLICATE, ONE SHAPE ALONG — and the byte-identical check
  // above misses it by exactly one line.
  //
  // Found 2026-09-06 on the real tree: `promote-candidate-683ee98e.md` and `promote-candidate-a1ced91b.md`
  // are two `major` promotion notes differing in ONE line — `screenreader-structured-v17` against `-v18` —
  // both pending, with the shipped weights stamped v18. `changeset version` renders every pending entry,
  // so a first publish would carry two "Retrained scorer weights" entries under one version, one of them
  // describing a model no consumer will ever hold. That is what the duplicate check exists to prevent,
  // arriving through a near-duplicate instead of an exact one — this repo's most repeated shape, where a
  // guard written for a value catches the value and not the neighbouring one (`normalise` reading bare
  // objects but not objects inside an array is the same story).
  //
  // Keyed on the FEATURE SCHEMA rather than on hashes, because that is the field that decides whether the
  // weights can score at all: `score.py` refuses a representation mismatch outright, so an entry naming a
  // schema other than the shipped one describes weights this tree could not run even if it wanted to.
  //
  // NOT a problem when there is exactly one entry, and not a problem for an entry with no schema line at
  // all — the ordinary hand-written changesets in this repo have none and are not promotion notes.
  const shippedSchema = shippedReport?.representation?.schema;
  if (shippedSchema) {
    for (const entry of changesets) {
      const named = /^- feature schema: `([^`]+)`/m.exec(entry.text)?.[1];
      if (named && named !== shippedSchema) {
        problems.push(`${entry.name} is a promotion note for feature schema ${named}, but the shipped `
          + `weights are ${shippedSchema} — it describes a model that will never be released, and `
          + `\`changeset version\` would publish it as a release note anyway. Delete it, or promote the `
          + `weights it actually describes.`);
      }
    }
  }

  // THE WHOLE BLOCK, not a records count. A partial match is the failure mode worth catching: an entry
  // carrying the right corpus size and a stale encoder hash describes a model nobody can rebuild, and is
  // more misleading than no entry at all because it looks answered.
  const expected = renderProvenance(shippedReport);
  const stated = changesets.some((entry) => entry.text.includes(expected))
    || Boolean(changelog && changelog.includes(expected));
  if (!stated) {
    problems.push("no pending changeset and no published CHANGELOG states the provenance of the weights "
      + `in packages/scorer/models/screenreader-scorer. They are:\n${expected}\n`
      + "Promote the candidate that produced them so its changeset is written, or if they were copied in "
      + "by hand, that is the defect — the weights and the entry saying why must land in one commit.");
  }
  return problems;
}
