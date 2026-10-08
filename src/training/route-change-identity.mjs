// @ts-check
/**
 * #1790 (split from #142): does a document-identity signal classify any `routeChange` result
 * differently from the heading-change proxy, on the real-page corpus already on disk?
 *
 * ## The heading-change proxy, named
 *
 * `addStaleRouteTitle` (`packages/judge/src/rules.ts`) treats `headingBefore !== headingAfter` as "the
 * document moved" — the only evidence for the first half of 2.4.2's finding. #142 names three page shapes
 * that defeat it (a consent overlay switching panels, a link that opens a new tab, a modal) and asks:
 * measured against the corpus, is a real document-identity signal EVER a different answer than this proxy
 * to "did the document navigate"?
 *
 * ## The signal actually used, and the one tried and set aside
 *
 * `resolvedPageUrl` before/after was never tried — #142's own table says it shares #71's defect (the
 * previous page's own document can match).
 *
 * The CDP target across the probe (`censusIdentitySignal` below) WAS tried, and #142's own cost estimate
 * for it ("a capture-layer change and a `CAPTURE_PROTOCOL_VERSION` question") turned out to be wrong in
 * the cheap direction: `structureCensus`/`domCensus` already run once, immediately after
 * `probeRouteChange` — checked across all 120 real-page-corpus captures on disk, the only diagnostics ever
 * seen between the LAST `routeChange` mark and the next census are `interaction` (bookkeeping) and, when
 * the page was left, `leftSite` itself, so nothing else in the probe sequence can move the document in
 * between. So the census mark's own `targetUrl` IS the served document at the moment the proxy claims a
 * change, already on the wire, and `servedPathOf` (`@a11ign/evidence/document-identity`, #687) does the
 * reduction rather than a second copy of it.
 *
 * It is also USELESS for this measurement, for a reason worth recording rather than silently dropping the
 * candidate: most of these captures reach their "different" heading through a link the site handles with
 * client-side routing (a cookies/preferences panel swapped in over the same document) rather than a fresh
 * top-level navigation, so the CDP target never changes even when the page and the screen reader both
 * agree something real happened. Measured on the 67 `routeChange` records where the heading DID change,
 * `censusIdentitySignal` says "no navigation" on 58 of them — a disagreement rate so high it is not
 * measuring what #142 asked about; it is measuring how rarely this corpus's first-link activations cross
 * an origin+path boundary. Kept here, exported and tested, because a rejected candidate with the number
 * that rejected it is worth more on the record than a silent omission — but it is NOT the signal the count
 * posted to #142 rests on.
 *
 * NVDA's own document-change announcement — a title followed by the role "document" — IS that signal.
 * Already read this exact way for a sibling probe (`submitNavigatedTheDocument`,
 * `packages/evidence/src/verify.ts`'s `DOCUMENT_ANNOUNCEMENT`), it is also the project's stated preference
 * (CLAUDE.md: prefer the screen reader's own answer over an inference about its behaviour) and #142's own
 * text names it as such. `announcementIdentitySignal` reuses the identical anchored pattern.
 */
import { servedPathOf } from "@a11ign/evidence/document-identity";

/** Matches `packages/evidence/src/verify.ts`'s own `DOCUMENT_ANNOUNCEMENT` — see this file's header. */
const DOCUMENT_ANNOUNCEMENT = /,\s*document$/i;

/** @param {readonly unknown[]} diagnostics @param {string} event @returns {number[]} */
function indexesOf(diagnostics, event) {
  /** @type {number[]} */
  const out = [];
  diagnostics.forEach((mark, index) => {
    if (mark && typeof mark === "object" && /** @type {{event?: unknown}} */ (mark).event === event) {
      out.push(index);
    }
  });
  return out;
}

/**
 * The served path from the nearest diagnostic mark carrying a `targetUrl`, walking from `from` in
 * `direction` (`-1` before the probe, `+1` after it). `null` when nothing in that direction ever named one.
 *
 * @param {readonly unknown[]} diagnostics @param {number} from @param {-1 | 1} direction
 * @returns {string | null}
 */
function nearestServedPath(diagnostics, from, direction) {
  for (let index = from; index >= 0 && index < diagnostics.length; index += direction) {
    const mark = diagnostics[index];
    const targetUrl = mark && typeof mark === "object"
      ? /** @type {{targetUrl?: unknown}} */ (mark).targetUrl : undefined;
    const path = servedPathOf(targetUrl);
    if (path) return path;
  }
  return null;
}

/**
 * The CDP-target identity signal: the served path immediately before `probeRouteChange` started against
 * the served path immediately after it finished. `null` ("cannot tell") when either side has no census
 * mark to read — never read as "no change", which absence is not (#677's rule, applied here).
 *
 * TRIED AND SET ASIDE — see this file's header for why it is not the signal the #142 count rests on.
 *
 * @param {readonly unknown[] | undefined} diagnostics
 * @returns {boolean | null}
 */
export function censusIdentitySignal(diagnostics) {
  if (!Array.isArray(diagnostics)) return null;
  const routeIndexes = indexesOf(diagnostics, "routeChange");
  if (routeIndexes.length === 0) return null;
  const before = nearestServedPath(diagnostics, routeIndexes[0] - 1, -1);
  const after = nearestServedPath(diagnostics, routeIndexes[routeIndexes.length - 1] + 1, 1);
  if (before === null || after === null) return null;
  return before !== after;
}

/**
 * NVDA's own document-change announcement, read from the `routeChange` record's own `announced` field.
 * `null` when the field is absent or empty — a probe that measured nothing, not a probe that heard silence
 * and confirmed no navigation. THE SIGNAL THE #142 COUNT RESTS ON — see this file's header.
 *
 * @param {{announced?: unknown} | null | undefined} route
 * @returns {boolean | null}
 */
export function announcementIdentitySignal(route) {
  const announced = route?.announced;
  if (typeof announced !== "string" || announced === "") return null;
  return DOCUMENT_ANNOUNCEMENT.test(announced);
}

/**
 * The heading-change proxy this row measures against — `addStaleRouteTitle`'s own condition, unchanged,
 * including its FALSY guard (`if (!headingBefore || !headingAfter) return;`): an empty string is "could
 * not read a heading", not "read an empty one", so it is excluded exactly as the shipped rule excludes it
 * — not merely absent, which a plain `typeof` check would have let through as a comparable value.
 *
 * @param {{headingBefore?: unknown, headingAfter?: unknown} | null | undefined} route
 * @returns {boolean | null}
 */
export function headingProxySignal(route) {
  const headingBefore = route?.headingBefore;
  const headingAfter = route?.headingAfter;
  if (!headingBefore || !headingAfter) return null;
  return headingBefore !== headingAfter;
}

/**
 * One capture's `routeChange` record, classified against the heading proxy and both identity signals.
 *
 * `agree` compares the proxy against the ANNOUNCEMENT signal — the one #142's count rests on — and is
 * `null` whenever either side could not be read, a THIRD outcome that must never be folded into agreement
 * or disagreement (an unmeasured pair is not a pair that matched). `census` is carried alongside for the
 * report but never decides `agree` — see this file's header for why.
 *
 * @param {{file: string, route: Record<string, unknown> | null | undefined,
 *   diagnostics: readonly unknown[] | undefined}} capture
 */
export function classifyRouteChange({ file, route, diagnostics }) {
  const headingProxy = headingProxySignal(route);
  const announcement = announcementIdentitySignal(route);
  const census = censusIdentitySignal(diagnostics);
  const agree = headingProxy === null || announcement === null ? null : headingProxy === announcement;
  return { file, headingProxy, announcement, census, agree };
}
