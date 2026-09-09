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
 * day.** A denominator whose comparison changes SIGN is not measuring the same population as its
 * numerator, and a verdict read off it would be a real number about the wrong thing.
 *
 * The three instruments are three definitions, which is why they disagree:
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
 * So the honest answer is NEITHER, with a mechanism: **the question presupposes a shared denominator and
 * the instruments do not have one.** Deciding it needs a census counting what the sweep's key can reach,
 * not a comparison between two populations that happen to have similar names.
 */
import { censusElementCounts } from "@a11ign/evidence/conformance";
import { sweepNeverRan } from "./sweep-costs.mjs";

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
 *             neverRan: boolean, ratio: number | null }[]}
 */
export function sweepAgainstCensus(capture) {
  const diagnostics = Array.isArray(capture?.diagnostics) ? capture.diagnostics : [];
  const raw = censusElementCounts(diagnostics);
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
      const neverRan = sweepNeverRan(mark);
      return {
        type: mark.type, found, present, neverRan,
        basis: /** @type {"raw" | "none"} */ (present === null ? "none" : "raw"),
        // `null` when there is no denominator, NEVER 0 and never Infinity: a ratio against nothing is not
        // a small ratio, and rendering one would put a number where a question mark belongs.
        ratio: present && !neverRan ? found / present : null,
      };
    });
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
 * because a denominator whose comparison changes sign is not measuring the numerator's population. This
 * is the answer IKEA gives, and it is the useful one: it says fix the instruments before asking again.
 *
 * `"agrees"` — every ratio sits inside the band, so the two instruments are counting the same population
 * for this type. **That verdict is what makes the others mean anything**: `heading` agrees on the same
 * five captures where `formField` is unstable, so the census is not useless in general and the
 * disagreement is specific to one bucket.
 *
 * `"cannot say"` — fewer than two captures carry a ratio, or the ratios are mixed between the band and
 * one side of it, which is neither agreement nor a consistent disagreement.
 *
 * @param {readonly (number | null)[]} ratios one per capture, `null` where there was no denominator
 */
export function populationVerdict(ratios) {
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
