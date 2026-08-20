/**
 * The real-page corpus (ADR 0010), defined.
 *
 * ## Why this exists
 *
 * The trained scorer abstains on real pages, and it is right to: measured with a k-NN feature-space
 * novelty score, every synthetic training record has a near-twin (nearest-neighbour cosine 0.847-0.99)
 * and no real page does (0.50-0.84). 28 of 32 real fixtures fall below the corpus's own minimum. A linear
 * head on a frozen embedding cannot tell it is extrapolating, and it returned 0.97 and 0.99 for 4.1.2 on
 * two CONFORMANT W3C pages before abstention was introduced.
 *
 * The cost is visible in the gate: `abstained 14 of 16 failure cases`. On real pages this tool reports
 * what the deterministic rules can prove and the scorer declines. Only real-page data changes that.
 *
 * ## Why these sources and no others
 *
 * Every page here comes from a source that PUBLISHES ITS OWN CONFORMANCE CLAIM, so the label is not our
 * judgement. That is the whole selection rule, and ADR 0010 rejects the alternative outright: a corpus
 * whose labels are our opinion cannot measure whether our tool is right.
 *
 *   - W3C BAD "after" pages    — published as fully conformant to WCAG 2.0 Level AA
 *   - W3C BAD "before" pages   — published as inaccessible, with W3C's own evaluation report
 *   - W3C WAI Tutorial pages   — W3C states its site conforms to WCAG 2 AA; each page also DEMONSTRATES
 *                                a technique and names the failure it avoids
 *
 * ## The roles are kept strictly apart, and that is the point
 *
 *   test         the 32 existing eval fixtures. NOT in this file. Never trained on, never calibrated on —
 *                it is the only independent number the project has.
 *   calibration  for the conformal abstention threshold. Never trained on.
 *   training     for the realism tier. Never used to measure anything.
 *
 * `assertDisjoint` enforces all three, and `real-page-corpus.test.ts` runs it against the real fixture
 * directory rather than a list copied into a test — a copied list is one that goes stale.
 *
 * ## What this corpus is NOT
 *
 * Honest limits, because the ADR's whole argument is that calibration data must be exchangeable with
 * deployment data:
 *
 *   - The tutorial pages are DOCUMENTATION about accessibility, not applications. They are real pages with
 *     real structure, which is what the scorer has never seen — but nobody checks out of a tutorial.
 *   - Every page is W3C's own. A corpus drawn from one publisher shares that publisher's house style, and
 *     a scorer calibrated on it may still find a commercial site novel.
 *   - 26 pages is small. It is enough to calibrate a threshold against a stated error rate; it is not
 *     enough to train a realism tier on its own.
 *
 * Widening past W3C means finding other publishers who state their own conformance — not labelling pages
 * ourselves, which would put us back where we started.
 */

/** @typedef {"calibration" | "training"} CorpusRole */

/**
 * @typedef {object} RealPage
 * @property {string} url
 * @property {CorpusRole} role
 * @property {"conformant" | "inaccessible"} publishedClaim  What the SOURCE says, never our assessment.
 * @property {string} source  Where that claim is published, so a reader can check it.
 * @property {string} demonstrates  What the page is an example of, in the source's own terms.
 * @property {string[]} [claimExcludes]  Criteria or subtypes the source's statement does NOT claim, as
 *   `"1.4.3"` or `"1.1.1:missing-alt"`. Empty or absent means the claim covers everything we score.
 *
 *   This is what makes a "partially compliant" statement usable, and those are the majority: PSBAR 2018
 *   obliges every UK public sector body to publish one, and they overwhelmingly say "partially compliant"
 *   with an ENUMERATED list of failures rather than "fully compliant" -- because they are being honest.
 *   GOV.UK's lists 20, each mapped to a criterion.
 *
 *   Such a statement is a RICHER label than a bare full-compliance claim: it says what is good and what is
 *   not, in the publisher's own words. It only becomes usable if the enumerated criteria can be marked
 *   unknown instead of silently trained as clean, which is what this field feeds (`unknownSubtypes` in the
 *   export, `known_indices` in the trainer).
 *
 *   Without it the pool is limited to full-compliance claims, and those cluster almost entirely in
 *   accessibility-led DOCUMENTATION sites -- W3C's tutorials, the GOV.UK Design System, the NHS service
 *   manual. All verified, all real, and all sharing the structural homogeneity the realism tier exists to
 *   break. Measured: 14 extra pages inside six existing families bought +0.004.
 */

const BAD_AFTER_CLAIM =
  "W3C publishes the Before/After Demo 'after' pages as conforming to WCAG 2.0 Level AA "
  + "(https://www.w3.org/WAI/demos/bad/)";
