/**
 * Eval dataset: labeled cases with ground truth.
 *
 * Because the judge is an LLM, we treat its quality as an eval, not a one-off:
 * fixed cases, an automatic scorer, and recall/precision metrics that rerun on
 * every change. Ground truth comes from authoritative sources, not us.
 *
 * Scoring (see run.ts) is at the WCAG-criterion level:
 *   - `expect`: criteria the judge SHOULD flag (recall denominator). Limited to
 *     what is observable from a screen-reader read-through of the transcript.
 *   - `allow`:  criteria that are legitimate to flag on this page (precision).
 *     Anything flagged outside `allow` counts as a false positive.
 */
export interface EvalCase {
  id: string;
  /** Path to a capture transcript JSON: { url, screenReader, transcript }. */
  fixture: string;
  task: string;
  /** Criteria a reading-based tool should catch here (recall). */
  expect: string[];
  /** Criteria legitimate to flag here (precision); anything else is a false positive. */
  allow: string[];
  notes?: string;
  /**
   * WHERE the expectation came from — the distinction `docs/METHODOLOGY.md` already claims and the data
   * could not express.
   *
   * That document says the tutorial baseline "derives its ground truth from W3C's own documented
   * techniques, not our judgment, which reduces (does not eliminate) the self-grading concern". True, and
   * until now unverifiable: provenance lived in free-text `notes`, so nothing asserted that every case had
   * a source and nothing reported the split. A number that mixes third-party ground truth with our own
   * cannot support that sentence.
   *
   * Three values, because there are genuinely three situations and collapsing them would repeat the
   * `claimExcludes` seam:
   *
   *   published-report     a third party evaluated THIS page and published the result (W3C BAD). The
   *                        strongest form: neither the page nor the verdict is ours.
   *   published-technique  the failure mode is documented by a third party (a W3C tutorial, a book
   *                        chapter) and the page demonstrates it. The verdict is theirs; the page may be
   *                        ours.
   *   authored             we decided what this page fails. Legitimate for planted and contamination
   *                        tests, where the point IS that we know the answer — and self-grading anywhere
   *                        else.
   */
  groundTruth: "published-report" | "published-technique" | "authored";
  /**
   * Backends that CANNOT assess this case, so it is excluded from their recall rather than counted as a
   * miss. Scope, not performance — and it must be declared here rather than sniffed from a verdict.
   *
   * The one case: `planted-contact-form` is a VoiceOver transcript, and the trained scorer refuses non-NVDA
   * input by design because VoiceOver phrases the same page differently. Counting it against the local
   * backend penalises it for a limitation it correctly declares, exactly as expecting 1.4.5 Images of Text
   * penalised it for a criterion a screen reader cannot perceive. An LLM backend reads any transcript, so
   * the case stays fully in scope there.
   */
  notApplicableTo?: string[];
}

// W3C's documented Level A/AA failures on the inaccessible "Before" home page
// (https://www.w3.org/WAI/demos/bad/before/reports/home.html). AAA criteria and
// the obsolete 4.1.1 are excluded. Used as the `allow` set: flagging any of
// these is legitimate; flagging anything outside it is a false positive.
const W3C_BEFORE_DOCUMENTED_AA = [
  "1.1.1", "1.3.1", "1.3.2", "1.4.1", "1.4.3", "1.4.5",
  "2.1.1", "2.4.1", "2.4.2", "2.4.4", "2.4.6", "2.4.7",
  "3.1.1", "3.2.1", "3.2.2", "3.2.4", "3.3.2", "4.1.2",
];

// W3C's documented Level A/AA failures on the inaccessible "before" SURVEY page
// (https://www.w3.org/WAI/demos/bad/before/reports/survey.html). Form-heavy.
const W3C_SURVEY_DOCUMENTED_AA = [
  "1.1.1", "1.3.1", "1.3.2", "1.4.1", "1.4.3",
  "2.1.1", "2.4.1", "2.4.2", "2.4.3", "2.4.4", "2.4.6", "2.4.7",
  "3.1.1", "3.2.1", "3.2.2", "3.3.2", "4.1.2",
];

