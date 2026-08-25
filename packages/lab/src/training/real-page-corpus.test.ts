/**
 * The corpus roles must stay apart, and the check must read the REAL fixture directory.
 *
 * ADR 0010's central rule is that calibrating or training on the test set destroys the only independent
 * number this project has. A test that compared the corpus against a list of test URLs copied into the
 * test file would enforce nothing the moment a fixture is added — so this reads
 * `packages/lab/src/eval/fixtures` and derives the test set from what is actually there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertDisjoint, pagesFor, REAL_PAGES, UNWITNESSABLE_ON_REAL_PAGES } from "./real-page-corpus.mjs";
import { SCORED_CRITERIA, RULE_CRITERIA } from "@a11y-witness/judge/coverage";

/** Every `url` recorded in an eval fixture — the TEST set, derived rather than copied. */
function testSetUrls(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "eval", "fixtures");
  const urls: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!entry.endsWith(".json")) continue;
      try {
        const url = (JSON.parse(readFileSync(path, "utf8")) as { url?: string }).url;
        if (typeof url === "string") urls.push(url);
      } catch { /* a fixture that is not a capture is not a test page */ }
    }
  };
  walk(root);
  return urls;
}

test("the fixture directory really does yield test URLs, or this suite is vacuous", () => {
  // The guard on the guard. If the fixtures move and this silently returns [], every disjointness
  // assertion below would pass while checking nothing — the "reports success having examined nothing"
  // failure this project keeps finding.
  const urls = testSetUrls();
  assert.ok(urls.length >= 20, `expected the eval fixtures to yield test URLs, got ${urls.length}`);
  assert.ok(urls.some((u) => u.includes("w3.org")), "expected at least one real W3C page in the test set");
});

test("no corpus page is also an eval TEST fixture", () => {
  // The rule ADR 0010 exists to enforce. `after/home.html` and `before/home.html` are deliberately absent
  // from the corpus for exactly this reason.
  assert.deepEqual(assertDisjoint(testSetUrls()), []);
});

test("calibration and training do not overlap", () => {
  const calibration = new Set(pagesFor("calibration").map((p) => p.url));
  for (const page of pagesFor("training")) {
    assert.ok(!calibration.has(page.url), `${page.url} is in both roles`);
  }
});

test("a collision IS detected — including a trailing-slash variant of a test page", () => {
  // Proving the guard fires, and proving it normalises: `…/tutorials/` and `…/tutorials` are one page, and
  // a bare set membership test would call them different and wave the collision through.
  const withCorpusPage = assertDisjoint(["https://www.w3.org/WAI/tutorials/images/decorative"]);
  assert.equal(withCorpusPage.length, 1);
  assert.match(withCorpusPage[0], /already an eval TEST fixture/);

  const withTrailingSlash = assertDisjoint(["https://www.w3.org/WAI/tutorials/images/decorative/"]);
  assert.equal(withTrailingSlash.length, 1, "a trailing slash must not hide a collision");
});

