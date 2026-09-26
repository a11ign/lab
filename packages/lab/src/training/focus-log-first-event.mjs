// @ts-check
/**
 * #2550: what is the FIRST event of `interaction.focusEvents.log`, per capture protocol version?
 *
 * `focusLossVerdict` (`packages/judge/src/rules.ts`) returns `unpairable` -- silence -- for an orphaned
 * `focusout` at index 0 that is not a same-id reversed pair. #62 restored that carve-out because the OLD
 * captures opened on a `focusout` 80 times; the protocol-16 listener change was meant to make `log[0]` a
 * real `focusin`, and `log[0].type` has never been read across the corpus to say whether it did. A count of
 * 0 `focusout`-first captures means the carve-out is dead weight; a count above 0 means genuine
 * focus-removed-by-script findings may be swallowed by it.
 *
 * THREE BUCKETS PLUS ONE, and the third is the point: a capture with no log at all (`checked: false`, an
 * empty log, or no `focusEvents` key) is `noLog`, reported as its own number, so a skipped capture is never
 * a silent zero in either of the others. `other` is a first event that is neither type -- unexpected, and
 * counted rather than dropped so the four always sum to the total.
 *
 * The protocol is read from `environment.captureProtocol`, as `capture-cache.mjs` reads it; a capture
 * that records none counts under `"absent"`.
 */

/** @typedef {{ type?: unknown, id?: unknown, atMs?: unknown, name?: unknown }} FocusLogEntry */
/** @typedef {"focusin" | "focusout" | "noLog" | "other"} FirstEventBucket */

const EMPTY_TALLY = () => ({ focusin: 0, focusout: 0, noLog: 0, other: 0, total: 0 });

/**
 * @param {any} capture
 * @returns {FocusLogEntry[]}
 */
function focusLog(capture) {
  const focusEvents = capture?.interaction?.focusEvents;
  if (!focusEvents || focusEvents.checked !== true) return [];
  return Array.isArray(focusEvents.log) ? focusEvents.log : [];
}

/**
 * @param {any} capture
 * @returns {FirstEventBucket}
 */
export function firstEventBucket(capture) {
  const first = focusLog(capture)[0];
  if (!first) return "noLog";
  if (first.type === "focusin" || first.type === "focusout") return first.type;
  return "other";
}

/** @param {any} capture @returns {string} */
export function captureProtocolOf(capture) {
  const protocol = capture?.environment?.captureProtocol;
  return protocol === undefined || protocol === null ? "absent" : String(protocol);
}

/**
 * For a `focusout`-first capture: is it the `sameControlReversed` shape `focusLossVerdict` decides without
 * prior context (a `focusin` for the SAME id immediately after)? Everything else is what the carve-out
 * silences, and is listed for a human to class as page-load focus or a swallowed finding.
 * @param {any} capture
 */
function focusoutFirstDetail(capture) {
  const log = focusLog(capture);
  const [first, next] = log;
  return {
    id: first?.id ?? null,
    name: typeof first?.name === "string" ? first.name : "",
    next: next ? { type: next.type ?? null, id: next.id ?? null } : null,
    sameControlReversed: next?.type === "focusin" && next.id === first?.id,
  };
}

/**
 * @param {readonly { file: string, capture: any }[]} captures
 */
export function countFirstEvents(captures) {
  /** @type {Record<string, ReturnType<typeof EMPTY_TALLY>>} */
  const byProtocol = {};
  const focusoutFirst = [];
  for (const { file, capture } of captures) {
    const protocol = captureProtocolOf(capture);
    const tally = (byProtocol[protocol] ??= EMPTY_TALLY());
    const bucket = firstEventBucket(capture);
    tally[bucket] += 1;
    tally.total += 1;
    if (bucket === "focusout") focusoutFirst.push({ file, protocol, ...focusoutFirstDetail(capture) });
  }
  return { total: captures.length, byProtocol, focusoutFirst };
}