const BAD_BEFORE_CLAIM =
  "W3C publishes the 'before' pages as the inaccessible version, with its own evaluation report "
  + "(https://www.w3.org/WAI/demos/bad/before/annualreport/)";
// A SECOND publisher, which is the point. Verified 2026-08-19 against the statement itself, which scopes
// the claim to the whole site and states there is no known non-compliant content:
//
//   "The Design System website at design-system.service.gov.uk is fully compliant with the Web Content
//    Accessibility Guidelines (WCAG) version 2.2 AA standard."
//
// WCAG 2.2 AA, a level above the BAD demo's 2.0 AA. GOV.UK itself was considered and REJECTED as a source:
// its statement says "partially compliant" for the WEBSITE and enumerates 20 failures against specific
// content, which gives no per-PAGE label -- and a label we inferred would be our judgement, which is
// exactly what this corpus exists to avoid.
const DESIGN_SYSTEM_CLAIM =
  "The Cabinet Office publishes design-system.service.gov.uk as fully compliant with WCAG 2.2 Level AA, "
  + "with no known non-compliant content (https://design-system.service.gov.uk/accessibility-statement/)";

const TUTORIAL_CLAIM =
  "W3C states its site conforms to WCAG 2 Level AA (https://www.w3.org/WAI/), and each tutorial page "
  + "demonstrates the technique it names";

/**
 * The corpus.
 *
 * Split calibration/training by SOURCE FAMILY rather than at random, deliberately. A random split puts
 * `images/decorative` in calibration and `images/informative` in training, and those two pages share a
 * template, a navigation bar and a footer — so the threshold would be calibrated against structure the
 * model had already been trained on, which is the leak this separation exists to prevent.
 */