test("every PUBLISHED page carries a published claim and a citation for it", () => {
  // The selection rule of the whole corpus: the label comes from the source, never from us. A page whose
  // `source` does not say where the claim is published is a page we labelled ourselves.
  //
  // `fixture` pages are exempt BY DEFINITION — they are the ones we labelled ourselves, deliberately —
  // and the exemption is narrow on purpose. They cannot enter calibration or training (see `CorpusRole`),
  // so no statistical claim rests on them; they exist so a rule-only criterion can be validated at all.
  // The rest of the corpus keeps the rule that makes it worth having.
  for (const page of REAL_PAGES) {
    if (page.role === "fixture") continue;
    assert.match(page.url, /^https:\/\//, `${page.url} must be a real fetchable page`);
    assert.ok(["conformant", "inaccessible"].includes(page.publishedClaim));
    assert.match(page.source, /https:\/\//, `${page.url} must cite where its claim is published`);
    assert.ok(page.demonstrates.length > 5, `${page.url} must say what it is an example of`);
  }
});

test("a FIXTURE page says it is ours, and says which criterion it demonstrates", () => {
  // The exemption above is not a hole: a fixture still has to declare what it is for. Without
  // `witnessableAs` it is a broken page with no claim attached, which is worse than not having it —
  // nothing could tell whether a capture of it witnessed the intended failure or a different one.
  for (const page of REAL_PAGES.filter((p) => p.role === "fixture")) {
    assert.equal(page.publishedClaim, "inaccessible", `${page.url} is a fixture; it demonstrates a defect`);
    assert.match(page.source, /^Authored by this project/,
      `${page.url} must say the label is ours, so it is never mistaken for a publisher's`);
    assert.ok((page.witnessableAs ?? []).length === 1,
      `${page.url} must name exactly ONE criterion — a fixture demonstrating two proves neither`);
    assert.ok(page.demonstrates.length > 5, `${page.url} must say what it is an example of`);
  }
});

test("calibration carries BOTH claims, or the threshold is fitted on one side only", () => {
  // A threshold calibrated only on conformant pages cannot tell you what it costs on failing ones. This is
  // the property that makes the calibration split usable, and it is easy to lose by adding pages casually.
  const claims = new Set(pagesFor("calibration").map((p) => p.publishedClaim));
  assert.ok(claims.has("conformant"), "calibration needs pages published as conformant");
  assert.ok(claims.has("inaccessible"), "calibration needs pages published as inaccessible");
});

test("the two roles are split by SOURCE FAMILY, not at random", () => {
  // A random split would put `images/decorative` in calibration and `images/informative` in training, and
  // those share a template, navigation and footer — so the threshold would be calibrated against structure
  // the model was trained on. Asserted as: no host-plus-first-path-segment appears in both roles.
  const family = (url: string): string => {
    const { host, pathname } = new URL(url);
    return `${host}${pathname.split("/").slice(0, 4).join("/")}`;
  };
  const calibrationFamilies = new Set(pagesFor("calibration").map((p) => family(p.url)));
  for (const page of pagesFor("training")) {
    assert.ok(!calibrationFamilies.has(family(page.url)),
      `${page.url} shares a source family with a calibration page`);
  }
});

test("the TRAINING role is all-conformant, and that is recorded rather than assumed", () => {
  // ADR 0015, why-2. Every publisher-declared inaccessible page lives in CALIBRATION — correctly, since
  // calibration data must be held out — so the training distribution contains no real broken page at all.
  // That is the whole reason a real inaccessible page sits further from the training set than its
  // conformant twin (0.6978 vs 0.8164 for the two tickets.html variants), and ADR 0010 attributed the
  // effect to broken pages "failing in several ways at once" before this was noticed. It is a property of
  // our corpus, not of broken pages.
  //
  // This asserts the CURRENT composition so the day it changes, it changes deliberately and visibly.
  // Adding a training-role inaccessible page should fail here and be a considered edit, not a silent one.
  const trainingClaims = new Set(pagesFor("training").map((p) => p.publishedClaim));
  assert.deepEqual([...trainingClaims], ["conformant"],
    "a training-role page published as inaccessible changes what the novelty score means — see ADR 0015");
});

test("the positive side is counted in DEFECTS, not pages — three BAD pages share one template", () => {
  // ADR 0015, decision 2. before/{news,template,tickets}.html are three pages of one template and their
  // only form control is the same unnamed combo box in shared site chrome. Reporting "3 inaccessible
  // pages" implies three failures; there is one. This test does not forbid that — it forbids being
  // unaware of it, by pinning the count of source families the positives actually span.
  // PUBLISHED positives only. Our own fixtures are a second family by construction and would make this
  // assertion read as "the positive side spans two sources" — which is true of the pages and false of the
  // thing this guards, which is what a real-page RECALL number may claim. Recall is measured on published
  // labels; a fixture we authored cannot support that claim and is excluded from it here.
  const inaccessible = REAL_PAGES.filter((p) => p.publishedClaim === "inaccessible" && p.role !== "fixture");
  const families = new Set(inaccessible.map((p) => new URL(p.url).pathname.replace(/[^/]+$/, "")));
  assert.equal(families.size, 1,
    "the positive side spans one source family; any claim of real-page recall must say so — ADR 0015");
  assert.ok(inaccessible.length >= families.size);
});

test("every page published as INACCESSIBLE declares what it can be witnessed as", () => {
  // ADR 0015 decision 4. A page whose published failure cannot reach the evidence a capture produces adds
  // a row and no signal — it inflates the denominator while teaching the model nothing. Declaring the
  // criterion forces the question before capture time instead of after a sweep.
  const undeclared = REAL_PAGES
    .filter((page) => page.publishedClaim === "inaccessible" && !page.witnessableAs?.length)
    .map((page) => page.url);
  assert.deepEqual(undeclared, [],
    "these pages claim a failure but do not say which criterion a capture could witness it as — see the "
    + "WITNESSABILITY note in real-page-corpus.mjs");
});

test("a CALIBRATION page's declared criterion must be one the scorer has a head for", () => {
  // Scoped to calibration, which is what the assertion always SAID and not what it checked. Calibration
  // fits the scorer's abstention threshold, so a page admitted there on a criterion no head scores is
  // admitted on evidence that measurement never reads.
  //
  // TRAINING pages are a different question. A rule-only criterion — 2.1.1, 2.4.1, 2.4.2 — has no head
  // by design and is decided by the deterministic layer, so a page demonstrating one is exactly the
  // evidence `rules:coverage` asks for and cannot be admitted under the old blanket rule.
  const scored = new Set<string>(SCORED_CRITERIA);
  const ruleOnly = new Set<string>(RULE_CRITERIA);
  const unreachable: string[] = [];
  for (const page of REAL_PAGES) {
    if (page.role !== "calibration") continue;
    for (const criterion of page.witnessableAs ?? []) {
      if (!scored.has(criterion)) unreachable.push(`${page.url} -> ${criterion}`);
    }
  }
  assert.deepEqual(unreachable, [],
    "a criterion with no head cannot be the reason a page is in the CALIBRATION set, which exists to "
    + "measure the scorer");

  // And the training side still has a bar: some layer must decide it.
  const undecidable: string[] = [];
  for (const page of REAL_PAGES) {
    if (page.role === "calibration") continue;
    for (const criterion of page.witnessableAs ?? []) {
      if (!scored.has(criterion) && !ruleOnly.has(criterion)) {
        undecidable.push(`${page.url} -> ${criterion}`);
      }
    }
  }
  assert.deepEqual(undecidable, [],
    "no layer decides this criterion, so no capture of this page can witness the claim");
});

test("a declared criterion must not be one real-page capture structurally cannot reach", () => {
  // 3.3.1 and 4.1.3 read only what the form-submission probe produces, and `capture-real-pages.mjs` sets
  // `probeForms: false` because pressing *Book* on a stranger's site is not a review. Measured: 0 of 77
  // real captures carry `formChanges` or `postSubmitFields`. A page admitted on the strength of one of
  // those would be admitted on evidence that is never collected.
  const blocked = new Set<string>(UNWITNESSABLE_ON_REAL_PAGES);
  const impossible: string[] = [];
  for (const page of REAL_PAGES) {
    for (const criterion of page.witnessableAs ?? []) {
      if (blocked.has(criterion)) impossible.push(`${page.url} -> ${criterion}`);
    }
  }
  assert.deepEqual(impossible, [],
    "this page is justified by a criterion whose probe does not run on pages we do not own, so the "
    + "evidence it was admitted for will never be gathered");
});

test("the unwitnessable list names real criteria, or the guard above forbids nothing", () => {
  // The vacuity check this file's own history argues for: a blocklist of typos blocks nothing and passes.
  const scored = new Set<string>(SCORED_CRITERIA);
  for (const criterion of UNWITNESSABLE_ON_REAL_PAGES) {
    assert.ok(scored.has(criterion),
      `${criterion} is not a scored criterion, so listing it as unwitnessable guards nothing`);
  }
});

test("anything DISCLOSED is also EXCLUDED, or the two fields disagree about one page", () => {
  // `claimDiscloses` is a strict subset of `claimExcludes`: a criterion the publisher enumerates as failing
  // is necessarily one their statement does not claim. Letting them diverge would mean a finding counted as
  // corroborated by one code path and as a false positive by the other.
  const wrong: string[] = [];
  for (const page of REAL_PAGES) {
    const excluded = new Set(page.claimExcludes ?? []);
    for (const disclosed of page.claimDiscloses ?? []) {
      if (!excluded.has(disclosed)) wrong.push(`${page.url} discloses ${disclosed} but does not exclude it`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("the disclosure field is empty until migrated page by page against the cited source", () => {
  // Deliberate, and asserted so it is a decision rather than an oversight. Classifying an entry wrongly
  // turns a publisher's SILENCE into a claimed failure, which invents ground truth — the one thing this
  // corpus exists not to do. Delete this test in the change that populates the field.
  const populated = REAL_PAGES.filter((page) => page.claimDiscloses?.length).map((page) => page.url);
  assert.deepEqual(populated, [],
    "claimDiscloses is now populated — remove this test in the same change, and record in the commit which "
    + "published statements were read to classify each entry");
});
