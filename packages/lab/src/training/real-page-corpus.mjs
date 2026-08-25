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
 *   - It began as W3C's own and now spans 41 publishers, but they are overwhelmingly UK public sector and
 *     design-system pages, which share a house style: measured, the GOV.UK Design System components all
 *     land within 0.005 of each other on the novelty score (~0.79). One legacy ASP.NET page sits at 0.4633,
 *     far outside everything else — that is the shape of structure the corpus still has never seen.
 *   - 77 pages across 41 publishers, of which **74 are claimed conformant and 3 inaccessible**. That
 *     imbalance is the real limit, and it is worse than it looks — see the note below on what the three
 *     actually contain. It is enough to calibrate a threshold; it is not enough to demonstrate that the
 *     scorer detects real-world failures.
 *
 * Widening past W3C means finding other publishers who state their own conformance — not labelling pages
 * ourselves, which would put us back where we started.
 */

/**
 * WHAT THE POSITIVE SIDE OF THIS CORPUS ACTUALLY IS — measured 2026-08-22, and smaller than it looks.
 *
 * The abstention sweep reports "2 of 3 inaccessible caught", which reads like coverage of three distinct
 * real-world failures. It is not. Every form control the three `before` captures contain is this:
 *
 *   before-news      ["combo box, collapsed, QUICKMENU ---- greater"]
 *   before-template  ["combo box, collapsed, QUICKMENU ---- greater"]
 *   before-tickets   ["combo box, collapsed, QUICKMENU ---- greater"]
 *
 * One unnamed combo box, in the site chrome the three pages share, in three copies of one template. The
 * matching `after` pages carry the same widget correctly named ("Explore Site by Topic:, combo box"), so
 * the 4.1.2 findings are real — but they are ONE defect observed three times, not three failures. The
 * scorer's entire demonstrated ability to detect a real-world failure rests on it.
 *
 * `before/tickets.html` is missed, and that is not a model weakness. It has **no form at all**: 0 `<form>`,
 * 0 `<input>`, one `<select>`, 14 layout tables, 1 heading, 0 landmarks. Its label said "purchase form,
 * broken" — the purchase form is on `survey.html`. The failures it does have are largely ones this
 * evidence cannot express: table structure needs `probeTables`, which real-page captures deliberately do
 * not run, and layout-table misuse is not in the head set at all.
 *
 * So "2 of 3" was never a fair test of the model in either direction. Widening the corpus means finding
 * pages whose publisher-stated failures are ones a screen reader can actually witness — not simply more
 * pages labelled inaccessible.
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

/**
 * @typedef {"calibration" | "training" | "fixture"} CorpusRole
 *
 * `calibration` fits the scorer's abstention threshold. `training` is what the scorer learns from.
 * `fixture` is NEITHER, and the separation is load-bearing rather than tidy.
 *
 * ADR 0015's why-2: every publisher-declared inaccessible page lives in calibration, so the TRAINING
 * distribution contains no broken page at all — which is why a real inaccessible page sits further from
 * the training set than its conformant twin (0.6978 vs 0.8164 on the two tickets.html variants). Put a
 * broken page in training and that novelty signal changes meaning; put one in calibration and it is no
 * longer held out.
 *
 * `fixture` pages are for the RULE layer, which is a different question with a different measurement.
 * They demonstrate one criterion each, carry a `witnessableAs` label we authored, and are excluded from
 * both statistical sets by construction — so `rules:coverage` can be satisfied without touching what
 * either scorer number means.
 */

