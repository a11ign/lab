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
