// @ts-check
/**
 * Page furniture: one algorithm — deal a realistic-size bucket to each case and inject its content — plus
 * the content generators that fill a bucket. Split out of `case-matrix.mjs`, where the bucket machinery
 * (`SCALE_BUCKETS`, `fnv1a`, `bucketFor`, `withRealisticScale`) sat ~2,400 lines from the content it
 * injects (`filler`, `namedField`, `disclosure`, `dataTable`), with unrelated case machinery in between.
 *
 * `fnv1a` is also used by the case-authoring code in `case-matrix.mjs` for its own id-keyed choices
 * (rotating accompanying defects, choosing a multi-defect markup variant) — "the one hash both id-keyed
 * choices use, so they cannot drift apart" — so it is imported back there rather than duplicated.
 */
import { escapeHtml } from "./page-templates.mjs";

/**
 * Realistic page furniture, identical in both variants of a pair.
 *
 * ## Why
 *
 * The generated pages were minimal test cases and real pages are not. Measured across the corpus against
 * real captures:
 *
 *   links      corpus p50 0, MAX 1        real pages 41-47
 *   headings   corpus p50 1, MAX 3        real pages 30-37
 *   transcript corpus p50 3, max 12       real pages 16-143
 *
 * So the scorer had never seen a page with more than one link or three headings, and its structured
 * features sat 10-40x outside anything it was fitted on. That is why it scores 0.997 on a corpus page and
 * <=0.002 on a real one: the inputs are off the end of its training range and its heads extrapolate to
 * nothing. The fix is not more REAL pages — labels would then need validating — it is realistically SIZED
 * pages, which we can author and label exactly.
 *
 * ## Why it cannot disturb a single label
 *
 * Applied inside `page()`, so both variants of a pair get byte-identical furniture and the labelled
 * failure remains the only difference. What it contains is constrained by what the signals read:
 *
 * - **No landmarks.** All 58 `structure-empty` cases assert `structure.landmarks` is EMPTY, which holds
 *   today only because quick navigation cannot reach the `<main>` enclosing the caret. A filler `<nav>`
 *   WOULD be reachable and would break every one of them. Costless to omit: `evidenceUnits` deliberately
 *   excludes landmarks as a model feature, so the gap there does not matter.
 * - **No images and no form fields**, because 150 image cases and 141 label cases are defined by exactly
 *   what those channels contain.
 * - **No vague link text.** `regex` signals match `link, read more|learn more`, and 2.4.4's own rule bars
 *   the phrase family, so filler links are all specific.
 * - **Headings are safe for `missing-heading`** — it asserts a NAMED heading is absent, not that none
 *   exist, so distinctly-worded filler cannot satisfy it. Sequence numbers make collision impossible.
 *   **Not safe for `structure-empty` on `headings`**, which asserts there are NONE: furniture sections
 *   would supply them and quietly void the case. `withRealisticScale` drops sections for those, the same
 *   way it drops the furniture table from a case that drives tables itself.
 */
function filler(/** @type {any} */ bucket) {
  const { links: linkCount, sections: sectionCount } = bucket;
  if (linkCount === 0 && sectionCount === 0) return "";
  const topics = [
    "Opening times for the north entrance", "Annual review 2019", "Accessibility statement",
    "Travel and parking", "Volunteering enquiries", "Room hire rates", "Schools programme",
    "Conservation projects", "Membership renewal", "Local history archive", "Site safety notes",
    "Seasonal closures", "Feedback and complaints", "Supplier information", "Research requests",
    "Community grants", "Weather advisory", "Lost property", "Bicycle storage", "Guided walks",
  ];
  // Every link text must be UNIQUE, and this is not cosmetic. The topic list cycles, so at 40 links the
  // 21st repeated the 1st — and the read-through's bottom-of-page detector treats repeated phrases as
  // having reached the end (`MAX_REPEATED_PHRASES = 3`). Measured: it stopped inside the link list, the
  // transcript came back SHORTER for a bigger page (24 lines against 44), and the 28 heading sections were
  // never read at all. Left unfixed that would have truncated the read-through on every page in the corpus.
  const links = Array.from({ length: linkCount }, (_, i) =>
    "<li><a href=\"#ref-" + (i + 1) + "\">"
    + escapeHtml(topics[i % topics.length] + " " + String(i + 1).padStart(2, "0"))
    + "</a></li>").join("");
  const sections = Array.from({ length: sectionCount }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    // "Reference note", NOT "Reference section". The word `section` collided with a real signal —
    // `heading.*\bsection\b` on `heading-vague-market` — so the filler itself satisfied the badSignal and
    // the case reported CONTAMINATED, firing on both variants. Found by testing the filler's announced text
    // against all 382 regex signals statically, which takes seconds and should be run whenever this text
    // changes: it would have caught this before a single capture was spent.
    return "<h2 id=\"ref-" + (i + 1) + "\">Reference note " + n + "</h2>"
      + "<p>Background detail for reference note " + n
      + ", retained for records and reviewed each year by the site team.</p>";
  }).join("");
  return "<ul>" + links + "</ul>" + sections + namedField(bucket) + dataTable(bucket) + disclosure(bucket);
}

