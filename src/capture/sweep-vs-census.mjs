// @ts-check
/**
 * DOES THE PAGE SERVE WHAT THE SWEEP FOUND, OR IS THE SWEEP WALKING MORE THAN IS THERE? — #800.
 *
 * #659 answered "is the sweep cost reducible" with *no — the sweep is not the cost*, and left this behind.
 * The row proposes one check: `formField.found` against the census's **raw** `formControl`, never
 * `distinct`, because #737 established that `distinct` counts nameless elements as separate names and so
 * inflates the very denominator the check rests on.
 *
 * **THE CHECK IS RIGHT AND IT CANNOT DECIDE THE QUESTION, and this module's job is to say so with the
 * numbers rather than to force a verdict.** Measured on five captures of `https://www.ikea.com/de/de/`,
 * every one `targetMatch: matched` on one URL with no navigation:
 *
 *     capture   AX formControl   DOM formField (pre/post)   sweep found   AX heading   DOM heading
 *     07:32          224                44 / 70                 101            83           85
 *     08:20          224                44 / 70                 100            83           85
 *     14:07          125                44 / 70                 284            69           71
 *     14:15          125                44 / 70                 271            69           71
 *     14:31          125                44 / 70                 265            69           71
 *
 * **The ratio of found to present INVERTS: 0.45 in the morning, 2.12 in the afternoon, on one URL in one
 * day.** That inversion is not the page changing and not the sweep over-walking. **#699 merged at
 * 12:40:39Z, into the middle of that set**, and it moved the census read from AFTER the probes to before
 * them — so the first two captures measured what was present once the sweeps had walked the page and
 * opened things, and the last three measured it before anything touched it. Same page, same URL, two
 * definitions of the denominator, and **nothing in the record says which one a given capture used.**
 *
 * **The field that would have said is the field that hid it.** `structureCensus.atMs` is stamped at MARK
 * time (`capture-core.mjs`'s `mark` does `Date.now() - startedAt` inside `entries.push`); the census is
 * READ at the first line of `navigateByStructure` and marked after it returns, so the stamp is off by the
 * whole capture, ~450 s. Compared against the first sweep's mark it puts the census LAST on all five —
 * which is how this module's first answer came to say "#699 isn't in any of them" when it is in three.
 * That is why the gate below is on simultaneity rather than on a corrected stamp: a reader who trusts a
 * corrected stamp on an old capture is in the position that produced the wrong answer.
 *
 * The three instruments are three definitions, which is why they disagree even when read at one moment:
 *
 *   - `domCensus.formField` — DOM form elements.
 *   - `structureCensus.formControl` — AX nodes in `FORM_CONTROL_ROLES` (textbox, searchbox, combobox,
 *     listbox, checkbox, radio, switch, slider, spinbutton, button, menuitemcheckbox, menuitemradio).
 *     **`link`, `menuitem`, `option` and `tab` are NOT in it.**
 *   - `sweep.found` — distinct announcements NVDA's form-field quick-nav produced.
 *
 * **The sweep is not double-counting**, which is the one thing this rules out cleanly: on the 14:31
 * capture all 265 announcements are distinct, and still 265 after normalising away every state word
 * (`collapsed`, `focused`, `selected`…). It is reaching 265 genuinely different things.
 *
 * So the answer is that **no capture on disk can decide the row**, and the module's job is to say that
 * with the numbers rather than to force a verdict from five records that were never one population.
 */
import { censusElementCounts } from "@a11ign/evidence/conformance";
import { sweepCompleteness } from "./sweep-costs.mjs";

/** Which census key each swept type is comparable against. Named once; `null` means no ground truth. */
export const CENSUS_KEY_FOR_SWEEP = Object.freeze({
  heading: "heading", landmark: "landmark", link: "link", graphic: "graphic",
  formField: "formControl",
  // NO CENSUS ENTRY. An invented denominator is worse than an absent one -- `sweepCoverage` makes the
  // same choice for the same reason.
  list: null, frame: null, postSubmit: null, extra: null,
});