/**
 * @typedef {object} RealPage
 * @property {string} url
 * @property {CorpusRole} role
 * @property {"conformant" | "inaccessible"} publishedClaim  What the SOURCE says, never our assessment.
 * @property {string} source  Where that claim is published, so a reader can check it.
 * @property {string} demonstrates  What the page is an example of, in the source's own terms.
 * @property {string[]} [witnessableAs]  Which criteria a CAPTURE could witness this page's published
 *   failure as. Required on every `inaccessible` page and meaningless on a conformant one -- see the
 *   WITNESSABILITY note below `RealPage`. Enforced by `real-page-corpus.test.ts`, which refuses a
 *   criterion with no scorer head and one whose probe does not run on pages we do not own.
 * @property {string[]} [claimDiscloses]  Criteria or subtypes the statement ENUMERATES as failing, in its
 *   own words. A strict subset of `claimExcludes` and, for now, deliberately empty everywhere.
 *
 *   **The seam this opens, stated plainly.** `contradictedFindings` documents three cases — *claimed*
 *   (a finding contradicts the statement: a false positive), *disclosed* (the statement names this as
 *   failing: corroborated), and *unmentioned* (nothing said either way: unknown). The comment is right and
 *   the DATA has only two states: in `claimExcludes`, or not. So disclosed and unmentioned are handled
 *   identically, and the sweep's `disclosed` column counts both — this repo's signature defect, a comment
 *   naming an ambiguity above code that resolves it by assumption.
 *
 *   It costs something real. A publisher who writes "this page fails 3.3.2" has given us a POSITIVE label
 *   we currently discard. PSBAR 2018 obliges every UK public sector body to publish a statement, and they
 *   overwhelmingly enumerate their failures — so most of this corpus's 36 excluded pages are probably
 *   disclosures rather than silences, which would make them usable positives on criteria where the corpus
 *   has almost none.
 *
 *   **Why it is empty rather than populated in this change.** Filling it means re-reading 36 publishers'
 *   statements and classifying every entry, and a wrong classification turns a silence into a claimed
 *   failure — inventing ground truth, which is the one thing this corpus exists not to do. The field is
 *   added so the distinction is EXPRESSIBLE and can be migrated page by page against the cited source. Any
 *   entry here must also appear in `claimExcludes`, which `real-page-corpus.test.ts` asserts.
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
/**
 * Our OWN fixtures, served over HTTP and captured through the real-page path.
 *
 * The corpus can express three failures no published source does — an inert skip link, a route that
 * changes while the title stands still, a control announced but unreachable — and that is not a
 * coincidence: `criterion-coverage.ts` calls those three "structurally unreachable by a static
 * analyser", so static test suites do not contain them BECAUSE static tools cannot test them.
 *
 * Searched for an external source on 2026-08-25 before authoring these. W3C's ACT Rules publish 1,213
 * machine-readable test cases with per-page pass/fail outcomes — the right SHAPE of label, and the only
 * one found — and they do not cover it: **zero** failed examples for 2.4.1; 2.4.2's eight are all
 * missing-or-undescriptive title rather than the route-change mode; and 2.1.1's three are nine-line DOM
 * fixtures like `<iframe tabindex="-1" srcdoc="<a>Home</a>">`, which cannot produce the closed tab cycle
 * our rule requires. They are fixtures for static checkers, and this is a screen-reader tool.
 *
 * So the label here is ours, and it is honest for the same reason the eval fixtures are: we wrote the
 * page to demonstrate one defect, and `witnessableAs` names which. The distinction from a publisher
 * claim is real and is why these are TRAINING rather than calibration — calibration fits the scorer's
 * abstention threshold against labels we did not author, and these would weaken that.
 */
/**
 * Where the fixture pages are served. `DATASET_BASE_URL` is the same variable the corpus runner uses, so
 * the lab rewrites `localhost` to its own LAN address for the guests exactly as it already does — the
 * workers are remote, and a guest's `localhost` is the guest.
 */
const FIXTURE_BASE = (process.env.DATASET_BASE_URL || "http://localhost:5050").replace(/\/$/, "");

const OWN_FIXTURE_CLAIM =
  "Authored by this project to demonstrate one failure, served over HTTP and captured through the "
  + "real-page path (packages/lab/src/training/case-matrix.mjs)";

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
/**
 * WITNESSABILITY — what a page has to be able to SHOW before it earns a place here (ADR 0015, decision 4).
 *
 * A page whose published failure cannot reach the evidence a capture produces adds a row and no signal. It
 * inflates the denominator, so it makes the reported rate worse while teaching the model nothing.
 * `before/tickets.html` is one third of the positive denominator and its real failures — layout tables,
 * missing structure — are ones this evidence cannot express: `probeTables` is off for pages we do not own,
 * and layout-table misuse is not in the head set at all. It was never a fair test in either direction.
 *
 * So every page published as INACCESSIBLE must declare `witnessableAs`: which criteria its published
 * failure would fire, through a probe real-page capture actually runs. Naming it forces the question to be
 * answered before capture time rather than discovered in a sweep afterwards, and
 * `real-page-corpus.test.ts` refuses an entry that names a criterion this pipeline cannot reach.
 *
 * **3.3.1 and 4.1.3 are unreachable here and always will be under this policy.** They read only what the
 * form-submission probe produces, and `capture-real-pages.mjs` sets `probeForms: false` because pressing
 * *Book* on a stranger's site is not a review. Measured: 0 of 77 real captures carry `formChanges` or
 * `postSubmitFields`.
 *
 * Conformant pages need no declaration. Their job is to be a page the tool must NOT accuse, and any
 * structure at all serves that.
 */