export const REAL_PAGES = /** @type {RealPage[]} */ ([
  // --- CALIBRATION: the conformal abstention threshold is fitted here, and nowhere else. -------------
  // The BAD demo, both variants, because a threshold fitted only on conformant pages cannot tell you what
  // it costs on failing ones. `after/home.html` and `before/home.html` are absent: they are TEST fixtures.
  { url: "https://www.w3.org/WAI/demos/bad/after/news.html", role: "calibration",
    publishedClaim: "conformant", source: BAD_AFTER_CLAIM, demonstrates: "news article layout, fixed" },
  { url: "https://www.w3.org/WAI/demos/bad/after/tickets.html", role: "calibration",
    publishedClaim: "conformant", source: BAD_AFTER_CLAIM, demonstrates: "purchase form, fixed" },
  { url: "https://www.w3.org/WAI/demos/bad/after/template.html", role: "calibration",
    publishedClaim: "conformant", source: BAD_AFTER_CLAIM, demonstrates: "page template, fixed" },
  { url: "https://www.w3.org/WAI/demos/bad/after/survey.html", role: "calibration",
    publishedClaim: "conformant", source: BAD_AFTER_CLAIM, demonstrates: "survey form, fixed" },
  { url: "https://www.w3.org/WAI/demos/bad/before/news.html", role: "calibration",
    publishedClaim: "inaccessible", source: BAD_BEFORE_CLAIM, demonstrates: "news article layout, broken" },
  { url: "https://www.w3.org/WAI/demos/bad/before/tickets.html", role: "calibration",
    publishedClaim: "inaccessible", source: BAD_BEFORE_CLAIM, demonstrates: "purchase form, broken" },
  { url: "https://www.w3.org/WAI/demos/bad/before/template.html", role: "calibration",
    publishedClaim: "inaccessible", source: BAD_BEFORE_CLAIM, demonstrates: "page template, broken" },


  // --- CALIBRATION, second publisher: GOV.UK Design System component pages. --------------------
  // Chosen to exercise the criteria this scorer actually covers -- form fields, validation,
  // disclosure state, tables and bypass links -- rather than to be a representative sample of the
  // web, which twelve pages could not be. Every one is a CONFORMANT claim, deliberately: the column
  // that decides the abstention floor is false positives on pages their publisher calls conformant.
  // Nobody publishes 'this page is inaccessible' outside a teaching demo, so the failing side of the
  // calibration set stays W3C's, and that imbalance is a real limit rather than an oversight.
  { url: "https://design-system.service.gov.uk/components/text-input/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "single-line text field with label and hint" },
  { url: "https://design-system.service.gov.uk/components/checkboxes/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "checkbox group inside a fieldset legend" },
  { url: "https://design-system.service.gov.uk/components/radios/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "radio group inside a fieldset legend" },
  { url: "https://design-system.service.gov.uk/components/select/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "native select with a label" },
  { url: "https://design-system.service.gov.uk/components/date-input/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "multi-part date field, three inputs one question" },
  { url: "https://design-system.service.gov.uk/components/error-message/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "field-level validation message" },
  { url: "https://design-system.service.gov.uk/components/error-summary/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "page-level error summary that moves focus" },
  { url: "https://design-system.service.gov.uk/components/details/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "disclosure widget, expanded/collapsed state" },
  { url: "https://design-system.service.gov.uk/components/accordion/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "multiple disclosures with state" },
  { url: "https://design-system.service.gov.uk/components/tabs/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "tab list with selected state" },
  { url: "https://design-system.service.gov.uk/components/table/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "data table with row and column headers" },
  { url: "https://design-system.service.gov.uk/components/skip-link/", role: "calibration",
    publishedClaim: "conformant", source: DESIGN_SYSTEM_CLAIM, demonstrates: "bypass block, first focusable element" },

  // --- TRAINING: the realism tier. Never used to measure anything. -----------------------------------
  // Tutorial sub-examples, which is where the STRUCTURE the scorer has never seen lives: real navigation,
  // real footers, code samples inside prose, and heading depth no generated page produces.
  { url: "https://www.w3.org/WAI/tutorials/images/decorative/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "decorative images, alt=\"\"" },
  { url: "https://www.w3.org/WAI/tutorials/images/functional/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "functional images in links and buttons" },
  { url: "https://www.w3.org/WAI/tutorials/images/informative/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "informative images with text alternatives" },
  { url: "https://www.w3.org/WAI/tutorials/images/groups/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "groups of images" },
  { url: "https://www.w3.org/WAI/tutorials/images/complex/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "complex images with long descriptions" },
  { url: "https://www.w3.org/WAI/tutorials/tables/one-header/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "table with one header row" },
  { url: "https://www.w3.org/WAI/tutorials/tables/two-headers/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "table with two headers" },
  { url: "https://www.w3.org/WAI/tutorials/tables/irregular/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "irregular table headers" },
  { url: "https://www.w3.org/WAI/tutorials/tables/multi-level/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "multi-level table headers" },
  { url: "https://www.w3.org/WAI/tutorials/forms/labels/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "form control labelling" },
  { url: "https://www.w3.org/WAI/tutorials/forms/instructions/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "form instructions" },
  { url: "https://www.w3.org/WAI/tutorials/forms/grouping/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "grouping controls with fieldset" },
  { url: "https://www.w3.org/WAI/tutorials/forms/validation/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "user notifications and validation" },
  { url: "https://www.w3.org/WAI/tutorials/forms/multi-page/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "multi-page forms" },
  { url: "https://www.w3.org/WAI/tutorials/menus/structure/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "menu structure" },
  { url: "https://www.w3.org/WAI/tutorials/menus/flyout/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "fly-out menus" },
  { url: "https://www.w3.org/WAI/tutorials/carousels/structure/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "carousel structure" },
  { url: "https://www.w3.org/WAI/tutorials/page-structure/headings/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "heading hierarchy" },
  { url: "https://www.w3.org/WAI/tutorials/page-structure/regions/", role: "training",
    publishedClaim: "conformant", source: TUTORIAL_CLAIM, demonstrates: "page regions and landmarks" },
]);

/** Pages for one role. */
export function pagesFor(role) {
  return REAL_PAGES.filter((page) => page.role === role);
}

/**
 * Refuse any overlap between the three roles.
 *
 * Returns the offending URLs rather than throwing, so a caller can report ALL of them at once — a check
 * that stops at the first collision makes fixing a corpus an iterative guessing game.
 *
 * Compared on a NORMALISED url (trailing slash, case, fragment), because `…/labels` and `…/labels/` are
 * the same page and a set membership test would happily call them different.
 *
 * @param {readonly string[]} testUrls  URLs already used as eval fixtures.
 */
export function assertDisjoint(testUrls) {
  const norm = (url) => String(url).trim().toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
  const test = new Set(testUrls.map(norm));
  const seen = new Map();
  const collisions = [];
  for (const page of REAL_PAGES) {
    const key = norm(page.url);
    if (test.has(key)) collisions.push(`${page.url} is already an eval TEST fixture`);
    const previous = seen.get(key);
    if (previous && previous !== page.role) {
      collisions.push(`${page.url} appears in both ${previous} and ${page.role}`);
    } else if (previous) {
      collisions.push(`${page.url} appears twice in ${page.role}`);
    }
    seen.set(key, page.role);
  }
  return collisions;
}
