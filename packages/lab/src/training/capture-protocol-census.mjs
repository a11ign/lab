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
  /** @type {Record<string, number>} */
  const counts = {};
  for (const page of pages) {
    // `?.` all the way down: a capture can carry `"environment": null`, and this runs over every fitted page.
    const protocol = page.capture?.environment?.captureProtocol;
    const key = protocol === undefined || protocol === null ? "absent" : String(protocol);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