export const EVAL_CASES: EvalCase[] = [
  {
    id: "w3c-bad-before",
    groundTruth: "published-report",
    fixture: "packages/lab/src/eval/fixtures/nvda/nvda-w3c-bad-before.json",
    task: "Read the City Lights home page and find the latest news",
    // The failures clearly observable from this page's announced reading: unlabelled graphics (1.1.1),
    // visual titles not marked as headings (1.3.1), and vague link text (2.4.4).
    //
    // 1.4.5 was here too, on the reasoning that the phone number is shown as an image. That conflates two
    // criteria. Announcements can reveal an unlabelled graphic — which IS 1.1.1, and is expected below —
    // but they cannot reveal that the graphic contains text which should have been real text: if the alt
    // text matches the pictured words, the announcement is identical to genuine text. 1.4.5 is an
    // authoring/visual criterion, axe's side of the two-layer split, and it is not one of the eight this
    // layer scores, so the scorer has no head for it and can never predict it.
    //
    // Keeping it in `expect` therefore imposed a permanent recall penalty for a criterion the layer does
    // not claim to cover. It stays in `allow` (via W3C_BEFORE_DOCUMENTED_AA), so a backend that does flag
    // it is not penalised either. Stated plainly because this change RAISES the measured recall: it is a
    // correction to a mis-specified expectation, not a tuning of the layer to clear a gate, and it is the
    // only expectation in the whole set that sits outside the eight criteria.
    expect: ["1.1.1", "1.3.1", "2.4.4"],
    allow: W3C_BEFORE_DOCUMENTED_AA,
    notes: "Ground truth: W3C BAD before-page evaluation report.",
  },
  {
    id: "w3c-bad-after",
    groundTruth: "published-report",
    fixture: "packages/lab/src/eval/fixtures/nvda/nvda-w3c-bad-after-content.json",
    task: "Read the City Lights home page and find the latest news",
    // W3C documents the accessible page as fully conformant: expect nothing.
    // Uses the content-only fixture (demo switcher chrome stripped) so we score
    // the certified page, not W3C's demo navigation.
    expect: [],
    allow: [],
    notes: "Ground truth: W3C BAD after-page report = full WCAG 2.0 AA conformance. Content-only fixture; any finding is a false positive.",
  },
  {
    id: "w3c-bad-before-survey",
    groundTruth: "published-report",
    fixture: "packages/lab/src/eval/fixtures/nvda/nvda-w3c-bad-before-survey.json",
    task: "Fill in and submit the City Lights visitor survey",
    // Form-heavy page: radio buttons are announced with no label ("radio
    // button, not checked, [no name]") and the menu is a junk-named combo box.
    // Tests recall on unlabelled form controls. 3.3.2 (Labels or Instructions)
    // is the equivalent citation and is allowed.
    expect: ["4.1.2"],
    allow: W3C_SURVEY_DOCUMENTED_AA,
    notes: "Ground truth: W3C BAD before-survey report. Exercises form-control recall the home page didn't.",
  },
  {
    id: "w3c-wai-home",
    groundTruth: "published-report",
    fixture: "packages/lab/src/eval/fixtures/nvda/nvda-w3c-wai-home.json",
    task: "Find guidance on getting started with accessibility",
    // W3C's own WAI site: a reference-quality accessible page, no demo chrome.
    // A conformant page should yield ~no findings, so this is a clean
    // false-positive test (unlike the confounded "after" demo page).
    expect: [],
    allow: [],
    notes: "Reference-accessible real page (W3C WAI). Any finding is a false positive; measures over-flagging on good pages.",
  },
  {
    id: "contamination-fresh-page",
    groundTruth: "authored",
    fixture: "packages/lab/src/eval/fixtures/contamination-test.json",
    task: "Sign up for an Acme Widgets account",
    // Authored fresh (src/eval/pages/contamination-test.html), never published,
    // so no model can have memorized it. This is both an anti-contamination
    // test (recall here cannot be recall-from-memory) and a held-out case (not
    // tuned against). Planted observable violations: a visual title that is not
    // a real heading (1.3.1), an alt-less image (1.1.1), a vague "click here"
    // link (2.4.4), and an unlabelled input + icon-only button (4.1.2 / 3.3.2),
    // mixed with correct controls (real alt, descriptive link, labelled input).
    expect: ["1.1.1", "1.3.1", "2.4.4", "4.1.2"],
    allow: ["1.1.1", "1.3.1", "2.4.4", "4.1.2", "3.3.2", "2.4.6"],
    notes: "Contamination + held-out test: ground truth is the planted issues, not a public report.",
  },
  // --- W3C tutorial baseline: paired good/bad pages authored from the W3C WAI
  // tutorials (https://www.w3.org/WAI/tutorials/). Ground truth is W3C's own
  // documented technique. Good pages must be clean (precision); bad pages must
  // surface the documented failure (recall). Pages in src/eval/pages/tutorials/.
  {
    id: "tut-images-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/images-good.json",
    task: "View the trail photos",
    expect: [],
    allow: [],
    notes: "W3C images tutorial, correct: descriptive alt, null alt for decorative, functional-link alt. Clean.",
  },
  {
    id: "tut-images-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/images-bad.json",
    task: "View the trail photos",
    expect: ["1.1.1"],
    // 4.1.2 is allowed: the alt-less image used as a link genuinely has no
    // accessible name, so citing Name/Role/Value alongside 1.1.1 is defensible.
    allow: ["1.1.1", "4.1.2"],
    notes: "W3C images tutorial failures: missing alt on informative image and image link, filename-as-alt.",
  },
  {
    id: "tut-forms-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/forms-good.json",
    task: "Sign up for the newsletter",
    expect: [],
    allow: [],
    notes: "W3C forms tutorial, correct: label/for, fieldset/legend grouping. Clean.",
  },
  {
    id: "tut-forms-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/forms-bad.json",
    task: "Sign up for the newsletter",
    expect: ["4.1.2"],
    allow: ["4.1.2", "3.3.2", "1.3.1"],
    notes: "W3C forms tutorial failures: unlabelled input, ungrouped unlabelled radios.",
  },
  {
    id: "tut-structure-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/structure-good.json",
    task: "Find the library's opening hours",
    expect: [],
    allow: [],
    notes: "W3C page-structure tutorial, correct: landmarks + h1/h2/h3 hierarchy + skip link. Clean.",
  },
  {
    id: "tut-structure-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/structure-bad.json",
    task: "Find the library's opening hours",
    expect: ["1.3.1"],
    allow: ["1.3.1", "2.4.6", "2.4.1"],
    notes: "W3C page-structure tutorial failures: visual titles as styled text (no heading role), no landmarks.",
  },
  {
    id: "tut-tables-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/tables-good.json",
    task: "Find which platform the Hilltop train departs from",
    expect: [],
    allow: [],
    notes: "W3C tables tutorial, correct: caption + th/scope; cells announced with their headers. Clean.",
  },
  {
    id: "tut-tables-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/tables-bad.json",
    task: "Find which platform the Hilltop train departs from",
    expect: ["1.3.1"],
    allow: ["1.3.1"],
    notes: "W3C tables tutorial failure: data table with no header cells; cells not associated with headers.",
  },
  {
    id: "tut-menus-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/menus-good.json",
    task: "Go to the Support section",
    expect: [],
    allow: [],
    notes: "W3C menus tutorial, correct: nav landmark + list, named fly-out toggle with expanded/collapsed state. Clean.",
  },
  {
    id: "tut-menus-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/menus-bad.json",
    task: "Go to the Support section",
    expect: ["4.1.2"],
    allow: ["4.1.2", "1.3.1", "2.4.4"],
    notes: "W3C menus tutorial failures: fly-out toggle is an unnamed icon button, no nav landmark, visual title not a heading.",
  },
  {
    id: "tut-carousels-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/carousels-good.json",
    task: "Browse the featured products",
    expect: [],
    allow: [],
    notes: "W3C carousels tutorial, OBSERVABLE subset only: named prev/next buttons, alt on slide image. Clean. (Auto-rotation/pause 2.2.2, keyboard 2.1.1, focus, and change announcements are NOT observable from a passive read and are out of scope.)",
  },
  {
    id: "tut-carousels-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/carousels-bad.json",
    task: "Browse the featured products",
    expect: ["4.1.2", "1.1.1"],
    allow: ["4.1.2", "1.1.1", "1.3.1"],
    notes: "W3C carousels tutorial failures, OBSERVABLE subset: unnamed prev/next icon buttons (4.1.2), slide image with no alt (1.1.1). Motion/keyboard/announcement issues are out of scope for a passive read.",
  },
  {
    id: "tut-disclosure-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/disclosure-good.json",
    task: "Expand the FAQ answer about resetting a password",
    // A proper disclosure: the toggle is a named button announced "collapsed", and
    // activating it flips aria-expanded, so re-reading the control reports
    // "expanded". This is the Layer-2 interaction case — the only signal is in
    // interaction.stateChanges, not the static transcript. Conformant => no findings.
    //
    // The probe re-reads the control instead of listening for a spontaneous
    // announcement, because NVDA 2026.1.1 announces only a document re-announce on
    // activation for BOTH this page and the broken one. This fixture previously held
    // that noise ("FAQ (working disclosure), document") as its `after` value, and the
    // judge flagged a false 4.1.2 here as a result.
    expect: [],
    allow: [],
    notes: "W3C disclosure tutorial, correct: named toggle button whose aria-expanded flips, so the re-read reports 'expanded'. Lives in interaction.stateChanges. Clean.",
  },
  {
    id: "tut-disclosure-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/disclosure-bad.json",
    task: "Expand the FAQ answer about resetting a password",
    // A broken disclosure: it visually reveals content but never updates
    // aria-expanded, so re-reading the control after activation still reports
    // "collapsed" — the screen-reader user has no indication the state changed
    // (4.1.2 Name, Role, Value). Only catchable by actually operating the control,
    // which is what the Layer-2 interaction probe does. 1.3.1 allowed (revealed
    // content not programmatically associated is a defensible adjacent citation).
    expect: ["4.1.2"],
    allow: ["4.1.2", "1.3.1"],
    notes: "W3C disclosure tutorial failure: toggle never updates aria-expanded, so state change is not conveyed. Exercises the operate-the-control interaction probe.",
  },
  {
    id: "tut-forms-validation-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/forms-validation-good.json",
    task: "Sign up for the newsletter",
    // Submitting with an empty required field announces the error through a live
    // region ("There is a problem. Email address is required.") — the screen
    // reader user is told what failed without hunting. Conformant: no findings.
    // The signal lives in interaction.formChanges, not the static transcript.
    expect: [],
    allow: [],
    notes: "W3C forms/notifications, correct: error announced via role=alert live region on submit (3.3.1 + 4.1.3). Lives in interaction.formChanges. Clean.",
  },
  {
    id: "tut-forms-validation-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/tutorials/forms-validation-bad.json",
    task: "Sign up for the newsletter",
    // The same form shows the validation error only as red text: no live region,
    // no association, no focus move. On submit the screen reader announces
    // nothing about the failure, so the user is never told what went wrong
    // (3.3.1 Error Identification; 4.1.3 Status Messages). Only catchable by
    // actually submitting the form, which is what the opt-in form probe does.
    expect: ["3.3.1"],
    allow: ["3.3.1", "4.1.3"],
    notes: "W3C forms/notifications failure: validation error shown visually only, never announced on submit. Exercises the operate-the-form (submit) probe.",
  },
  {
    id: "planted-contact-form",
    groundTruth: "authored",
    notApplicableTo: ["local"],
    fixture: "packages/lab/src/eval/fixtures/planted-contact-form.json",
    task: "Send a message to the team using the contact form",
    // Planted: bare "image" (1.1.1), unlabelled field (3.3.2 or 4.1.2),
    // unnamed "button" (4.1.2). The h1->h4 jump is NOT a clear failure, and
    // "For our privacy policy click here" IS clear in context, so flagging
    // 2.4.4 would be a false positive (tests the in-context link rule).
    expect: ["1.1.1", "4.1.2"],
    allow: ["1.1.1", "4.1.2", "3.3.2"],
    notes: "Synthetic; tests recall on labels/names and that in-context 'click here' is NOT flagged.",
  },
  // --- Book-grounded cases: paired good/bad pages authored from published,
  // expert-reviewed references (Web Accessibility Cookbook, Matuzović 2024;
  // Practical Web Accessibility, Firth 2024). Pages in src/eval/pages/books/;
  // see that README for the source recipe/chapter per topic. Each fixture is
  // captured by the real NVDA worker into src/eval/fixtures/books/*.json. Until
  // a fixture exists, the runner lists the case as "pending capture" and skips
  // it (it does not affect metrics), so these can be authored before capture.
  {
    id: "book-links-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/links-good.json",
    task: "Read the latest city news",
    expect: [],
    allow: [],
    notes: "Cookbook ch3 / Firth ch17, correct: descriptive link text. Clean.",
  },
  {
    id: "book-links-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/links-bad.json",
    task: "Read the latest city news",
    // Link text announced detached from its sentence: "Read more...", bullet-list
    // "Click here", and a bare "Go!" do not convey purpose (mirrors W3C BAD's
    // documented 2.4.4 failures). 2.4.4 is a known semantic/fine-tune target.
    expect: ["2.4.4"],
    allow: ["2.4.4"],
    notes: "Cookbook ch3 / Firth ch17 failure: ambiguous 'Click here'/'Read more'/'Go!' link text.",
  },
  {
    id: "book-headings-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/headings-good.json",
    task: "Find how to reset your password",
    expect: [],
    allow: [],
    notes: "Firth ch15 / Cookbook ch2, correct: descriptive headings. Clean.",
  },
  {
    id: "book-headings-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/headings-bad.json",
    task: "Find how to reset your password",
    // Headings have proper roles/levels (so not 1.3.1) but are non-descriptive:
    // "Welcome", "Stuff", a vague title, and a run-on title. Semantic 2.4.6.
    expect: ["2.4.6"],
    allow: ["2.4.6"],
    notes: "Firth ch15 / Cookbook ch2 failure: vague / run-on / non-descriptive headings.",
  },
  {
    id: "book-alt-quality-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/alt-quality-good.json",
    task: "Review the quarterly results",
    expect: [],
    allow: [],
    notes: "Firth ch5, correct: descriptive alt that conveys the image's information. Clean.",
  },
  {
    id: "book-alt-quality-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/alt-quality-bad.json",
    task: "Review the quarterly results",
    // Alt is PRESENT (so the absence rule won't fire) but unhelpful: a declaration
    // ("A graph about stocks") and a generic placeholder ("image"). Semantic 1.1.1
    // — exercises the gate, distinct from the absence case in tut-images-bad.
    expect: ["1.1.1"],
    allow: ["1.1.1"],
    notes: "Firth ch5 failure: alt present but a declaration/generic placeholder, not a description.",
  },
  {
    id: "book-custom-control-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/custom-control-good.json",
    task: "Save your settings",
    expect: [],
    allow: [],
    notes: "Cookbook ch4 / Firth ch4-6, correct: native button + icon button with aria-label. Clean.",
  },
  {
    id: "book-custom-control-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/custom-control-bad.json",
    task: "Save your settings",
    // An icon-only button with no accessible name (rule-catchable 4.1.2) plus a
    // <div> styled as a button with no role (announced as plain text, not operable).
    expect: ["4.1.2"],
    allow: ["4.1.2", "1.3.1"],
    notes: "Cookbook ch4 / Firth ch4-6 failure: unnamed icon button + roleless div-as-button.",
  },
  {
    id: "book-filter-status-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/filter-status-good.json",
    task: "Filter the products to show only bags",
    expect: [],
    allow: [],
    notes: "Cookbook ch10, correct: result count in a role=status live region, announced on filter. Captured via the task-button probe (clicking 'Bags' announced 'Showing 2 of 4 products'). Lives in interaction.formChanges. Clean.",
  },
  {
    id: "book-filter-status-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/filter-status-bad.json",
    task: "Filter the products to show only bags",
    // Filtering updates the visible result count, but it is not in any live region
    // and focus does not move, so the change is never announced (4.1.3). Only
    // catchable by operating the filter — exercises the interaction probe.
    expect: ["4.1.3"],
    allow: ["4.1.3"],
    notes: "Cookbook ch10 failure: filter result change not announced (no live region). Captured via the task-button probe (clicking 'Bags' announced nothing — empty delta). 4.1.3. Lives in interaction.formChanges.",
  },
  {
    id: "book-layout-table-good",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/layout-table-good.json",
    task: "Read about the company",
    expect: [],
    allow: [],
    notes: "Firth ch25, correct: layout table marked role=presentation, no table semantics announced. Clean. PENDING richer capture (2026-06-29): NVDA browse-mode say-all announces NO table semantics for the layout table either way, so good/bad capture identically; needs table-navigation capture to surface the difference.",
  },
  {
    id: "book-layout-table-bad",
    groundTruth: "published-technique",
    fixture: "packages/lab/src/eval/fixtures/books/layout-table-bad.json",
    task: "Read about the company",
    // A <table> used purely for two-column layout, with no role=presentation, so a
    // screen reader announces table/row/column relationships that do not exist.
    expect: ["1.3.1"],
    allow: ["1.3.1"],
    notes: "Firth ch25 failure: layout table without role=presentation; spurious table semantics announced. PENDING richer capture (2026-06-29): NVDA browse-mode say-all did NOT announce table semantics here, so the failure is not surfaced by a passive read and good/bad capture identically; needs table-navigation capture.",
  },
];
