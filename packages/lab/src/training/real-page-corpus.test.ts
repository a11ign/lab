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
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertDisjoint, isFixture, pagesFor, realPageFor, REAL_PAGES, UNWITNESSABLE_ON_REAL_PAGES, unreachableDeclarations,
} from "./real-page-corpus.mjs";
import { SCORED_CRITERIA, RULE_CRITERIA } from "@a11ign/judge/coverage";
import { CASES } from "./case-matrix.mjs";

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
  //
  // `field` pages (#955) are exempt for the OPPOSITE reason: nobody labelled them, because they make no
  // claim at all, and `field-role.test.ts` asserts that absence. Each reader that rests a number on a claim
  // already asks for one, so a page without one reaches none of them.
  for (const page of REAL_PAGES) {
    if (page.role === "fixture" || page.role === "field") continue;
    assert.match(page.url, /^https:\/\//, `${page.url} must be a real fetchable page`);
    assert.ok(["conformant", "inaccessible"].includes(String(page.publishedClaim)),
      `${page.url} carries no published claim, and only a field page may lack one`);
    assert.match(page.source, /https:\/\//, `${page.url} must cite where its claim is published`);
    assert.ok(page.demonstrates.length > 5, `${page.url} must say what it is an example of`);
  }
});

test("a FIXTURE page says it is ours, and says which criterion it demonstrates", () => {
  // The exemption above is not a hole: a fixture still has to declare what it is for. Without
  // `witnessableAs` it is a broken page with no claim attached, which is worse than not having it —
  // nothing could tell whether a capture of it witnessed the intended failure or a different one.
  const fixtures = REAL_PAGES.filter((p) => p.role === "fixture");
  const failing = fixtures.filter((p) => p.publishedClaim === "inaccessible");
  for (const page of fixtures) {
    assert.match(page.source, /^Authored by this project/,
      `${page.url} must say the label is ours, so it is never mistaken for a publisher's`);
    assert.ok(page.demonstrates.length > 5, `${page.url} must say what it is an example of`);
  }
  for (const page of failing) {
    assert.ok((page.witnessableAs ?? []).length === 1,
      `${page.url} must name exactly ONE criterion — a fixture demonstrating two proves neither`);
  }

  // A CONFORMANT FIXTURE IS ALLOWED, AND ONLY AS THE SIBLING OF A FAILING ONE — widened 2026-09-06.
  //
  // This loop required EVERY fixture to be `inaccessible`, which was true of all four and is not the
  // property that matters. What matters is that a fixture is never a page with no claim attached: a
  // failing one says which criterion it witnesses, and a conformant one earns its place by being the
  // SILENT half of a pair, so a rule is shown not firing on the same evidence channel rather than only
  // shown firing. 1.4.13 is the first criterion added with both halves, because its dismissable bullet is
  // about a panel that CANNOT be dismissed and a bad-only fixture never exercises the other outcome.
  //
  // THE PAIRING IS WHAT STOPS THIS BEING A HOLE. Without it, "conformant fixture" is a way to add any page
  // at all to the corpus with no claim to check it against. The sibling is DERIVED from the url — same
  // case directory, `bad.html` against `good.html` — never declared, so a conformant fixture with nothing
  // to be the sibling OF fails here rather than passing quietly.
  const caseOf = (url: string) => url.replace(/\/(good|bad)\.html$/, "");
  const failingCases = new Set(failing.map((p) => caseOf(p.url)));
  for (const page of fixtures.filter((p) => p.publishedClaim === "conformant")) {
    assert.ok(failingCases.has(caseOf(page.url)),
      `${page.url} is a CONFORMANT fixture with no failing sibling in the same case. A conformant fixture `
      + "earns its place as the silent half of a pair; on its own it is a page in the corpus with no "
      + "claim anything can check it against.");
  }
  assert.ok(failing.length > 0,
    "no fixture is `inaccessible`, so this test examines nothing — fixtures exist to let a rule-only "
    + "criterion be validated at all, which needs a page that FAILS");
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
  // #1178/#1189: ONE PAGE ADMITTED BY NAME, and the citation is what makes the edit answerable later.
  //
  // This guard asked for "a considered edit, not a silent one". The consideration is `orchestrator`'s
  // measurement on #1178: both arms captured from the same disk corpus, declaration the only difference.
  // The 4.1.3 tier MOVED (0 of 39 -> 1 of 40) and the distance pair did NOT (0.8231 / 0.7208 in both), on
  // a demonstrably different instrument -- different dataset sha, 2869 -> 2870 records, different report
  // hash. The mechanism is `distinctStructures`: 837 in BOTH arms, and the OOD reference samples 512 rows
  // by evenly spaced indices over them, so the same 837 draws the same rows and EVERY novelty figure is
  // unchanged rather than just this pair's.
  //
  // THE FALSIFIER, which is the half that keeps this from reading as "broken pages are free": a page that
  // RAISES `distinctStructures` would move the reference. That field is read first for any future invited
  // origin, and admitting a second page here without it is the edit this guard exists to refuse.
  const ADMITTED_INACCESSIBLE_TRAINING = ["https://the-internet.herokuapp.com/login"];
  const unexpected = pagesFor("training")
    .filter((p) => p.publishedClaim !== "conformant" && !ADMITTED_INACCESSIBLE_TRAINING.includes(p.url))
    .map((p) => p.url);
  assert.deepEqual(unexpected, [],
    "a training-role page published as inaccessible changes what the novelty score means — see ADR 0015. "
    + "One page is admitted BY NAME on #1178's measurement; a second needs its own, starting with whether "
    + "it raises `distinctStructures`");
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
  // #1178/#1189: THE RECALL CLAIM IS ABOUT CALIBRATION, so the one admitted TRAINING page is excluded
  // here rather than counted as a second family. The training role is never used to measure anything --
  // this file's own section header says so -- and a recall number is fitted on calibration. Counting it
  // would make this assertion read "the positive side spans two sources", which is true of the pages and
  // false of the thing this guards.
  const inaccessible = REAL_PAGES.filter((p) => p.publishedClaim === "inaccessible"
    && p.role !== "fixture" && p.role !== "training");
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
  // #1175, on `ceo`'s ruling: UNLESS THE PAGE CARRIES CONSENT. The list's justification is that
  // `capture-real-pages.mjs` sets `probeForms: false` globally -- and **ADR 0024 made per-page consent the
  // exception to exactly that**, with #1114 establishing that consent plus the probe is what makes a
  // capture actually drive the form. A page declaring `probeForms: true` and a `formState` IS reaching
  // 3.3.1 and 4.1.3, so blocking it cites a mechanism that no longer applies to it.
  //
  // This is a mechanism truth, not a widening: the consent decision still belongs to `INVITED` in
  // `real-page-form-consent.test.ts`, which is unchanged, and a page without consent is blocked exactly
  // as before. Without this, a page published as inaccessible whose only witnessable criterion is 4.1.3
  // could not be admitted AT ALL -- guard `:193` requires a `witnessableAs` and this one forbade the only
  // value it could have. That deadlock is what #1175 hit.
  assert.deepEqual(unreachableDeclarations(REAL_PAGES), [],
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

test("a FIXTURE's declared criterion matches the case it is built from", () => {
  // ONE FACT, TWO PLACES. A fixture URL points at a generated case page, and that case ALREADY declares
  // which criterion it demonstrates — `case-matrix.mjs` has `criterion: "2.4.3"` on `focus-order-tabindex`
  // — while the fixture entry declares `witnessableAs` separately. Nothing compared them.
  //
  // Measured 2026-08-25, and it cost three capture runs: the 2.1.1 fixture pointed at
  // `focus-order-tabindex`, whose five fields are ALL reachable by Tab and merely in the wrong order. It
  // witnessed 2.4.3 correctly and could never witness 2.1.1. The right page — `keyboard-unreachable-action`
  // — was in the same file, thirty lines away, already labelled 2.1.1.
  //
  // The symptom was "the rule did not fire", which reads as a capture problem or a rule problem, and I
  // treated it as both before checking the premise. This check runs offline in milliseconds and answers
  // it before a worker is ever asked.
  const declared = new Map(CASES.map((c: { id: string; criterion: string }) => [c.id, c.criterion]));
  const wrong: string[] = [];
  // FAILING fixtures only. A CONFORMANT sibling witnesses nothing by design — it is the silent half of a
  // pair, and `witnessableAs` on it would be a claim that the page demonstrates a failure it exists NOT to
  // demonstrate. It is still required to point at a real generated case, which the assertion below keeps.
  for (const page of REAL_PAGES.filter((p) => p.role === "fixture")) {
    const caseId = new URL(page.url).pathname.split("/").filter(Boolean)[0];
    const expected = declared.get(caseId);
    assert.ok(expected, `${page.url} names no case in CASES — a fixture must point at a generated page`);
    if (page.publishedClaim === "conformant") continue;
    const claimed = (page.witnessableAs ?? [])[0];
    if (claimed !== expected) wrong.push(`${caseId}: fixture says ${claimed}, the case says ${expected}`);
  }
  assert.deepEqual(wrong, [],
    "a fixture claiming a criterion its page does not demonstrate cannot witness it, and the failure "
    + "looks exactly like a broken rule");
});

test("the real-page gate honours claimExcludes, and only on exact criteria", () => {
  // The gate reported "NEW finding(s) on pages whose publisher declares them conformant" for criteria
  // those publishers had EXPLICITLY declined to claim. Measured 2026-08-26: 9 of 12 flagged findings were
  // inside a declared exception — tfl, bl.uk, financial-ombudsman, lbhf, leeds, metoffice/forecast,
  // nationalarchives, nls and sepa all name 1.1.1 in their own statements.
  //
  // `publishedClaim: "conformant"` does not mean every criterion is claimed. Almost every UK
  // public-sector statement says "partially compliant" with an enumerated list, and `claimExcludes` is
  // the field that records the intersection with our eight — the realism tier already honours it. A gate
  // that cannot see the mask its own corpus declares is measuring the publisher's honesty, not this
  // tool's accuracy.
  const source = readFileSync(
    new URL("../../scripts/check-real-page-findings.ts", import.meta.url), "utf8");
  assert.match(source, /page\.claimExcludes/,
    "the gate must read the exceptions the corpus declares");
  assert.match(source, /entry\.includes\(":"\)/,
    "and must NOT widen a subtype exclusion to its whole criterion, which would hide real findings");
});

test("every claimExcludes entry names a criterion we actually score", () => {
  // An entry naming something we do not score masks nothing and quietly overstates how excused a page is.
  //
  // FIXED 2026-09-06 (#33): this was a SECOND, independently-hardcoded copy of SCORED_CRITERIA -- already
  // imported above and already used at this exact name (`scored`) in two other tests in this file -- and
  // it had drifted: it still read the original eight criteria while SCORED_CRITERIA had grown to
  // seventeen. `claimExcludes` masks TRAINING data for a HEAD, so SCORED_CRITERIA (criteria a head is
  // fitted for) is the right set, never the full rule+scorer union `assessedCriteria()` returns --
  // 1.4.2 and 2.4.7 are rule-only with no head at all, and masking training input for a head that does not
  // exist would guard nothing.
  const scored = new Set<string>(SCORED_CRITERIA);
  const stray: string[] = [];
  for (const page of REAL_PAGES) {
    for (const entry of page.claimExcludes ?? []) {
      if (!scored.has(String(entry).split(":")[0])) stray.push(`${page.url}: ${entry}`);
    }
  }
  assert.deepEqual(stray, [], "these exclude a criterion this tool does not assess");
});

/**
 * #881 / #146 -- THE ONE REWRITE `realPageFor` UNDOES, tested in BOTH directions.
 *
 * `capture-real-pages.mjs`'s `workerReachable` swaps a fixture url's loopback hostname for the host's LAN
 * address and changes nothing else, and the capture records the url the worker loaded. `atHost` makes the
 * same swap. The stand-in is from the RFC 5737 documentation range, never the lab's real address: a
 * positive control shaped like the thing, which cannot be the thing, and which the tree's leak guard allows.
 *
 * One direction alone proves little. A matcher loosened to map any host to any fixture passes the first
 * test and fails the second, and a matcher that reconciles nothing passes the second and fails the first.
 */
const LAB_STAND_IN = "192.0.2.10";

function atHost(url: string, hostname: string): string {
  const moved = new URL(url);
  moved.hostname = hostname;
  return moved.toString().replace(/\/$/, "");
}

const FIXTURES = REAL_PAGES.filter((page) => page.role === "fixture");
const PUBLISHED = REAL_PAGES.filter((page) => page.role !== "fixture");

test("#881: every fixture, captured at the lab's address, resolves to its OWN declaration", () => {
  assert.ok(FIXTURES.length > 0, "no fixture in REAL_PAGES, so this test asserts over nothing");
  for (const page of FIXTURES) {
    // No precondition on DATASET_BASE_URL any more: since #940 reconciliation asks whether the declaration is
    // a FIXTURE (`isFixture`, by role), not whether its host is loopback, so this holds under any base.
    assert.equal(realPageFor(atHost(page.url, LAB_STAND_IN))?.url, page.url);
  }
});

test("#881: a published page still matches only itself -- at any other host it matches nothing", () => {
  assert.ok(PUBLISHED.length > 0, "no published page in REAL_PAGES, so this test asserts over nothing");
  for (const page of PUBLISHED) {
    assert.equal(realPageFor(page.url)?.url, page.url, `${page.url} no longer matches its own url`);
    assert.equal(realPageFor(atHost(page.url, LAB_STAND_IN)), undefined,
      `${page.url} gained a second address -- only a page-server declaration may be reached at another host`);
  }
});

test("#881: the rewrite changes the HOSTNAME ONLY, to an address -- so nothing else is forgiven", () => {
  const [fixture] = FIXTURES;
  const relocated = new URL(atHost(fixture.url, LAB_STAND_IN));
  const variant = (change: (url: URL) => void): string => {
    const url = new URL(relocated.href);
    change(url);
    return url.href;
  };
  assert.equal(realPageFor(atHost(fixture.url, "pages.example.test")), undefined,
    "a NAMED host serving the same path on the same port is a different page");
  assert.equal(realPageFor(variant((url) => { url.port = String(Number(url.port || "80") + 1); })), undefined,
    "the rewrite never changes the port");
  assert.equal(realPageFor(variant((url) => { url.protocol = "https:"; })), undefined,
    "the rewrite never changes the scheme");
  assert.equal(realPageFor(variant((url) => { url.pathname += "-other"; })), undefined,
    "the rewrite never changes the path");
  assert.equal(realPageFor("not a url"), undefined);
  assert.equal(realPageFor(undefined), undefined);
});


/**
 * #940 -- UNDER A NON-LOOPBACK `DATASET_BASE_URL`, THE MATCHER AND THE GATE STILL KNOW A FIXTURE.
 *
 * `FIXTURE_BASE` is read from the variable at import, so only a process started with it set sees the
 * declarations the lab would. Both readers used to decide "fixture" from the declaration's loopback host:
 * the matcher then stopped reconciling a relocated fixture, and the gate printed it as UNDECLARED -- the
 * heading whose fix is deletion -- instead of RELOCATED.
 */
test("#940: with DATASET_BASE_URL non-loopback, a relocated fixture still reconciles and still reads as RELOCATED", () => {
  const [fixture] = REAL_PAGES.filter((page) => page.role === "fixture");
  const path = new URL(fixture.url).pathname;
  const probe = `
    const { realPageFor, pageServerFixtureAtPath } = await import(${JSON.stringify(new URL("./real-page-corpus.mjs", import.meta.url).href)});
    console.log(JSON.stringify({
      reconciled: realPageFor("http://198.51.100.7:5050${path}")?.url ?? null,
      relocated: pageServerFixtureAtPath("http://pages.example.test:5050${path}")?.url ?? null,
    }));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", probe],
    { env: { ...process.env, DATASET_BASE_URL: "http://192.0.2.10:5050" }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const expected = `http://192.0.2.10:5050${path}`;
  assert.deepEqual(JSON.parse(run.stdout), { reconciled: expected, relocated: expected });
});

test("#940: isFixture is the page's ROLE, with a loopback host as a second signal -- never the host alone", () => {
  assert.equal(isFixture({ url: "http://192.0.2.10:5050/route-title-stale/good.html", role: "fixture" }), true);
  assert.equal(isFixture({ url: "http://localhost:5050/route-title-stale/good.html" }), true);
  assert.equal(isFixture({ url: "https://www.gov.scot/about/", role: "training" }), false);
  // Every declared fixture is one by role, whatever base it was declared at.
  assert.ok(REAL_PAGES.filter((page) => page.role === "fixture").every(isFixture));
});

// --- #1175: the consent exception, DRIVEN rather than merely present ----------------------------------
//
// `ceo`'s ruling: the unwitnessable list means "unwitnessable UNLESS the page carries consent", because
// its justification is the global `probeForms: false` and ADR 0024 made a per-page `formState` the
// exception to exactly that. The page that needed it is held on a decision row, so the corpus cannot
// exercise this branch — removing the exception leaves the suite green. These four cases are why the rule
// lives in a function.

test("#1175: a page carrying BOTH halves of consent may declare a form-probe criterion", () => {
  assert.deepEqual(unreachableDeclarations([
    { url: "https://x/login", witnessableAs: ["4.1.3"], probeForms: true, formState: { state: "error" } },
  ]), [], "consent plus the probe is what makes a capture drive the form, so 4.1.3 is reachable there");
});

test("#1175: EITHER HALF ALONE leaves the criterion exactly as unreachable — #1114's finding", () => {
  // The case that makes this an exception rather than a hole. A page claiming `probeForms` with no
  // `formState` has no values to submit; one with a `formState` and no probe never submits. #1114 was
  // the second of those, shipped and inert, and it is why the guard asks for both rather than either.
  assert.deepEqual(unreachableDeclarations([
    { url: "https://probe-only/login", witnessableAs: ["4.1.3"], probeForms: true },
  ]), ["https://probe-only/login -> 4.1.3"]);
  assert.deepEqual(unreachableDeclarations([
    { url: "https://consent-only/login", witnessableAs: ["4.1.3"], formState: { state: "error" } },
  ]), ["https://consent-only/login -> 4.1.3"]);
});

test("#1175: a page with no consent at all is blocked exactly as before — the rule did not widen", () => {
  assert.deepEqual(unreachableDeclarations([
    { url: "https://plain/page", witnessableAs: ["4.1.3", "3.3.1"] },
  ]), ["https://plain/page -> 4.1.3", "https://plain/page -> 3.3.1"],
  "both listed criteria, so the exception is scoped to consent and not to the criterion");
});

test("#1175: a criterion NOT on the list is unaffected by consent either way", () => {
  for (const page of [
    { url: "https://a/p", witnessableAs: ["4.1.2"] },
    { url: "https://b/p", witnessableAs: ["4.1.2"], probeForms: true, formState: { state: "error" } },
  ]) {
    assert.deepEqual(unreachableDeclarations([page]), [],
      "the list is what blocks, and consent only lifts what the list blocks");
  }
});

/**
 * #1508: BOTH TfL entries follow TfL's accessibility STATEMENT, and the read is kept here verbatim as the fixture,
 * so a future reader sees what was read rather than a summary of it (`ceo`'s ruling, 2026-09-14 ~01:58Z).
 *
 * The tube calibration entry cited `https://tfl.gov.uk/corporate/terms-and-conditions/accessibility`, which
 * returns 404. The statement is `TFL_STATEMENT_READ.url` ("Website accessibility statement - Transport for
 * London", HTTP 200). It is NOT `https://tfl.gov.uk/corporate/website-accessibility/`, a "Digital accessibility"
 * landing page that links to it and says the sites "comply with W3C's WCAG2.2 Guidelines Level AA" -- the row was
 * first filed on that page. `claimExcludes` on both entries is every criterion the statement says "This fails
 * WCAG criterion …" of, intersected with `SCORED_CRITERIA` as `@a11ign/judge/coverage` EXPORTS it -- derived
 * below from the text, never retyped. They are the publisher's own disclosures, not a mask chosen to pass a gate.
 */
const TFL_DEAD_SOURCE = "https://tfl.gov.uk/corporate/terms-and-conditions/accessibility";
const TFL_STATEMENT_READ = {
  url: "https://tfl.gov.uk/corporate/website-accessibility/accessibility-statement",
  read: "2026-09-14T01:52:15Z (GET, HTTP 200; served page sha256 d754612bceea7009...)",
  compliance: "This website is partially compliant with the Web Content Accessibility Guidelines version 2.1 AA "
    + "standard , due to the non-compliances and exemptions listed below.",
  dated: "This statement was prepared on 23 September 2020. It was last reviewed on 26 March 2025.",
  /** Every element holding "This fails WCAG criterion", in page order, with its heading, whitespace collapsed. */
  failing: [
    ["Non-compliance with the accessibility regulations", "Some decorative images are not labelled correctly. This fails WCAG criterion 1.1.1 (Non-text content). We plan to label all images correctly by October 2026."],
    ["Non-compliance with the accessibility regulations", "The autogenerated captions in video contents may have some errors and missing punctuation. This fails WCAG criterion 1.2.2 (Captions pre-recorded). We plan to continue to monitor this and resolve those issues as they arise."],
    ["Non-compliance with the accessibility regulations", "Some video content is not conveyed by audio or transcript. This fails WCAG criterion 1.2.3 (Audio Description or Media Alternative (Pre-recorded)). We plan to continue to monitor this and resolve those issues as they arise."],
    ["Non-compliance with the accessibility regulations", "Some navigation components are not identified by the correct attribute. This means that people using screen readers or keyboard navigation may not be able to infer information, structure, and relationships between the interface elements. This fails WCAG criterion 1.3.1 (Info and Relationships). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "Some hover states and focus states rely solely on a change of colour. This may make states difficult to identify for people with visual impairments. This fails WCAG criterion 1.4.1 (Use of colour). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "Some navigation elements are not fully operable by keyboard. This means that on some pages users of keyboards may find it difficult to operate. This fails WCAG criterion 2.1.1 (Keyboard navigation). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "In some fields, the accessible label name doesn't match the visible one. This fails WCAG criterion 2.5.3 (Label in Name). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "On the travel information email updates page the default language can't be programmatically determined. This fails WCAG criterion 3.1.1 (Language of page). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "There are two instances where no error message is provided after a user search input is left blank and Go button is clicked. This fails WCAG criterion 3.3.1 (Error identification). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "There are various instances where labels are not persistent when user enters data in the field. This fails WCAG criterion 3.3.2 (Labels or instructions). We plan to meet this criterion by October 2026. There are some instances, where content implemented using mark-up languages, elements are not nested according to their specifications, elements contain duplicate attributes. This means that assistive technology may not be able to accurately interpret and parse content. This fails WCAG criterion 4.1.1(Parsing). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "There are some instances where a user interface component's name and role can't be programmatically determined. This may mean that the function of a component, like a button or a link, is not clear. This fails WCAG criterion 4.1.2 (Name, role, value). We plan to meet this criterion by October 2026. Some video may not have audio description. This fails WCAG criterion 1.2.5 (Audio Description (Pre-recorded). We plan to keep monitoring this."],
    ["Non-compliance with the accessibility regulations", "Some text does not have a contrast ratio of 4:5:1. This may make the text difficult to read for users with a visual impairment. This fails WCAG criterion 1.4.3 (minimum contrast). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "When the 'Tube & Rail' Status page is viewed at 400% with the browser width set to 1280px, the page has both horizontal and vertical scrolling. This means that people who need bigger text would need to scroll to read long lines. This fails WCAG criterion 1.4.10 (Reflow). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "Some combinations of adjacent colour in components do not have a contrast ratio of at least 3:1. This means that some active user interface components (i.e., controls) and meaningful graphics are not distinguishable by people with moderately low vision. This fails WCAG criterion 1.4.11 (Non-text Contrast). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "One component in the Tube landing page does not display a visible focus indicator. This fails WCAG criterion 2.4.7 (Focus Visible). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "When the calendar on the 'Tube & Rail' Status page is expanded, it is persistent even after losing focus. This means that people who can't use a mouse can't see what has keyboard focus. This fails WCAG criterion 2.4.11 (Focus Not Obscured). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "Some status messages can't be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus. This means that users are unaware of changes in content that are not given focus to. This fails WCAG criterion 4.1.3 (Status messages). We plan to meet this criterion by October 2026."],
    ["Non-compliance with the accessibility regulations", "The step counter text above the progress bar on the 'Report a safety incident or a crime' page does not show the total number of steps. This means users cannot determine exactly how many questions remain. This fails WCAG criterion 1.3.1 (Info and Relationships). We plan to meet this criterion by October 2026."],
    ["Congestion charge transactions (Disproportionate burden)", "There is no way to extend the session time out on the congestion charge payment page. The session is set at 10 minutes and after this period of time you will need to start the session again if you have not completed your payment. This fails WCAG criterion 2.2.1 (timing adjustable). Due to the security risk associated with longer session times we do not plan to change this feature to meet the criterion. Setting a limit to the session time reduces the time an attacker has to steal and use an existing user session."],
  ],
} as const;

/** How many distinct criteria the fixture's 21 "This fails" sentences name: 1.3.1 appears twice. */
const TFL_STATEMENT_DISTINCT_FAILS = 20;

/** Every criterion the statement's own text says it fails, read from the fixture's sentences. */
function tflStatementFails(): string[] {
  return [...new Set(TFL_STATEMENT_READ.failing.flatMap(([, text]) =>
    [...text.matchAll(/This fails WCAG criterion\s*([1-4]\.[0-9]\.[0-9]{1,2})/g)].map((match) => match[1])))];
}
const tflPages = () => REAL_PAGES.filter((page) => page.url.startsWith("https://tfl.gov.uk/"));
const byCriterion = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

test("#1508: the fixture is the statement -- it says partially compliant, and fails 1.1.1 in its own words", () => {
  assert.match(TFL_STATEMENT_READ.compliance, /partially compliant with the Web Content Accessibility Guidelines version 2\.1 AA/);
  const fails = tflStatementFails();
  assert.equal(fails.length, TFL_STATEMENT_DISTINCT_FAILS, "every fail sentence parsed, 1.3.1 counted once");
  assert.ok(fails.includes("1.1.1"), "the disclosure stage 11's tfl referral rests on");
});

test("#1508: every TfL entry cites the live statement, dated, and no entry cites the dead URL", () => {
  assert.equal(tflPages().length, 2, "the tube calibration page and the plan-a-journey training page");
  for (const page of tflPages()) {
    assert.ok(page.source.includes(`(${TFL_STATEMENT_READ.url})`), `${page.url} must cite the statement: ${page.source}`);
    assert.match(page.source, /partially compliant/, `${page.url}: the statement's own words`);
    assert.match(page.source, /prepared 2020-09-23, last reviewed 2025-03-26, read 2026-09-14/, `${page.url}: dated`);
  }
  const dead = REAL_PAGES.filter((page) => page.source.includes(TFL_DEAD_SOURCE)).map((page) => page.url);
  assert.deepEqual(dead, [], "a source that returns 404 cites nothing");
});

test("#1508: BOTH TfL entries exclude exactly the statement's failures that SCORED_CRITERIA covers", () => {
  const scored = new Set<string>(SCORED_CRITERIA);
  const expected = tflStatementFails().filter((criterion) => scored.has(criterion)).sort(byCriterion);
  assert.ok(expected.length > 0 && expected.includes("1.1.1"), "the positive control: scored disclosures exist at all");
  for (const page of tflPages()) {
    assert.deepEqual([...(page.claimExcludes ?? [])].map(String).sort(byCriterion), expected,
      `${page.url} (${page.role}): the statement's own disclosures a head scores -- no more, no fewer`);
  }
});

/**
 * #1515: BOTH ICO entries follow ICO's accessibility STATEMENT, read verbatim here as the fixture -- the #1508 shape.
 *
 * The for-the-public calibration entry cited `https://ico.org.uk/global/accessibility-statement/`, which returns 404.
 * The statement is `ICO_STATEMENT_READ.url` ("ICO accessibility statement", HTTP 200). Its "This fails WCAG …"
 * sentences are worded three ways ("success criterion", "WCAG 2.1 success criterion", "WCAG 2.2 success
 * criterion"), one names two criteria ("4.1.2 … and 2.4.3"), and one reads "2.1 1.4.11" where 2.1 is the WCAG
 * version -- so the parse takes every x.y.z number inside each fail SENTENCE, not the first after a fixed phrase.
 *
 * `claimExcludes` on both entries is those failures intersected with `SCORED_CRITERIA` as `@a11ign/judge/coverage`
 * exports it, EXCEPT 2.4.3 (`ceo`, 2026-09-14 ~02:24Z): the statement discloses it for ICO's Power BI embed, and
 * masking it would hide #1514's rotated-Tab-cycle defect on ico.org.uk's own pages -- "masking 2.4.3 must not be how
 * (a)'s defect goes quiet."
 */
const ICO_DEAD_SOURCE = "https://ico.org.uk/global/accessibility-statement/";
const ICO_KEPT_UNMASKED = "2.4.3";
const ICO_STATEMENT_READ = {
  url: "https://ico.org.uk/global/accessibility/",
  read: "2026-09-14T08:29:38Z (GET, HTTP 200; served page sha256 cc68bbca211fa5af...)",
  compliance: "This website is partially compliant with the Web Content Accessibility Guidelines version 2.2 AA "
    + "standard, due to the non-compliances listed below.",
  dated: "This statement was prepared on 23 September 2020. It was last reviewed on 22 May 2026.",
  /** Every element holding "This fails WCAG", in page order, with the paragraph that introduces its list. */
  failing: [
    ["Some elements of our main website (ico.org.uk) do not meet the standards in the following ways:", "Some pages require scrolling on small screens. This fails WCAG 2.1 success criterion 1.4.10 (reflow)."],
    ["Some elements of our main website (ico.org.uk) do not meet the standards in the following ways:", "Some interactive components are not far enough apart on small screens. This fails WCAG 2.2 success criterion 2.5.8 (target size – minimum)."],
    ["We use Microsoft Power BI to publish information about data security incidents reported to the ICO. This feature does not meet the accessibility standards in the following ways:", "Frame doesn’t reflow when zoomed in at high levels. This fails WCAG success criterion 1.4.10 (reflow)."],
    ["We use Microsoft Power BI to publish information about data security incidents reported to the ICO. This feature does not meet the accessibility standards in the following ways:", "Buttons are missing labels and some are not in tabbing order. This fails WCAG success criterion 2.1.1 (keyboard)."],
    ["We use Microsoft Power BI to publish information about data security incidents reported to the ICO. This feature does not meet the accessibility standards in the following ways:", "New slides are not announced and do not receive focus. This fails WCAG success criterion 4.1.2 (name, role, value) and 2.4.3 (focus order)."],
    ["We use Microsoft Power BI to publish information about data security incidents reported to the ICO. This feature does not meet the accessibility standards in the following ways:", "Content in text boxes is not read aloud. This fails WCAG success criterion 4.1.2 (name, role, value)."],
    ["We use Microsoft Power BI to publish information about data security incidents reported to the ICO. This feature does not meet the accessibility standards in the following ways:", "It is not possible to manipulate the presentation and styling of text content within the PowerBI visualiser beyond zooming in and changing colours. This fails WCAG success criterion 1.4.12 (visual presentation of text)."],
    ["Our digital assistant does not meet the accessibility standards in the following ways:", "For a screen reader user, the digital assist answer blocks have no clear structure – everything is read out in one big block, or tabbing through the answer content just keeps moving through the options without using the sideways arrows (these are not keyboard operable). This fails WCAG success criterion 1.3.1 Information and relationships."],
    ["Our digital assistant does not meet the accessibility standards in the following ways:", "The digital assist contents remain in the keyboard tabbing order even when the digital assist is collapsed. This fails WCAG success criterion 1.3.1 Information and relationships."],
    ["Our digital assistant does not meet the accessibility standards in the following ways:", "A few buttons in the digital assist have no visible focus indicator. This fails WCAG success criterion 2.4.7 Focus visible."],
    ["Our digital assistant does not meet the accessibility standards in the following ways:", "Visible focus on the user’s messages in the digital assist (when tabbing through the conversation) is unclear. This fails WCAG success criterion 2.4.11 Focus appearance."],
    ["Our digital assistant does not meet the accessibility standards in the following ways:", "Digital assist responses are not announced clearly. This fails WCAG success criterion 4.1.2 Name, role and value."],
    ["Our search pages do not meet the accessibility standards in the following ways:", "Not all pages contain a main heading. This fails WCAG 2.1 success criterion 1.3.1 (info and relationships)."],
    ["Our search pages do not meet the accessibility standards in the following ways:", "Filters are missing ARIA IDs. This fails WCAG 2.1 success criterion 1.3.1 (info and relationships)."],
    ["Our search pages do not meet the accessibility standards in the following ways:", "Placeholder text and the text entered into the search box does not contrast sufficiently with its surroundings. This fails WCAG 2.1 success criterion 2.1 1.4.11 (non-text contrast)."],
    ["Our search pages do not meet the accessibility standards in the following ways:", "Adjacent links point to the same destination. This fails WCAG 2.1 success criterion 1.1.1 (non-text content)."],
    ["Our search pages do not meet the accessibility standards in the following ways:", "Focus obscures links on small devices. This fails WCAG 2.2 success criterion 2.4.11 (focus not obscured – minimum)."],
    ["Our search pages do not meet the accessibility standards in the following ways:", "Some links and interactive components are not far enough apart. This fails WCAG 2.2 success criterion 2.5.8 (target size – minimum)."],
  ],
} as const;

/** How many distinct criteria the fixture's 18 fail sentences name: 19 in all, as 1.3.1, 1.4.10, 2.4.11, 2.5.8 and 4.1.2 repeat. */
const ICO_STATEMENT_DISTINCT_FAILS = 11;

/** Every criterion the statement's own text says it fails: every x.y.z number inside each "This fails WCAG" sentence. */
function icoStatementFails(): string[] {
  return [...new Set(ICO_STATEMENT_READ.failing.flatMap(([, text]) =>
    [...text.matchAll(/This fails WCAG[^]*?(?<!\d)\.(?=\s+[A-Z]|\s*$)/g)]
      .flatMap((sentence) => [...sentence[0].matchAll(/\b([1-4]\.[0-9]\.[0-9]{1,2})\b/g)].map((match) => match[1]))))];
}
const icoPages = () => REAL_PAGES.filter((page) => page.url.startsWith("https://ico.org.uk/"));

test("#1515: the fixture is ICO's statement -- partially compliant, and it discloses 2.4.3 in its own words", () => {
  assert.match(ICO_STATEMENT_READ.compliance, /partially compliant with the Web Content Accessibility Guidelines version 2\.2 AA/);
  const fails = icoStatementFails();
  assert.equal(fails.length, ICO_STATEMENT_DISTINCT_FAILS, "every fail sentence parsed across its three wordings, each criterion once");
  for (const criterion of ["1.1.1", "2.1.1", "2.4.7", ICO_KEPT_UNMASKED]) {
    assert.ok(fails.includes(criterion), `the statement names ${criterion}`);
  }
});

test("#1515: every ICO entry cites the live statement, dated, and no entry cites the dead URL", () => {
  assert.equal(icoPages().length, 2, "the for-the-public and enforcement calibration pages");
  for (const page of icoPages()) {
    assert.ok(page.source.includes(`(${ICO_STATEMENT_READ.url})`), `${page.url} must cite the statement: ${page.source}`);
    assert.match(page.source, /partially compliant/, `${page.url}: the statement's own words`);
    assert.match(page.source, /prepared 2020-09-23, last reviewed 2026-05-22, read 2026-09-14/, `${page.url}: dated`);
  }
  const dead = REAL_PAGES.filter((page) => page.source.includes(ICO_DEAD_SOURCE)).map((page) => page.url);
  assert.deepEqual(dead, [], "a source that returns 404 cites nothing");
});

test("#1515: BOTH ICO entries exclude the statement's failures that SCORED_CRITERIA covers, except 2.4.3", () => {
  const scored = new Set<string>(SCORED_CRITERIA);
  const expected = icoStatementFails()
    .filter((criterion) => scored.has(criterion) && criterion !== ICO_KEPT_UNMASKED).sort(byCriterion);
  assert.ok(expected.includes("2.1.1") && expected.includes("2.4.7"),
    "the positive control: the scored disclosures the enforcement entry did not carry");
  for (const page of icoPages()) {
    assert.deepEqual([...(page.claimExcludes ?? [])].map(String).sort(byCriterion), expected,
      `${page.url} (${page.role}): the statement's own disclosures a head scores, less 2.4.3 -- no more, no fewer`);
  }
});

test("#1515: 2.4.3 stays UNMASKED on both ICO entries although the statement discloses it", () => {
  assert.ok(icoStatementFails().includes(ICO_KEPT_UNMASKED), "leaving it out is a decision only while the statement names it");
  for (const page of icoPages()) {
    assert.ok(!(page.claimExcludes ?? []).map(String).includes(ICO_KEPT_UNMASKED),
      `${page.url}: ceo (2026-09-14 ~02:24Z) -- 2.4.3 is disclosed for ICO's Power BI embed, and masking it would hide `
      + "#1514's rotated-Tab-cycle defect on this site's own pages");
  }
});

/**
 * #1610: networkrail careers follows NETWORK RAIL'S accessibility STATEMENT, read verbatim here as the fixture -- the
 * #1508 shape. The calibration sweep 2f9c51aa (2026-09-14, pinned to `2a1c24bc`) counted this page's 4.1.2 as asserted
 * wrongly because the entry's `claimExcludes` carried only one item's first three criteria; the statement discloses
 * 4.1.2 in that same item.
 *
 * READ WHOLE, as the row requires: seven "This fails WCAG …" items, all under its "Non-compliance with the
 * accessibility regulations" heading, naming ten criteria. The wording varies ("Success Criterion", "Success Criteria
 * … and …", "success criterion"), so the parse takes every x.y.z number inside each fail SENTENCE, as #1515's does.
 * The seventh item is about Network Rail's customer help website, not this one; its only criterion, 4.1.2, is also in
 * the fifth, so it changes nothing. `claimExcludes` is those failures intersected with `SCORED_CRITERIA` as
 * `@a11ign/judge/coverage` exports it -- derived below, never retyped.
 */
const NETWORKRAIL_STATEMENT_READ = {
  url: "https://www.networkrail.co.uk/accessibility/",
  read: "2026-09-14T14:33:45Z (GET, HTTP 200, no redirect; served page 156,740 bytes, sha256 33e6454649865028...)",
  compliance: "This website is partially compliant with the Web Content Accessibility Guidelines version 2.1 AA standard, due to ‘the non-compliances’ listed below.",
  dated: "This statement was prepared on 1 August 2019. It was last reviewed on 6 August 2026.",
  /** Every element holding "fails WCAG", in page order, with its heading. */
  failing: [
    ["Non-compliance with the accessibility regulations", "The website navigation menu cannot be fully accessed using a keyboard when viewed at higher zoom levels. This fails WCAG 2.2 Success Criterion 2.1.1 Keyboard (Level A). We plan to fix this by September 2026."],
    ["Non-compliance with the accessibility regulations", "Keyboard focus is not always visible within interactive elements. Keyboard focus can also become hidden behind website components including the navigation menu, search panel and cookie banner. This fails WCAG 2.2 Success Criteria 2.4.7 Focus Visible (Level AA) and 2.4.11 Focus Not Obscured (Minimum) (Level AA). We plan to fix this by September 2026."],
    ["Non-compliance with the accessibility regulations", "The Safe Spaces banner does not reflow correctly when viewed at high magnification or on smaller screens. This fails WCAG 2.2 Success Criterion 1.4.10 Reflow (Level AA). We plan to fix this by September 2026."],
    ["Non-compliance with the accessibility regulations", "The Safe Spaces banner uses an image of text rather than accessible text content. This fails WCAG 2.2 Success Criterion 1.4.5 Images of Text (Level AA). We plan to fix this by September 2026."],
    ["Non-compliance with the accessibility regulations", "The Safe Spaces banner, website search, website logo and parts of our online suggestion forms do not always provide appropriate alternative text, accessible names or labels. This means some users of assistive technologies may not be able to understand the purpose of content or complete forms successfully. This fails WCAG 2.2 Success Criteria 1.1.1 Non-text Content (Level A), 1.3.1 Info and Relationships (Level A), 2.4.4 Link Purpose (In Context) (Level A) and 4.1.2 Name, Role, Value (Level A). We plan to fix this by September 2026."],
    ["Non-compliance with the accessibility regulations", "Some elements within the Safe Spaces banner, navigation menu and online forms do not have sufficient colour contrast. This fails WCAG 2.2 Success Criterion 1.4.3 Contrast (Minimum) (Level AA). We plan to fix this by September 2026."],
    ["Non-compliance with the accessibility regulations", "The file upload button used to attach documents on out customer help website may not be correctly interpreted by screen readers. This fails WCAG 2.2 success criterion 4.1.2 Name, Role Value. We have raised this issue with the supplier and are awaiting confirmation of a remediation date."],
  ],
} as const;

/** How many "fails WCAG" items the statement lists, all under "Non-compliance with the accessibility regulations". */
const NETWORKRAIL_STATEMENT_ITEMS = 7;
/** How many distinct criteria those seven items name: 4.1.2 appears twice. */
const NETWORKRAIL_STATEMENT_DISTINCT_FAILS = 10;

/** Every criterion a set of fail items names: every x.y.z number inside each "fails WCAG" sentence. */
function statementFails(failing: readonly (readonly [string, string])[]): string[] {
  return [...new Set(failing.flatMap(([, text]) =>
    [...text.matchAll(/This fails WCAG[^]*?(?<!\d)\.(?=\s+[A-Z]|\s*$)/gi)]
      .flatMap((sentence) => [...sentence[0].matchAll(/\b([1-4]\.[0-9]\.[0-9]{1,2})\b/g)].map((match) => match[1]))))];
}
const networkrailCareers = () => REAL_PAGES.filter((page) => page.url === "https://www.networkrail.co.uk/careers/");
const scoredOf = (criteria: readonly string[]) => {
  const scored = new Set<string>(SCORED_CRITERIA);
  return criteria.filter((criterion) => scored.has(criterion)).sort(byCriterion);
};

test("#1610: the fixture is Network Rail's statement -- partially compliant, and it discloses 4.1.2 in its own words", () => {
  assert.match(NETWORKRAIL_STATEMENT_READ.compliance, /partially compliant with the Web Content Accessibility Guidelines/);
  const fails = statementFails(NETWORKRAIL_STATEMENT_READ.failing);
  assert.equal(NETWORKRAIL_STATEMENT_READ.failing.length, NETWORKRAIL_STATEMENT_ITEMS, "all seven items the statement lists");
  assert.equal(fails.length, NETWORKRAIL_STATEMENT_DISTINCT_FAILS, "every fail sentence parsed across its wordings, each criterion once");
  assert.ok(fails.includes("4.1.2"), "the disclosure the calibration sweep's one asserted-wrongly count rests on");
});

test("#1610: 4.1.2 is disclosed for THIS website's own search, not only for Network Rail's customer help website", () => {
  // The sweep's finding is on this site's "Open search" control. The seventh item also names 4.1.2, but for the file
  // upload button "on out customer help website" -- another site -- so it must not be what licenses masking this page.
  const itemAbout = (phrase: string) => NETWORKRAIL_STATEMENT_READ.failing.filter(([, text]) => text.includes(phrase));
  const search = itemAbout("website search");
  const helpSite = itemAbout("customer help website");
  assert.equal(search.length, 1, "the one item about this website's search");
  assert.equal(helpSite.length, 1, "the positive control: the other-site item is in the fixture too");
  assert.ok(statementFails(search).includes("4.1.2"), "this website's search item discloses 4.1.2 itself");
  assert.deepEqual(statementFails(helpSite), ["4.1.2"], "the other-site item names 4.1.2 alone, so dropping it moves nothing");
});

test("#1610: networkrail careers cites the live statement, dated", () => {
  assert.equal(networkrailCareers().length, 1, "the careers calibration page");
  for (const page of networkrailCareers()) {
    assert.ok(page.source.includes(`(${NETWORKRAIL_STATEMENT_READ.url})`), `${page.url} must cite the statement: ${page.source}`);
    assert.match(page.source, /partially compliant/, `${page.url}: the statement's own words`);
    assert.match(page.source, /prepared 2019-08-01, last reviewed 2026-08-06, read 2026-09-14/, `${page.url}: dated`);
  }
});

test("#1610: networkrail careers excludes exactly the statement's failures that SCORED_CRITERIA covers", () => {
  const expected = scoredOf(statementFails(NETWORKRAIL_STATEMENT_READ.failing));
  assert.ok(expected.includes("4.1.2") && expected.includes("1.1.1"), "the positive control: scored disclosures exist at all");
  for (const page of networkrailCareers()) {
    assert.deepEqual([...(page.claimExcludes ?? [])].map(String).sort(byCriterion), expected,
      `${page.url} (${page.role}): the statement's own disclosures a head scores -- no more, no fewer`);
  }
});

test("#1610 CONTROL: a criterion planted in the fixture changes the derived set, so the derivation reads the text", () => {
  const planted = [...NETWORKRAIL_STATEMENT_READ.failing,
    ["Non-compliance with the accessibility regulations", "Errors are not described. This fails WCAG 2.2 Success Criterion 3.3.1 Error Identification (Level A)."]] as const;
  const derived = scoredOf(statementFails(planted));
  assert.ok(derived.includes("3.3.1"), "a planted scored criterion enters the derived set");
  assert.notDeepEqual(derived, scoredOf(statementFails(NETWORKRAIL_STATEMENT_READ.failing)));
  assert.notDeepEqual([...(networkrailCareers()[0]?.claimExcludes ?? [])].map(String).sort(byCriterion), derived,
    "so the entry's claimExcludes would no longer match -- the equality above is not vacuous");
});

test("#1610 CONTROL: the derivation is about THIS entry -- Sport England's claimExcludes, from its own statement, is unchanged", () => {
  const sport = REAL_PAGES.filter((page) => page.url === "https://www.sportengland.org/research-and-data/data/active-lives");
  assert.equal(sport.length, 1, "the neighbouring calibration entry");
  // Its value at `1247cacf`, the claim-time main: this row derives Network Rail's statement and touches no other entry.
  assert.deepEqual([...(sport[0].claimExcludes ?? [])].map(String), ["1.3.1", "4.1.2", "4.1.3"]);
  assert.notDeepEqual([...(sport[0].claimExcludes ?? [])].map(String).sort(byCriterion),
    scoredOf(statementFails(NETWORKRAIL_STATEMENT_READ.failing)), "the two statements disclose different sets");
});