/**
 * The sweep's own count against the census's RAW element count, per type, for one capture.
 *
 * RAW, NEVER `distinct` (#737): `distinct` collapses by name and an element with no name counts as its
 * own, so it is exact where everything is named and inflated in proportion to how many are not. The basis
 * is returned so a reader never has to ask which number they are looking at.
 *
 * @param {{ diagnostics?: unknown[] }} capture
 * @returns {{ type: string, found: number, present: number | null, basis: "raw" | "none",
 *             completeness: "complete" | "truncated" | "never-ran" | "elsewhere", ratio: number | null,
 *             censusReadAt: number | null, sweptAt: number | null, apartMs: number | null }[]}
 */
export function sweepAgainstCensus(capture) {
  const diagnostics = Array.isArray(capture?.diagnostics) ? capture.diagnostics : [];
  const raw = censusElementCounts(diagnostics);
  // WHEN THE CENSUS WAS READ, or `null` because the record does not say. `structureCensus.atMs` is stamped
  // at MARK time (`capture-core.mjs`'s `mark` does `Date.now() - startedAt` inside `entries.push`), and the
  // census is READ at the top of `navigateByStructure` and MARKED after it returns -- so that field is off
  // by the whole capture. `readAt.startedAtMs` is the field that says -- added by #854, so a capture taken
  // before that lands has no `readAt` at all and gets `null` here, which is the state the gate is for.
  //
  // NESTED because the census's element counts are read off a DENYLIST (`censusElementCounts` takes every
  // numeric field except `event` and `atMs`), so a flat `readAtMs` on that mark would arrive downstream as
  // an element type. Read the nested field, never invent a flat one.
  const censusMark = diagnostics.find((/** @type {any} */ m) =>
    m && typeof m === "object" && m.event === "structureCensus");
  const readAt = /** @type {any} */ (censusMark)?.readAt;
  const censusReadAt = typeof readAt?.startedAtMs === "number" ? readAt.startedAtMs : null;
  return diagnostics
    .filter((/** @type {any} */ m) => m && typeof m === "object" && m.event === "sweep"
      && typeof m.type === "string" && typeof m.error !== "string")
    .map((/** @type {any} */ mark) => {
      const key = /** @type {Record<string, string|null>} */ (CENSUS_KEY_FOR_SWEEP)[mark.type] ?? null;
      const present = key && raw && typeof raw[key] === "number" ? raw[key] : null;
      const found = typeof mark.found === "number" ? mark.found : 0;
      // A SWEEP THAT NEVER RAN HAS NO RATIO, and this is the same defect `sweep-costs.mjs` found in its
      // own first output, arriving in a different divisor. A starved sweep reports `found: 0`, which
      // divided by a real census gives 0.00 -- read as "the sweep found almost none of what is there"
      // when the truth is that it never looked. `link` on the IKEA captures reads 0.00, 0.00, 0.13, 0.12,
      // 0.00 and three of those five are deadline stops. Shared predicate, not a second spelling.
      // COMPLETE, TRUNCATED OR NEVER-RAN — three states, because only a sweep that ENDED gives a ratio.
      // A sweep cut off by the deadline reports a lower bound, and dividing it by a real census produces
      // a number that reads as coverage. Both usable `link` observations on IKEA are deadline stops.
      const completeness = sweepCompleteness(mark, diagnostics);
      // WHEN THIS SWEEP RAN, and how far that is from the census read -- #844. `readAt` (#854) made the
      // census's own moment legible; this is the other half, and the two together turn "we cannot know
      // whether these describe one moment" into a number. Measured across the 14 captures that carry
      // `readAt`: the census lands at 28-67 s and `formField` walks at 37-280 s, so the halves of every
      // ratio on disk are 1 s to 230 s apart. A BOUND rather than an absence.
      const sweptAt = typeof mark.atMs === "number" ? mark.atMs : null;
      return {
        type: mark.type, found, present, completeness,
        basis: /** @type {"raw" | "none"} */ (present === null ? "none" : "raw"),
        censusReadAt, sweptAt,
        // `null` when either moment is missing -- an unknown gap is not a gap of zero, which is the whole
        // distinction #854 was about one field over.
        apartMs: censusReadAt !== null && sweptAt !== null ? sweptAt - censusReadAt : null,
        // `null` when there is no denominator, NEVER 0 and never Infinity: a ratio against nothing is not
        // a small ratio, and rendering one would put a number where a question mark belongs.
        ratio: present && completeness === "complete" ? found / present : null,
      };
    });
}

