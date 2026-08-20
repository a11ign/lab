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

/**
 * HOW A PUBLISHER'S STATEMENT BECOMES A LABEL. The rule, so nobody has to re-derive it per candidate.
 *
 * PSBAR 2018 obliges every UK public sector body to publish an accessibility statement, and the EU
 * (2016/2102) and US Section 508 have equivalents. Almost all of them say "partially compliant" with an
 * enumerated list of failures, because they are being honest. That reads like a disqualification and is not:
 *
 *   1. Does the exception list name any criterion WE score (1.1.1, 1.3.1, 2.4.4, 2.4.6, 3.3.1, 3.3.2,
 *      4.1.2, 4.1.3)? If not, the page is effectively FULLY claimed for our purposes and `clean` is the
 *      source's assertion across every head. Verified example: gov.scot is "partially compliant with WCAG
 *      2.2 AA", and its exceptions are PDF documents and a menu button at 200% magnification -- neither is
 *      a criterion we assess, so the intersection is EMPTY.
 *   2. Otherwise, put the intersection in `claimExcludes`. Verified example: the ONS statement names 1.3.1,
 *      2.4.4, 2.4.6, 3.3.1, 3.3.2 and 4.1.2 -- six of our eight -- so an ONS page is masked for six heads.
 *
 * **A heavily masked page is still fully useful**, and that is what makes the pool large. Its evidence
 * enters the OOD reference, which is what buys structural familiarity and is the entire point of the
 * realism tier; the mask only removes it from head TRAINING. So the worst case is a page that contributes
 * structure and asserts nothing, which is exactly what we want from it.
 *
 * That inverts the search. It is not "find publishers claiming full compliance" -- those turn out to be
 * almost entirely accessibility-led DOCUMENTATION sites (W3C's tutorials, the GOV.UK Design System, the
 * NHS service manual: all verified, all real, all sharing the homogeneity this tier exists to break). It is
 * "any public sector body", masked honestly. And our eight are all SCREEN-READER criteria while the typical
 * public-sector failure list is dominated by contrast, PDFs, resize and target size -- so the intersection
 * is frequently empty anyway.
 *
 * Mask at SITE level, conservatively. A statement usually scopes its failures to specific features ("the
 * interactive polls", "the NSDP data links") and we cannot attribute those per page, so a page without the
 * feature is masked anyway. That is the cheap direction to be wrong in: it costs labels, not structure.
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

  // --- CALIBRATION, publishers whose claim covers EVERY criterion we score. -------------------------
  // Only an unqualified claim can be a calibration page: `calibrate-abstention.mjs` counts ANY finding
  // on a `conformant` page as a false positive, so a partially-compliant page would be scored as a
  // false accusation for correctly finding a criterion its publisher disclaims. Everything else goes
  // to TRAINING, where the per-head mask handles the exceptions properly.
  { url: "https://disinfectants.defra.gov.uk/DisinfectantsExternal/Default.aspx?Module=ApprovalsList_SI", role: "calibration",
    publishedClaim: "conformant",
    source: "Defra Disinfectants Approvals: fully compliant with WCAG 2.2 AA (https://disinfectants.defra.gov.uk/accessibility-statement)",
    demonstrates: "approvals search results over a data table" },
  { url: "https://docs.sign-in.service.gov.uk/integrate-with-integration-environment/", role: "calibration",
    publishedClaim: "conformant",
    source: "GOV.UK One Login developer docs: fully compliant with WCAG 2.1 AA (https://docs.sign-in.service.gov.uk/accessibility-statement)",
    demonstrates: "technical integration documentation" },
  { url: "https://www.gov.scot/publications/", role: "calibration",
    publishedClaim: "conformant",
    source: "Scottish Government: partially compliant with WCAG 2.2 AA; exceptions are PDF documents and a menu button at 200% zoom, neither a criterion we score (https://gov.scot/accessibility/)",
    demonstrates: "government publication listing" },

  // --- TRAINING, one page per publisher. Structures come from PUBLISHERS, measured. ----------------
  // 14 extra pages inside six existing families bought +0.004; the +0.11 came from the structures.
  // So: one page each, and `family` defaults to the page id so every publisher is its own structure.
  //
  // `claimExcludes` is the intersection of the statement's OWN enumerated failures with the eight
  // criteria we score. Those heads see nothing from this page; the rest take it as clean. Where a
  // claim is unclear or unquantified the whole set is excluded -- structure only, asserting nothing.
  { url: "https://www.financial-ombudsman.org.uk/decisions-case-studies/ombudsman-decisions", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2", "4.1.3"],
    source: "Financial Ombudsman Service: partially compliant, own statement (https://financial-ombudsman.org.uk/accessibility-statement)",
    demonstrates: "ombudsman decision search" },
  { url: "https://www.nls.uk/join/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2"],
    source: "National Library of Scotland: partially compliant, own statement (https://nls.uk/web-accessibility-statement/)",
    demonstrates: "library membership form" },
  { url: "https://www.leeds.ac.uk/undergraduate", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2"],
    source: "University of Leeds: partially compliant, own statement (https://leeds.ac.uk/accessibility)",
    demonstrates: "undergraduate course prospectus" },
  { url: "https://tfl.gov.uk/plan-a-journey/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "3.3.1", "3.3.2", "4.1.2", "4.1.3"],
    source: "Transport for London: partially compliant, own statement (https://tfl.gov.uk/corporate/website-accessibility/accessibility-statement)",
    demonstrates: "journey planner form" },
  { url: "https://www.british-history.ac.uk/catalogue", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "2.4.6", "4.1.2", "4.1.3"],
    source: "British History Online: partially compliant, own statement (https://british-history.ac.uk/accessibility)",
    demonstrates: "historical catalogue data table" },
  { url: "https://www.nationalarchives.gov.uk/help-with-your-research/research-guides/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "2.4.6", "3.3.1", "4.1.2"],
    source: "The National Archives: partially compliant, own statement (https://nationalarchives.gov.uk/accessibility-statement/)",
    demonstrates: "research guide index" },
  { url: "https://forms.charitycommission.gov.uk/raising-concerns/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.3.1", "2.4.6", "3.3.2", "4.1.2", "4.1.3"],
    source: "Charity Commission online forms: partially compliant, own statement (https://forms.charitycommission.gov.uk/Accessibility-Statement/)",
    demonstrates: "multi-step concern-reporting form" },
  { url: "https://www.lbhf.gov.uk/council-tax", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "3.3.1", "4.1.2"],
    source: "Hammersmith and Fulham Council: partially compliant, own statement (https://lbhf.gov.uk/accessibility-statement)",
    demonstrates: "council tax guidance" },
  { url: "https://www.nhs.uk/service-search/find-a-gp", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.6", "3.3.1", "4.1.3"],
    source: "NHS website: partially compliant, own statement (https://nhs.uk/accessibility-statement/)",
    demonstrates: "GP finder search" },
  { url: "https://primary-authority.beis.gov.uk/par", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.3.1", "3.3.2", "4.1.2", "4.1.3"],
    source: "Primary Authority Register: partially compliant, own statement (https://gov.uk/guidance/primary-authority-register-accessibility-statement)",
    demonstrates: "regulatory register search" },
  { url: "https://www.historicenvironment.scot/visit-a-place/places/edinburgh-castle/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.3.1", "3.3.1", "4.1.2", "4.1.3"],
    source: "Historic Environment Scotland: partially compliant, own statement (https://historicenvironment.scot/accessibility-statements/website-accessibility/)",
    demonstrates: "visitor attraction page" },
  { url: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2025-to-2026", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.6", "4.1.2"],
    source: "GOV.UK: partially compliant, own statement (https://gov.uk/help/accessibility-statement)",
    demonstrates: "tax guidance with 23 data tables" },
  { url: "https://www.sepa.org.uk/environment/water/bathing-waters/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "4.1.2"],
    source: "SEPA: partially compliant, own statement (https://sepa.org.uk/help/accessibility/)",
    demonstrates: "environmental data index" },
  { url: "https://www.sheffield.ac.uk/postgraduate/taught/courses", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.6", "4.1.2"],
    source: "University of Sheffield: partially compliant, own statement (https://sheffield.ac.uk/accessibility)",
    demonstrates: "postgraduate course search" },
  { url: "https://find-and-update.company-information.service.gov.uk/company/00000006", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "3.3.2", "4.1.2"],
    source: "Companies House: partially compliant, own statement (https://find-and-update.company-information.service.gov.uk/help/accessibility-statement)",
    demonstrates: "company record" },
  { url: "https://ico.org.uk/action-weve-taken/enforcement/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "4.1.2"],
    source: "Information Commissioner's Office: partially compliant, own statement (https://ico.org.uk/global/accessibility/)",
    demonstrates: "enforcement action listing" },
  { url: "https://www.mygov.scot/scottish-child-payment", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "4.1.2"],
    source: "mygov.scot: partially compliant, own statement (https://mygov.scot/accessibility)",
    demonstrates: "benefit eligibility guidance" },
  { url: "https://www.nrscotland.gov.uk/publications/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "4.1.3"],
    source: "National Records of Scotland: partially compliant, own statement (https://nrscotland.gov.uk/accessibility/)",
    demonstrates: "statistical publication listing" },
  { url: "https://www.networkrail.co.uk/careers/careers-search/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4"],
    source: "Network Rail: partially compliant, own statement (https://networkrail.co.uk/accessibility/)",
    demonstrates: "job vacancy search" },
  { url: "https://www.sportengland.org/research-and-data/data/active-lives", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.3.1", "4.1.2", "4.1.3"],
    source: "Sport England: partially compliant, own statement (https://sportengland.org/corporate-information/accessibility-statement)",
    demonstrates: "research data index" },
  { url: "https://www.transport.gov.scot/publications/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "2.4.4"],
    source: "Transport Scotland: partially compliant, own statement (https://transport.gov.scot/accessibility/)",
    demonstrates: "transport publication listing" },
  { url: "https://caselaw.nationalarchives.gov.uk/judgments/search?query=", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1"],
    source: "Find Case Law: partially compliant, own statement (https://caselaw.nationalarchives.gov.uk/accessibility-statement)",
    demonstrates: "case law search results" },
  { url: "https://www.cqc.org.uk/search/all?query=hospital", role: "training",
    publishedClaim: "conformant", claimExcludes: ["4.1.2"],
    source: "Care Quality Commission: partially compliant, own statement (https://cqc.org.uk/about-us/our-policies/accessibility-statement)",
    demonstrates: "regulator search results" },
  { url: "https://reports.ofsted.gov.uk/search?q=school", role: "training",
    publishedClaim: "conformant", claimExcludes: ["4.1.2"],
    source: "Ofsted inspection reports: partially compliant, own statement (https://reports.ofsted.gov.uk/accessibility-statement)",
    demonstrates: "inspection report search" },
  { url: "https://ratings.food.gov.uk/search-a-local-authority-area", role: "training",
    publishedClaim: "conformant", claimExcludes: ["4.1.2"],
    source: "FSA Food Hygiene Ratings: partially compliant, own statement (https://ratings.food.gov.uk/accessibility-statement)",
    demonstrates: "hygiene rating search form" },
  { url: "https://www.ofgem.gov.uk/energy-price-cap", role: "training",
    publishedClaim: "conformant", claimExcludes: ["4.1.3"],
    source: "Ofgem: partially compliant, own statement (https://ofgem.gov.uk/website-accessibility)",
    demonstrates: "energy price cap explainer" },
  { url: "https://www.scotcourts.gov.uk/judgments/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1"],
    source: "Scottish Courts and Tribunals: partially compliant, own statement (https://scotcourts.gov.uk/accessibility)",
    demonstrates: "court judgment listing" },
  { url: "https://check-for-flooding.service.gov.uk/river-and-sea-levels", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1"],
    source: "Environment Agency flood service: partially compliant, own statement (https://check-for-flooding.service.gov.uk/accessibility-statement)",
    demonstrates: "live river level data" },
  { url: "https://www.gla.ac.uk/undergraduate/degrees/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1"],
    source: "University of Glasgow: partially compliant, own statement (https://gla.ac.uk/legal/accessibility/)",
    demonstrates: "degree programme listing" },
  { url: "https://data.southwark.gov.uk/data-catalog-explorer/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["2.4.6"],
    source: "Southwark Council data portal: partially compliant, own statement (https://data.southwark.gov.uk/accessibility-statement/)",
    demonstrates: "open data catalogue" },
  { url: "https://www.ons.gov.uk/economy/inflationandpriceindices", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2"],
    source: "Office for National Statistics: partially compliant, own statement (https://ons.gov.uk/help/accessibility)",
    demonstrates: "inflation statistics with data tables" },
  { url: "https://www.gov.wales/statistics-and-research", role: "training",
    publishedClaim: "conformant", claimExcludes: ["2.4.4"],
    source: "Welsh Government: partially compliant, own statement (https://gov.wales/accessibility-statement-govwales)",
    demonstrates: "statistics and research index" },
  { url: "https://service-manual.nhs.uk/design-system/components/text-input", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2", "4.1.3"],
    source: "NHS digital service manual: partially compliant, own statement (https://service-manual.nhs.uk/accessibility-statement)",
    demonstrates: "design system component documentation" },
  { url: "https://www.metoffice.gov.uk/weather/forecast/gcpvj0v07", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2", "4.1.3"],
    source: "Met Office: partially compliant, own statement (https://metoffice.gov.uk/policies/accessibility-met-office-website)",
    demonstrates: "weather forecast with 85 data tables" },
  { url: "https://www.nidirect.gov.uk/information-and-services/motoring/mot-and-vehicle-testing", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2", "4.1.3"],
    source: "nidirect: partially compliant, own statement (https://nidirect.gov.uk/articles/accessibility-statement-nidirect)",
    demonstrates: "motoring service index" },
  { url: "https://www.bl.uk/whats-on/", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2", "4.1.3"],
    source: "British Library: partially compliant, own statement (https://bl.uk/accessibility-statement)",
    demonstrates: "events listing" },
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