/**
 * The furniture that exists to BREAK a correlation rather than to add size.
 *
 * ADR 0015: every head learned to penalise features that are 0 on all of its training positives, because
 * one page demonstrates one thing. Of the 147 records carrying an unnamed form field, none had a table and
 * none had a named field — so `table_present` (-1.26) and `form_field_named` (-4.33) were free, and the
 * scorer reports an unnamed control only on a page where nothing is correctly named.
 *
 * These two pieces are the cheapest remedy: ordinary, CONFORMANT structure that a real page carries
 * incidentally, injected identically into both variants like all other furniture. They add no failure, so
 * no label changes; they only stop the feature being constant.
 *
 * Both are deliberately conformant — a properly associated table and a properly labelled field — so they
 * cannot satisfy any case's badSignal. `filler-collision.test.ts` runs EVERY signal predicate against a
 * capture built from these announcements rather than only the regex ones, which is how it caught that
 * `placeholderOnlyIsPresent` would have been silenced by the labelled field.
 */
function namedField(/** @type {any} */ bucket) {
  if (!bucket.namedField) return "";
  // NO `<form>` wrapper, deliberately. `probeForms` finds a form and submits it, and a second form would
  // change which one a case's own probe activates — a difference between pages that the label does not
  // describe. A labelled input needs no form to be announced as a named field.
  return "<p><label for=\"ref-lookup\">Reference lookup</label>"
    + "<input id=\"ref-lookup\" name=\"ref-lookup\" type=\"text\"></p>";
}

/**
 * A CONFORMANT disclosure — the one interaction evidence furniture can supply.
 *
 * `state_changed` starves more subtypes than any other feature (13 of 13), and `corpus:starvation` models
 * this bucket as taking the starved pairs from 209 to 178. It is reachable from markup alone because
 * `probeKindFor` returns "disclosure" for anything announced as `collapsed` and activates it
 * **unconditionally**, with no `probeForms` gate — its own comment says why: "expanding something is
 * side-effect-free".
 *
 * Everything else in that group needs `probeForms`, which activates a control a page owner chose, and this
 * tool does not press *Book* on a page it does not own. So this is where furniture's reach ends for
 * interaction evidence.
 *
 * Conformant deliberately: `aria-expanded` flips, so the page announces `expanded` after activation. A
 * broken one would add a 4.1.2 failure to every page carrying it, which changes labels rather than
 * features — that is a two-defect CASE, not furniture.
 */
function disclosure(/** @type {any} */ bucket) {
  if (!bucket.disclosure) return "";
  return "<p><button type=\"button\" id=\"ref-notes-toggle\" aria-expanded=\"false\" "
    + "aria-controls=\"ref-notes-panel\" onclick=\"var b=this,p=document.getElementById('ref-notes-panel');"
    + "var open=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',String(!open));"
    + "p.hidden=open;\">Reference notes archive</button></p>"
    + "<div id=\"ref-notes-panel\" hidden><p>Archived reference notes are retained for seven years.</p></div>";
}

function dataTable(/** @type {any} */ bucket) {
  if (!bucket.dataTable) return "";
  // Headers associated by `scope`, so this sets `table_header_associated` and NOT `table_position_only`.
  // The position-only variant is a 1.3.1 FAILURE, so it cannot be furniture — a page that needs it has to
  // fail two criteria at once, which is a case definition rather than a bucket.
  return "<table><caption>Reference notes index</caption>"
    + "<tr><th scope=\"col\">Note</th><th scope=\"col\">Reviewed</th></tr>"
    + "<tr><td>Site safety</td><td>2019</td></tr></table>";
}