/**
 * DID THE PAGE HOLD STILL BETWEEN THE TWO READS? — #844, and it is what lets a verdict be issued at all.
 *
 * #850 refused every verdict because no capture recorded WHEN its census was read. #854 fixed that, and
 * the answer turned out to be worse than unknown: on the 14 captures that carry `readAt`, the census
 * lands at 28-67 s and `formField` walks at 37-280 s. **Knowing both moments proves they are not the
 * same one.** A gate that opened merely because the moments were recorded would have been reading
 * "we can see the gap" as "there is no gap".
 *
 * **`heading` is the control, and the row named it before this could measure it**: it carries no `onItem`,
 * so the sweep changes nothing, and its roles are unambiguous — a heading is a heading in the DOM, in the
 * accessibility tree and to NVDA alike. **So a `heading` ratio of exactly 1 is direct evidence that the
 * page did not change over that interval**, whatever the interval was. It replaces a threshold on time,
 * which would have been a number somebody chose.
 *
 * Measured across the 14:
 *
 *     w3.org (8 captures)     heading 1.00 on every one   -- the page holds still
 *     tfl.gov.uk              heading 1.00                -- holds still, and formField still reads 2.27
 *     salesforce              heading 1.11                -- grew
 *     ikea                    heading 1.16                -- grew
 *     hubspot                 heading 0.04                -- did not grow; the SWEEP collapsed (#897)
 *
 * **A ratio BELOW 1 is not a page that shrank**, and treating it as a control failure would be right for
 * the wrong reason. hubspot's 0.04 is the chat-dialog collapse: the sweep was sealed inside a modal and
 * exhausted it. `ranOutShortOfTheCensus` (#887) is what names that, and this returns `null` — "the
 * control itself did not report" — rather than pretending to a verdict either way.
 *
 * @param {readonly { type: string, ratio: number | null, completeness: string }[]} rows one capture's rows
 * @returns {boolean | null} `null` when the control could not be read
 */
export function pageHeldStill(rows) {
  const control = rows.find((row) => row.type === "heading");
  if (!control || control.completeness !== "complete" || control.ratio === null) return null;
  // BELOW 1 IS NOT AN ANSWER ABOUT THE PAGE. A sweep that found fewer than the census counted did not
  // observe a shrinking page; it observed less of one. Reported as "the control did not report" so the
  // caller withholds rather than concluding, which is the same asymmetry `ranOutShortOfTheCensus` states.
  if (control.ratio < 1) return null;
  return control.ratio === 1;
}

/** A ratio this far either side of 1 is a disagreement worth reporting rather than measurement noise. */
export const RATIO_IS_AGREEMENT_WITHIN = 1.25;