export const UNWITNESSABLE_ON_REAL_PAGES = Object.freeze(["3.3.1", "4.1.3"]);

export const REAL_PAGES = /** @type {RealPage[]} */ ([
  // --- CALIBRATION: the conformal abstention threshold is fitted here, and nowhere else. -------------
  // The BAD demo, both variants, because a threshold fitted only on conformant pages cannot tell you what
  // it costs on failing ones.
  //
  // FOUR before/after pairs exist upstream and only three are here. `home` and `survey` are absent for the
  // same reason and it is not symmetry: both are eval TEST fixtures (`w3c-bad-before`,
  // `w3c-bad-before-survey` in `cases.ts`), and the test set is the only independent number this project
  // has. This comment used to name `home` alone, which read as an oversight about `survey` — enough of one
  // that somebody later added `before/survey.html` here on exactly that reasoning. `assertDisjoint` caught
  // it, which is the guard working; the comment is now specific so the next reader does not have to rely
  // on it.
  //
  // SEARCHED FOR MORE ON 2026-08-24, AND THERE ARE NONE. Three independent sources checked, all aggregate:
  //
  //   accessibility statements   site-level by design. "Partially compliant" scopes failures to FEATURES.
  //                              NPSA's names form controls "missing a 'label' tag" -- a real 3.3.2/4.1.2
  //                              claim, and about the site, so it licenses `claimExcludes` and no page label.
  //   WCAG-EM evaluation reports the methodology built for per-page conformance. Fetched a published one
  //                              (nelincs.gov.uk): it names 20 tested URLs and then reports every criterion
  //                              AGGREGATED across the sample. No "page X failed 1.1.1" anywhere.
  //   GDS PSBAR monitoring       1,203 sites monitored, findings reported as themes ("not enough colour
  //                              contrast", "lack of visible focus"). Per-organisation audit PDFs do exist
  //                              and are worse for us: dated 2021, so the label describes a page that no
  //                              longer exists at that URL.
  //
  // The last one is the general trap and worth stating: a label must describe the page AS CAPTURED. An
  // audit and a capture years apart are two different pages wearing one URL, and nothing in the pipeline
  // would notice.
  //
  // So pages published as INACCESSIBLE are capped at three from this source, and that is a limit of the
  // labelling discipline rather than an oversight: a site-level accessibility statement says "partially
  // compliant" and scopes its failures to features, which licenses `claimExcludes` and never a page-level
  // `inaccessible`. W3C's PER-PAGE reports are the only source here that names what a specific page fails,
  // and its four before pages are now fully allocated between calibration and test.
  { url: "https://www.w3.org/WAI/demos/bad/after/news.html", role: "calibration",
    publishedClaim: "conformant", source: BAD_AFTER_CLAIM, demonstrates: "news article layout, fixed" },
  { url: "https://www.w3.org/WAI/demos/bad/after/tickets.html", role: "calibration",
    publishedClaim: "conformant", source: BAD_AFTER_CLAIM, demonstrates: "ticket listing, fixed — NOT a form: 0 <form>, 0 <input>, one named combo box in the shared chrome" },
  { url: "https://www.w3.org/WAI/demos/bad/after/template.html", role: "calibration",
    publishedClaim: "conformant", source: BAD_AFTER_CLAIM, demonstrates: "page template, fixed" },
  { url: "https://www.w3.org/WAI/demos/bad/after/survey.html", role: "calibration",
    publishedClaim: "conformant", source: BAD_AFTER_CLAIM, demonstrates: "survey form, fixed" },
  { url: "https://www.w3.org/WAI/demos/bad/before/news.html", role: "calibration",
    publishedClaim: "inaccessible", source: BAD_BEFORE_CLAIM, witnessableAs: ["4.1.2"], demonstrates: "news article layout, broken" },
  { url: "https://www.w3.org/WAI/demos/bad/before/tickets.html", role: "calibration",
    publishedClaim: "inaccessible", source: BAD_BEFORE_CLAIM, witnessableAs: ["4.1.2"], demonstrates: "ticket listing, broken — NOT a form: 0 <form>, 0 <input>, 14 layout tables. See the WHAT THE POSITIVES ACTUALLY ARE note above" },
  { url: "https://www.w3.org/WAI/demos/bad/before/template.html", role: "calibration",
    publishedClaim: "inaccessible", source: BAD_BEFORE_CLAIM, witnessableAs: ["4.1.2"], demonstrates: "page template, broken" },


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

  // ---- CALIBRATION WIDENING, 2026-08-24 ------------------------------------------------------------
  //
  // 38 calibration pages resolve an error rate of about 2.6% at best — the sweep says so in its own
  // output — and a tool that ASSERTS conformance failures needs finer resolution than that. This batch
  // roughly doubles the set.
  //
  // Every page here comes from a publisher ALREADY in this corpus, and that is the point rather than
  // laziness: the expensive part of a real-page label is not the URL, it is establishing what the
  // publisher claims and which criteria their statement excludes. That work is done and cited above for
  // each of these sites; a second page inherits it, because an accessibility statement is SITE-level by
  // design — the same property that caps publisher-declared INACCESSIBLE pages at three.
  //
  // Chosen for SHAPE rather than novelty: each is a page type the corpus is thin on — a long-form guide,
  // a filtered list, a form-led start page, a data table, a search result. Bag size and structure are
  // what the scorer sees, so a fifth publication listing would add pages without adding evidence.
  { url: "https://www.gov.scot/about/", role: "calibration",
    publishedClaim: "conformant",
    source: "Scottish Government: partially compliant with WCAG 2.2 AA; exceptions are PDF documents and a menu button at 200% zoom, neither a criterion we score (https://gov.scot/accessibility/)",
    demonstrates: "long-form organisational prose, few controls" },
  { url: "https://www.mygov.scot/benefits", role: "calibration",
    publishedClaim: "conformant",
    source: "mygov.scot: partially compliant, own statement (https://www.mygov.scot/accessibility)",
    demonstrates: "benefit index — a link list with descriptive text under each" },
  { url: "https://www.nrscotland.gov.uk/statistics-and-data/", role: "calibration",
    publishedClaim: "conformant",
    source: "National Records of Scotland: partially compliant, own statement (https://www.nrscotland.gov.uk/accessibility/)",
    demonstrates: "statistics hub, nested navigation" },
  { url: "https://www.gov.uk/browse/benefits", role: "calibration",
    publishedClaim: "conformant",
    source: "GOV.UK: partially compliant with WCAG 2.2 AA (https://www.gov.uk/help/accessibility-statement)",
    demonstrates: "top-level browse page, dense link grid" },
  { url: "https://www.gov.uk/vehicle-tax", role: "calibration",
    publishedClaim: "conformant",
    source: "GOV.UK: partially compliant with WCAG 2.2 AA (https://www.gov.uk/help/accessibility-statement)",
    demonstrates: "transactional start page — the shape a service journey begins with" },
  { url: "https://www.nhs.uk/conditions/", role: "calibration",
    publishedClaim: "conformant",
    source: "NHS website: partially compliant, own statement (https://www.nhs.uk/accessibility/)",
    demonstrates: "A-to-Z index, very long link list" },
  { url: "https://service-manual.nhs.uk/design-system/components/table", role: "calibration",
    publishedClaim: "conformant",
    source: "NHS digital service manual: partially compliant, own statement (https://service-manual.nhs.uk/accessibility-statement)",
    demonstrates: "documented data table with a worked example" },
  { url: "https://ico.org.uk/for-the-public/", role: "calibration",
    publishedClaim: "conformant",
    source: "ICO: partially compliant, own statement (https://ico.org.uk/global/accessibility-statement/)",
    demonstrates: "public-facing hub, card layout" },
  { url: "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings", role: "calibration",
    publishedClaim: "conformant",
    source: "Met Office: partially compliant, own statement (https://www.metoffice.gov.uk/about-us/legal/accessibility)",
    demonstrates: "live status page — content that changes without a route change" },
  { url: "https://www.cqc.org.uk/about-us", role: "calibration",
    publishedClaim: "conformant",
    source: "Care Quality Commission: partially compliant, own statement (https://www.cqc.org.uk/about-us/our-website/accessibility-statement)",
    demonstrates: "corporate prose page, in-page navigation" },
  { url: "https://www.nationalarchives.gov.uk/about/", role: "calibration",
    publishedClaim: "conformant",
    source: "The National Archives: partially compliant, own statement (https://www.nationalarchives.gov.uk/legal/accessibility/)",
    demonstrates: "institutional landing page with mixed media" },
  { url: "https://tfl.gov.uk/modes/tube/", role: "calibration",
    publishedClaim: "conformant",
    source: "Transport for London: partially compliant, own statement (https://tfl.gov.uk/corporate/terms-and-conditions/accessibility)",
    demonstrates: "transport mode hub — status widgets and disclosure panels" },

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
  { url: "https://ico.org.uk/action-weve-taken/enforcement/", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "4.1.2"],
    source: "Information Commissioner's Office: partially compliant, own statement (https://ico.org.uk/global/accessibility/)",
    demonstrates: "enforcement action listing" },
  { url: "https://www.mygov.scot/scottish-child-payment", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "4.1.2"],
    source: "mygov.scot: partially compliant, own statement (https://mygov.scot/accessibility)",
    demonstrates: "benefit eligibility guidance" },
  { url: "https://www.nrscotland.gov.uk/publications/", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "4.1.3"],
    source: "National Records of Scotland: partially compliant, own statement (https://nrscotland.gov.uk/accessibility/)",
    demonstrates: "statistical publication listing" },
  { url: "https://www.networkrail.co.uk/careers/careers-search/", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1", "2.4.4"],
    source: "Network Rail: partially compliant, own statement (https://networkrail.co.uk/accessibility/)",
    demonstrates: "job vacancy search" },
  { url: "https://www.sportengland.org/research-and-data/data/active-lives", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.3.1", "4.1.2", "4.1.3"],
    source: "Sport England: partially compliant, own statement (https://sportengland.org/corporate-information/accessibility-statement)",
    demonstrates: "research data index" },
  { url: "https://www.transport.gov.scot/publications/", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "2.4.4"],
    source: "Transport Scotland: partially compliant, own statement (https://transport.gov.scot/accessibility/)",
    demonstrates: "transport publication listing" },
  { url: "https://caselaw.nationalarchives.gov.uk/judgments/search?query=", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.1.1", "1.3.1"],
    source: "Find Case Law: partially compliant, own statement (https://caselaw.nationalarchives.gov.uk/accessibility-statement)",
    demonstrates: "case law search results" },
  { url: "https://www.cqc.org.uk/search/all?query=hospital", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["4.1.2"],
    source: "Care Quality Commission: partially compliant, own statement (https://cqc.org.uk/about-us/our-policies/accessibility-statement)",
    demonstrates: "regulator search results" },
  { url: "https://reports.ofsted.gov.uk/search?q=school", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["4.1.2"],
    source: "Ofsted inspection reports: partially compliant, own statement (https://reports.ofsted.gov.uk/accessibility-statement)",
    demonstrates: "inspection report search" },
  { url: "https://ratings.food.gov.uk/search-a-local-authority-area", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["4.1.2"],
    source: "FSA Food Hygiene Ratings: partially compliant, own statement (https://ratings.food.gov.uk/accessibility-statement)",
    demonstrates: "hygiene rating search form" },
  { url: "https://www.ofgem.gov.uk/energy-price-cap", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["4.1.3"],
    source: "Ofgem: partially compliant, own statement (https://ofgem.gov.uk/website-accessibility)",
    demonstrates: "energy price cap explainer" },
  { url: "https://www.scotcourts.gov.uk/judgments/", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.1.1"],
    source: "Scottish Courts and Tribunals: partially compliant, own statement (https://scotcourts.gov.uk/accessibility)",
    demonstrates: "court judgment listing" },
  { url: "https://check-for-flooding.service.gov.uk/river-and-sea-levels", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.1.1"],
    source: "Environment Agency flood service: partially compliant, own statement (https://check-for-flooding.service.gov.uk/accessibility-statement)",
    demonstrates: "live river level data" },
  { url: "https://www.gla.ac.uk/undergraduate/degrees/", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["1.1.1"],
    source: "University of Glasgow: partially compliant, own statement (https://gla.ac.uk/legal/accessibility/)",
    demonstrates: "degree programme listing" },
  { url: "https://data.southwark.gov.uk/data-catalog-explorer/", role: "calibration",
    publishedClaim: "conformant", claimExcludes: ["2.4.6"],
    source: "Southwark Council data portal: partially compliant, own statement (https://data.southwark.gov.uk/accessibility-statement/)",
    demonstrates: "open data catalogue" },
  { url: "https://www.ons.gov.uk/economy/inflationandpriceindices", role: "training",
    publishedClaim: "conformant", claimExcludes: ["1.3.1", "2.4.4", "2.4.6", "3.3.1", "3.3.2", "4.1.2"],
    source: "Office for National Statistics: partially compliant, own statement (https://ons.gov.uk/help/accessibility)",
    demonstrates: "inflation statistics with data tables" },
  { url: "https://www.gov.wales/statistics-and-research", role: "calibration",
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
  // ---- OUR OWN FIXTURES, for the three criteria no published source demonstrates ------------------
  //
  // Each closes a `rules:coverage` blocker that could not otherwise be closed: the rule fires on the
  // corpus and had never fired on a real page, because no conformant page exhibits the failure and no
  // external suite publishes one. See `OWN_FIXTURE_CLAIM` for what was searched first.
  //
  // `witnessableAs` is the per-criterion label, which is what these have that a publisher statement
  // cannot give: a statement is site-level and says "partially compliant", never "this page fails 2.4.1".
  { url: `${FIXTURE_BASE}/skip-link-broken/bad.html`, role: "fixture",
    publishedClaim: "inaccessible", source: OWN_FIXTURE_CLAIM, witnessableAs: ["2.4.1"],
    demonstrates: "a skip link that is present, valid HTML, points at a plausible id, and goes nowhere" },
  { url: `${FIXTURE_BASE}/route-title-stale/bad.html`, role: "fixture",
    publishedClaim: "inaccessible", source: OWN_FIXTURE_CLAIM, witnessableAs: ["2.4.2"],
    demonstrates: "activating a navigation control changes the view and not the title" },
  // `keyboard-unreachable-action`, NOT `focus-order-tabindex`. I picked the wrong page first: the
  // tabindex fixture's five fields are all reachable by Tab and merely in the wrong ORDER, so it
  // witnesses 2.4.3 — correctly — and never 2.1.1. `KEYBOARD_ACTION_PAGE(false)` is the 2.1.1 case: a
  // `div role="button"` with no tabindex, which the screen reader announces as operable and the keyboard
  // cannot reach.
  { url: `${FIXTURE_BASE}/keyboard-unreachable-action/bad.html`, role: "fixture",
    publishedClaim: "inaccessible", source: OWN_FIXTURE_CLAIM, witnessableAs: ["2.1.1"],
    demonstrates: "a div role=button the screen reader announces and Tab never reaches" },
  // Kept as well: it witnesses 2.4.3, which no published page in this corpus demonstrates either.
  { url: `${FIXTURE_BASE}/focus-order-tabindex/bad.html`, role: "fixture",
    publishedClaim: "inaccessible", source: OWN_FIXTURE_CLAIM, witnessableAs: ["2.4.3"],
    demonstrates: "positive tabindex displacing form fields past every link in the tab order" },

]);