/**
 * Page sizes to spread the corpus across, smallest to largest.
 *
 * A corpus where every page has exactly N links teaches the scorer "N", not "a range" — so the sizes vary
 * per case and the zero stays in, keeping the small pages the model already handles.
 *
 * **The numbers live in `scale-buckets.test.ts`, not here.** This comment used to restate the cost model,
 * and it went stale within the hour of the model being corrected — two descriptions of one thing that
 * disagreed, which is worse than one. The test holds `BASELINE_MS` and `MS_PER_ELEMENT` as the single
 * source, asserts these buckets against them, and fails if a bucket outgrows either rule below.
 *
 * Two rules bound this list, both from `docs/adr/0009-dataset-tiers.md`:
 *
 * 1. No bucket may be large enough for a capture to approach `DEFAULT_BUDGET_MS`. Past that the sweeps
 *    truncate mid-page and report an empty field — and an empty field IS the finding for several cases
 *    here, so absence becomes indistinguishable from truncation. The five-bucket version breached this:
 *    its largest page took the full budget and reported `lists: 0` on a page with 40 list items.
 * 2. A full recapture of the bulk corpus must fit one night, because a feedback loop measured in days
 *    does not get run — which in practice means shipping evidence nobody revalidated.
 *
 * Real-page structure is the realism TIER's job, sampled rather than applied to all 1,061 pairs. Change
 * these only with fresh timings, and update the test's constants in the same commit.
 */
export const SCALE_BUCKETS = [
  { links: 0, sections: 0 },
  { links: 6, sections: 4 },
  // The two buckets that exist for ADR 0015 rather than for size. They carry conformant structure belonging
  // to OTHER criteria, so `form_field_named` and `table_present` stop being constant across any subtype's
  // positives — which is what made them free negative weights. `furniture-spread.test.ts` asserts the
  // property directly, without capturing anything.
  { links: 6, sections: 4, namedField: true },
  // Ordered by MEASURED capture cost, ascending, which `scale-buckets.test.ts` asserts: a labelled field
  // is +3.7 s, a disclosure +3.9 s (it activates a control), a table +7.9 s (the sweep walks cells).
  { links: 6, sections: 4, disclosure: true },
  { links: 6, sections: 4, dataTable: true },
];

/**
 * FNV-1a over a case id. The one hash both id-keyed choices use, so they cannot drift apart.
 *
 * Extracted rather than copied when the conformant accompaniments needed the same property: a case's
 * generated content must depend on nothing but its own name, or adding cases elsewhere re-rolls it.
 */
export function fnv1a(/** @type {any} */ id) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Which furniture bucket a case gets — SPREAD ACROSS ITS SUBTYPE, not hashed independently.
 *
 * It was `SCALE_BUCKETS[fnv1a(id) % length]`, which gives each case an independent 1-in-5 chance of the
 * `namedField` bucket and therefore gives a SUBTYPE no guarantee at all. For seven cases the chance of
 * missing that bucket entirely is 0.8^7 = 0.21 — one subtype in five — and measured 2026-08-26 exactly
 * one did: `2.4.2:route-title-stale`, all seven cases without a named form field, which
 * `furniture-spread.test.ts` correctly reported as a free veto for `form_field_named`.
 *
 * The fix is not to special-case that subtype. Random assignment does not spread, and ADR 0015 is about
 * a feature being constant across a subtype's positives — so the index must be taken WITHIN the subtype:
 * case k of a subtype gets bucket (offset + k) % 5, and every subtype with 5+ cases sees all five buckets
 * by construction rather than by luck.
 *
 * The offset is still hashed, from the SUBTYPE, so two subtypes do not receive the buckets in lockstep —
 * which would make `namedField` correlate with position-in-subtype instead of with nothing.
 *
 * Keyed on the subtype and the case's index within it, so inserting a case re-buckets only that subtype's
 * later cases. That is a weaker guarantee than the id hash gave (`insert freely, nothing moves`) and it
 * is the trade the starvation forces; `check-signals` reports what moved, and the pages are regenerated
 * from the definitions anyway.
 *
 * **AND "APPENDING IS FREE" IS NOT A COROLLARY, which is how that sentence reads.** A subtype's cases are
 * ordered base-cases-first, then multi-defect variants, then furniture variants — so EVERY generated
 * variant is "later" than every base case, and appending a base case re-buckets all of them.
 *
 * Measured 2026-08-28, appending two hosts to `2.4.1:skip-link-inert`: 14 cases added and **6 existing
 * pages moved** — `skip-link-broken`'s three multi-defect and three furniture variants — for 12 captures.
 * Nothing outside the subtype moved, which is the guarantee above doing its job.
 *
 * So the cost of a new mechanism is roughly `2 x (new cases + generated variants of the subtype's
 * existing hosts)` captures. Small, and worth knowing before rather than after.
 */