/**
 * WHAT DO SEVERAL CAPTURES OF ONE PAGE SAY ABOUT ONE TYPE? — the row's acceptance 2, and "neither" is a
 * real answer it is allowed to give.
 *
 * `"sweep-exceeds"` — the sweep consistently found more than the census counts. That is the row's second
 * branch and it points at `collectByType`.
 *
 * `"census-exceeds"` — consistently fewer, which is a coverage question rather than an over-walk.
 *
 * `"unstable"` — **the ratio crosses 1 across captures of the same page.** Neither branch is supported,
 * because a denominator whose comparison changes sign is not measuring the numerator's population.
 * **This is NOT the answer IKEA gives** — an earlier version of this file said it was, and it was wrong:
 * IKEA's ratios cross 1 because the instrument moved between the morning and the afternoon captures, and
 * a verdict about the page cannot be read off a change in the apparatus.
 *
 * `"agrees"` — every ratio sits inside the band, so the two instruments are counting the same population
 * for this type. It is reachable only for captures that say when their census was read; on IKEA
 * `landmark` sits at 0.86 on all five and still gets no verdict, because a gate that excepted the
 * convincing-looking case would be no gate.
 *
 * `"cannot say"` — fewer than two captures carry a ratio, or the ratios are mixed between the band and
 * one side of it, which is neither agreement nor a consistent disagreement.
 *
 * `"not-simultaneous"` — **the ratios exist and no verdict may be read from them**, because the numerator
 * and the denominator describe different moments and one of the instruments moves the page it measures.
 * The census is read at t≈0; `formField` walks at t≈300-400 s and ACTIVATES 64 controls while it walks.
 * On a lazy-loading page every ratio above 1 is then the page growing between two reads, and this cannot
 * tell that from a sweep over-walking.
 *
 * **This is the default today and it is not a placeholder.** No capture records when its census was read
 * — `structureCensus.atMs` is the MARK time and is off by the whole capture — so simultaneity cannot be
 * established from any record on disk. #854 adds `readAt.startedAtMs`; captures carrying it get a real
 * verdict and older ones keep this one. `heading` is the nearest thing to a control and shows why it matters: no
 * `onItem`, walks at ~100 s, `found` **80 on all five captures** while the census moved 83 → 69.
 *
 * @param {readonly (number | null)[]} ratios one per capture, `null` where there was no denominator
 * @param {{ censusReadAt?: readonly (number | null)[], heldStill?: boolean | null }} [moments]
 *   when each capture's census was READ, and whether the `heading` control says the page held still
 */
export function populationVerdict(ratios, moments = {}) {
  // THE MOMENT GATE COMES FIRST, before any arithmetic on the ratios. Checking the numbers and then
  // qualifying them would put a verdict in front of a reader who stops at the first line.
  const readAt = moments.censusReadAt;
  if (!readAt || readAt.some((t) => typeof t !== "number")) return "not-simultaneous";
  // KNOWING THE MOMENTS IS NOT THE SAME AS THEIR BEING THE SAME MOMENT -- #844, and this is the half #850
  // could not reach. Once `readAt` shipped, every capture on disk could say when its census was read, and
  // the answer was that the census lands at 28-67 s while `formField` walks at 37-280 s. A gate that
  // opened on the moments being RECORDED would have read "we can see the gap" as "there is no gap".
  //
  // `pageHeldStill` is the evidence that closes it: the `heading` sweep changes nothing and its roles are
  // unambiguous, so a ratio of exactly 1 says the page did not change over that interval whatever its
  // length. `undefined` means the caller did not pass a control -- a comparison nobody controlled is not
  // one this may rule on, which is the same refusal the moments themselves get above.
  if (moments.heldStill !== true) return "not-simultaneous";
  const usable = /** @type {number[]} */ (ratios.filter((r) => typeof r === "number" && Number.isFinite(r)));
  if (usable.length < 2) return "cannot say";
  const above = usable.filter((r) => r > RATIO_IS_AGREEMENT_WITHIN).length;
  const below = usable.filter((r) => r < 1 / RATIO_IS_AGREEMENT_WITHIN).length;
  if (above && below) return "unstable";
  if (above === usable.length) return "sweep-exceeds";
  if (below === usable.length) return "census-exceeds";
  // EVERY ratio inside the band. Reported as agreement rather than as "cannot say", because a type where
  // the instruments agree is evidence ABOUT the instruments and not an absence of evidence.
  if (above === 0 && below === 0) return "agrees";
  return "cannot say";
}
