// @ts-check
/**
 * WHICH captures `build-realism-tier.mjs` rejected as truncated, shaped for `with-realism.jsonl.source.json`.
 *
 * The build recorded HOW MANY (`rejected as truncated: 4 of 41`) and printed the urls to stdout only, so when
 * the count moved between two builds (#2215: 2 rejected, then 4) nothing could say which captures changed
 * sides -- and the earlier build's captures had been replaced by then, so the answer was gone for good.
 *
 * Sorted by `url`, and each gap list by channel/reason/kind, so two builds' provenance diff cleanly rather
 * than differing in filesystem order. Nothing here is a floor: how many rejections are acceptable belongs to
 * the question asking, and a limit in this script would be it guessing.
 *
 * `[]` is a statement ("none were rejected"), and so is its absence ("this build did not say"); the caller
 * writes the list on the base-only path too, so the two are never confused.
 * @param {readonly { url: string, gaps: readonly { channel: string, reason: string, kind: string }[] }[]} rejected
 *   what `completeCaptures` returns as `rejected`
 * @returns {{ url: string, gaps: { channel: string, reason: string, kind: string }[] }[]}
 */
export function rejectedAsTruncated(rejected) {
  return rejected
    .map(({ url, gaps }) => ({
      url,
      gaps: gaps
        .map(({ channel, reason, kind }) => ({ channel, reason, kind }))
        .sort((a, b) => compare(a.channel, b.channel) || compare(a.reason, b.reason) || compare(a.kind, b.kind)),
    }))
    .sort((a, b) => compare(a.url, b.url));
}

/** Code-unit order, not `localeCompare`: the order must not depend on the machine's locale. */
function compare(/** @type {string} */ a, /** @type {string} */ b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
