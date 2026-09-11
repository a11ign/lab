// @ts-check
// WHAT DID THIS CAPTURE ASK? -- one section of `capture:explain`, in a module with no imports (#343).
//
// Split out of `packages/lab/scripts/explain-capture.mjs` so a test of it runs anywhere, CI's acceptance
// job included: that file reaches `dataset-paths.mjs`, so anything importing it is classed as needing a
// corpus and the row's own acceptance command was refused. `explain-capture.mjs` imports and re-exports it,
// so no reader of the report changes.

/** `NOT RECORDED` is a distinct answer from `no`, and collapsing them is this repo's oldest defect. */
export const absent = (/** @type {string} */ what) => `    NOT RECORDED — this capture cannot say ${what}`;

/**
 * WHAT DID THIS CAPTURE ASK? — read from `observed`, which the capture records for itself since protocol 10.
 *
 * Every other section here is archaeology: it reconstructs what happened from a scatter of marks. This one
 * is not, and that is the point — the capture states it, so a channel nobody asked about says so in its own
 * words rather than being inferred from a missing mark.
 *
 * It also makes this report's closing line TRUE. "What it does not report, the page does not have" was a
 * claim nothing checked; a channel that was never asked is exactly the case where it is false, and until
 * now the report had no way to know. Measured across the corpus before this field existed: `formChanges`
 * empty on 4,830 captures of 6,467 and **3,006 of those never asked**.
 *
 * @param {any} capture
 * @returns {string[]}
 */
export function whatItAsked(capture) {
  const observed = capture?.observed;
  if (!observed || typeof observed !== "object") {
    return [absent("which channels it asked about — it predates CAPTURE_PROTOCOL_VERSION 10")];
  }
  // THE CHANNELS THIS CAPTURE SWEPT, from its own `structure` -- #343. Every array there is a sweep, and every
  // sweep writes its verdict into `observed` under the same key (`collectByType`'s `observedAs`, `EXTRA_SWEEPS`'
  // `key`, `tableCells` directly). Looping over `observed` alone printed NOTHING for a channel with no entry --
  // the sweeps after the one `sweepEveryStructuralType`'s single try/catch caught -- which is the one answer
  // this section exists never to give. Taken from the capture rather than a list typed here, so a capture that
  // predates a channel (`frames`) is not asked about it.
  const swept = capture?.structure && typeof capture.structure === "object" ? Object.keys(capture.structure) : [];
  const rows = [...new Set([...swept, ...Object.keys(observed)])]
    .map((channel) => askedRow(channel, /** @type {Record<string, any>} */ (observed)[channel]));
  return rows.length ? rows : [absent("which channels it asked about — `observed` is empty")];
}

/**
 * One channel's line: what the capture recorded about asking it -- or that it recorded nothing.
 * @param {string} channel @param {any} seen the channel's `observed` entry, `undefined` when there is none
 */
function askedRow(channel, seen) {
  if (seen === undefined) {
    return absent(`whether it finished sweeping ${channel} -- it swept into \`structure.${channel}\` and recorded no verdict`);
  }
  // "NOT ASKED" rather than "no": the channel is empty and that is a fact about this run, not the page.
  if (!seen?.asked) return `    NOT ASKED  ${channel} — ${seen?.why ?? "no reason recorded"}`;
  if (seen.complete === false) {
    return `    ! ${channel} asked, and the sweep did NOT run out — stopped `
      + `${JSON.stringify(seen.stop ?? {})}. An absence here is about the sweep, not the page.`;
  }
  if (seen.complete === true) return `    ok ${channel} — asked, and NVDA itself said there were no more`;
  // A THIRD STATE, and inventing either of the other two would be the defect this field removes.
  // `tableCells` walks a grid with Ctrl+Alt+Arrow and has no "no next heading" to exhaust, so it can
  // report that it ran and cannot report that it finished.
  return `    ~ ${channel} — asked, but this channel has no exhaustion signal to report`;
}

