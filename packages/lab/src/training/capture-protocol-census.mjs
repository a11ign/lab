// @ts-check
/**
 * How many of the fitted captures were taken under each `captureProtocol`, keyed by the protocol, in the shape
 * `evaluate-screenreader-acceptance.py`'s `capture_protocol_census` reports (`{"21": 49}`; a capture that
 * records none counts under `"absent"`).
 *
 * THE FIT COULD NOT SAY WHAT ITS OWN INPUTS WERE CAPTURED UNDER, and #2212 is what that costs: the 49
 * calibration captures sat at protocol 18 while the workers served 21, and the threshold fitted on them looked
 * identical to one fitted on a current split -- so three meaning bumps went unnoticed.
 *
 * A CENSUS AND NOT A FLOOR, for the Python function's reason: which protocol a reading REQUIRES belongs to the
 * question asking (#2212 wants a single `21`), and a minimum here would be this script guessing at it.
 *
 * Read off the captures the scoring actually used, never off the stamped role or the directory listing: the
 * directory also holds orphans (protocol 6, or none) that no declared page owns and that will never move.
 * @param {readonly any[]} pages
 * @returns {Record<string, number>}
 */
export function captureProtocolCensus(pages) {
  // `?.` all the way down: a capture can carry `"environment": null`, and this runs over every fitted page.
  return countByProtocol(pages.map((page) => page.capture?.environment?.captureProtocol));
}

/**
 * The same census over RECORDS -- the generated tier, whose protocol is the `provenance.environment.captureProtocol`
 * stamp `captureEnvironment` wrote, not a `capture` a page still carries (#2371).
 *
 * `with-realism.jsonl` is generated records beside real-page records, and #2215's whole point is that those two
 * halves can sit at different protocols (21 beside 18) with nothing saying so. One reading of each, printed by
 * the same run, is what makes the mix visible.
 * @param {readonly any[]} records
 * @returns {Record<string, number>}
 */
export function recordProtocolCensus(records) {
  return countByProtocol(records.map((record) => record.provenance?.environment?.captureProtocol));
}

/**
 * A census with its total beside it. An empty group is a join that stopped working (no training entries
 * matched, no record carried a stamp), not a pass -- so `n` travels with the counts and a reader sees `n=0`
 * where `{}` alone would read as "nothing to report".
 * @param {Record<string, number>} counts
 */
export function withTotal(counts) {
  return { n: Object.values(counts).reduce((sum, count) => sum + count, 0), counts };
}

/**
 * Both halves of the mix `with-realism.jsonl` is made of, ready to print and to record in `provenance`.
 * Still a census and not a floor: nothing here says which protocol the reading must be.
 * @param {{ trainingEntries: readonly any[], generatedRecords: readonly any[] }} halves
 */
export function protocolCensusOfTheMix({ trainingEntries, generatedRecords }) {
  return {
    realPage: withTotal(captureProtocolCensus(trainingEntries)),
    generated: withTotal(recordProtocolCensus(generatedRecords)),
  };
}

/** One printed line per half: `real-page {"18":41} n=41`. */
export function protocolCensusLines(/** @type {ReturnType<typeof protocolCensusOfTheMix>} */ mix) {
  return [
    `real-page ${JSON.stringify(mix.realPage.counts)} n=${mix.realPage.n}`,
    `generated ${JSON.stringify(mix.generated.counts)} n=${mix.generated.n}`,
  ];
}

/** @param {readonly unknown[]} protocols */
function countByProtocol(protocols) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const protocol of protocols) {
    const key = protocol === undefined || protocol === null ? "absent" : String(protocol);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