function bucketFor(/** @type {any} */ id, /** @type {any} */ subtype, /** @type {any} */ indexInSubtype) {
  const offset = fnv1a(subtype ?? id);
  const index = indexInSubtype ?? fnv1a(id);
  return SCALE_BUCKETS[(offset + index) % SCALE_BUCKETS.length];
}

/**
 * Give every case realistic page furniture, identical in both of its variants.
 *
 * Done HERE rather than inside `page()` deliberately. `page()` sees only a title and a body, and those
 * differ between the good and bad variant — so any size derived from them could differ across a pair and
 * introduce a second difference into a controlled comparison. That is the one defect this corpus cannot
 * carry. Keyed on the case's identity instead, the furniture is provably identical for both variants.
 *
 * **This rule has been written down three times and said something different each time, which is the most
 * useful thing about it.** Furniture was first keyed on ARRAY POSITION, so the rule was "APPEND, never
 * insert" — a thing a human has to remember, which this repo's housekeeping rule says does not happen.
 * Then on `fnv1a(id)` alone, so it became "insert, reorder or delete freely". Both were true when written
 * and both are now wrong: independent hashing gives a SUBTYPE no coverage guarantee, which ADR 0015 makes
 * a free veto. See `bucketFor` for what replaced them.
 *
 * The rule that survived all three is the one that is a TEST rather than a paragraph:
 * `furniture-spread.test.ts` asserts the property per feature, and it is what caught the regression a
 * comment could not.
 */
export function withRealisticScale(/** @type {any} */ list) {
  // Position within the subtype, so the buckets can be dealt round-robin rather than drawn independently.
  const seen = new Map();
  const indexOf = (/** @type {any} */ testCase) => {
    const key = `${testCase.criterion}:${testCase.subtype}`;
    const next = (seen.get(key) ?? 0);
    seen.set(key, next + 1);
    return { key, index: next };
  };
  return list.map((/** @type {any} */ testCase) => {
    const { key, index } = indexOf(testCase);
    const bucket = bucketFor(testCase.id, key, index);
    // A case that drives tables itself never gets the furniture table. Not to avoid a signal collision —
    // the furniture table is conformant, so `tableHeadersAreUnassociated` cannot see it — but because
    // `probeTables` walks the page's tables, and a second one changes what the case's own probe reports.
    // These cases already carry `table_present`, so the correlation this furniture breaks is not theirs.
    let usable = testCase.probeTables ? { ...bucket, dataTable: false } : bucket;
    // SAME RULE, applied to headings. Four of the five buckets add `sections: 4`, and furniture is dealt
    // round-robin within a subtype — so four of every five `no-headings` cases would silently be given
    // headings and stop testing anything, while `check-signals` reported them as not discriminating.
    //
    // This is the principle `filler()` already states for images and form fields ("150 image cases and
    // 141 label cases are defined by exactly what those channels contain"). Headings were listed as SAFE
    // there, and that was true while the only heading case asserted a NAMED heading was absent. It stops
    // being true the moment a case asserts there are none.
    if (testCase.badSignal?.type === "structure-empty" && testCase.badSignal.field === "headings") {
      usable = { ...usable, sections: 0 };
    }
    const extra = filler(usable);
    if (!extra) return testCase;
    // Always at the SAME structural position — before `</body>`, outside any landmark.
    //
    // Injecting inside `<main>` "where there is one" looked tidier and was wrong: 58 cases are landmark
    // cases whose bad variant has no `<main>` at all, because its absence IS the labelled failure. The
    // furniture would then sit inside a landmark in one variant and outside it in the other, so NVDA would
    // announce identical text with different container prefixes. That amplifies the difference between a
    // pair in a way the label does not describe — a shortcut, the same shape as the keystroke leak that
    // sat on exactly one variant of 125 pairs. Uniform placement costs a little realism and buys a
    // controlled comparison, which is the trade this corpus exists to make.
    const inject = (/** @type {any} */ html) => html.replace("</body>", extra + "</body>");
    return { ...testCase, good: inject(testCase.good), bad: inject(testCase.bad) };
  });
}