/** Pages for one role. */
export function pagesFor(role) {
  return REAL_PAGES.filter((page) => page.role === role);
}

/**
 * One url form, used by every comparison against this corpus.
 *
 * Trailing slash, case and fragment all removed, because `…/labels` and `…/labels/` are the same page and a
 * set membership test would happily call them different. Extracted from `assertDisjoint`, which had it as a
 * local closure -- two normalisers that drift apart is how a lookup starts quietly missing.
 */
export function normaliseUrl(url) {
  return String(url).trim().toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
}

/**
 * The corpus entry for a captured page, or `undefined`.
 *
 * Exists because a CAPTURED file does not carry the publisher's claim details. `capture-real-pages.mjs`
 * writes six keys -- role, publishedClaim, claimSource, demonstrates, capturedAt, capture -- and
 * `claimExcludes` is not among them, so anything needing the exceptions must come back here for them.
 *
 * That is deliberate rather than an omission to fix. The corpus is the source of truth for what a publisher
 * claims: a statement gets corrected, or a reading of one turns out wrong, and that must be fixable without
 * recapturing. Paying an hour of fleet time to correct a typo in a claim is the wrong trade. A capture
 * records what the screen reader heard; a conformance claim is not that.
 *
 * Callers should treat a miss as an ERROR, not as "no exceptions". A url that has drifted -- a redirect, a
 * publisher restructuring -- would otherwise silently produce an unmasked page, which is the exact failure
 * this lookup exists to prevent.
 */
export function realPageFor(url) {
  const key = normaliseUrl(url);
  return REAL_PAGES.find((page) => normaliseUrl(page.url) === key);
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
  const norm = normaliseUrl;
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
