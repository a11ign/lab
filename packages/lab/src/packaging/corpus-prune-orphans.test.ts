/**
 * Which orphaned captures may be DELETED, and which must never be — the safety property of #143's prune.
 *
 * A capture no `REAL_PAGES` entry claims has two possible causes, and they need opposite treatment:
 *
 *   RETIRED    the publisher moved the page, the declaration followed, the old capture stayed. Deletable.
 *   RELOCATED  the capture IS of a declared page, reached at a different ORIGIN. Never deletable.
 *
 * The second is not hypothetical. Every fixture page is declared `http://localhost:5050/...` and captured
 * `http://192.0.2.10:5050/...`, because a fleet worker cannot reach `localhost` — that resolves to
 * itself, not the host serving pages. Ten captures on the authoritative corpus are in that state today
 * (#146), and five of them are the only real-page grounding 2.4.1, 2.4.2, 2.4.3, 2.1.1 and 1.4.13 have.
 *
 * **Deleting one would turn a matching bug into a data-loss bug**, and `runs/` is gitignored with no undo:
 * these captures are hours of worker time and are NOT reproducible, because `browserVersion` is a cache
 * key and evidence taken under Edge 151 cannot be re-made now 152 ships.
 *
 * So RELOCATED wins over RETIRED wherever both could apply. That asymmetry is asserted first and by name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyOrphan } from "../../scripts/corpus-prune-orphans.mjs";
import { pathOf, REAL_PAGES } from "../training/real-page-corpus.mjs";

// 192.0.2.0/24 is TEST-NET-1 (RFC 5737), reserved for documentation and routable nowhere. The real fleet
// address is deliberately NOT written here: #83 is about internal addresses reaching a repo meant to be
// generic, and a test fixture is a source file like any other. The property under test is that the ORIGIN
// differs from the declaration — any origin will do, and a fake one proves it more honestly.

/**
 * Declared pages as `REAL_PAGES` holds them: path -> the declared PAGE, its url and its role.
 *
 * Not a bare set of paths, and that is the fix for the defect real data found — see the
 * `/about` test below. Whether a differing origin is EXPLAINED depends on whether the declared page is a
 * fixture, so the verdict needs to know which page a path belongs to. And "fixture" is its ROLE (#940).
 */
const DECLARED = new Map([
  ["/route-title-stale/good.html", { url: "http://localhost:5050/route-title-stale/good.html", role: "fixture" }],
  ["/visit/all/edinburgh-castle", { url: "https://www.historicenvironment.scot/visit/all/edinburgh-castle/", role: "training" }],
  ["/search?query=", { url: "https://caselaw.nationalarchives.gov.uk/search?query=", role: "calibration" }],
  ["/about", { url: "https://www.gov.scot/about/", role: "training" }],
]);

test("a declared page reached at ANOTHER ORIGIN is RELOCATED, never deletable", () => {
  // The whole safety property. `localhost:5050` declared, `192.0.2.10:5050` captured — both correct,
  // nothing reconciles them, and the capture is live evidence of a page that is still declared.
  const verdict = classifyOrphan("http://192.0.2.10:5050/route-title-stale/good.html", DECLARED);
  assert.equal(verdict.verdict, "RELOCATED");
  assert.match(verdict.why, /NOT deletable/);
});

test("a url no declared page has, by origin OR path, is RETIRED", () => {
  // `historicenvironment.scot/visit-a-place/places/edinburgh-castle/` beside the declared
  // `/visit/all/edinburgh-castle/`: same site, same page, address the publisher has since changed.
  const verdict = classifyOrphan("https://www.historicenvironment.scot/visit-a-place/places/edinburgh-castle/", DECLARED);
  assert.equal(verdict.verdict, "RETIRED");
});

test("a path shared with an unrelated REAL publisher is RETIRED, not RELOCATED", () => {
  // THE DEFECT REAL DATA FOUND, and the reason a destructive tool is run in report mode on the real
  // corpus before any of its verdicts are trusted.
  //
  // The first version matched on PATH alone, so it called `www.nationalarchives.gov.uk/about/` RELOCATED
  // because the declared `www.gov.scot/about/` shares the path `/about`. Two unrelated publishers, one
  // ordinary path. It failed in the SAFE direction — refusing to delete something it should have offered
  // — which is exactly why every unit test here passed: they all used paths no other page has. Only 99
  // real declarations could show it.
  //
  // Between two real hosts, the HOST is the identity. An origin difference has to be explained, not
  // merely present.
  const verdict = classifyOrphan("https://www.nationalarchives.gov.uk/about/", DECLARED);
  assert.equal(verdict.verdict, "RETIRED",
    "gov.scot/about and nationalarchives/about are different pages; a shared path is a coincidence");
});

test("only a PAGE-SERVER declaration explains a differing origin", () => {
  // The one case where our own serving arrangement makes the origin differ legitimately: declared
  // `localhost:5050`, captured at the host's LAN address, same port, because a worker cannot reach
  // `localhost`. That is #146 and it cannot happen between two real publishers.
  const served = classifyOrphan("http://192.0.2.10:5050/route-title-stale/good.html", DECLARED);
  assert.equal(served.verdict, "RELOCATED");
  // Same path, but the declaration is a real site — so a stranger's host is not an explained origin.
  const notServed = classifyOrphan("https://some-other-host.example/search?query=", DECLARED);
  assert.equal(notServed.verdict, "RETIRED",
    "caselaw.nationalarchives.gov.uk is a real host; another host with the same query path is a "
    + "different page, not the same one relocated");
});

test("a capture with no usable url is UNCLASSIFIED and is left alone", () => {
  // "We could not tell" and "it is safe to delete" must never be the same answer. A damaged capture is a
  // different question from an orphaned one, and answering the first with the second destroys evidence.
  for (const url of ["", "not-a-url", "   "]) {
    assert.equal(classifyOrphan(url, DECLARED).verdict, "UNCLASSIFIED", `"${url}" must not read as deletable`);
  }
});

test("pathOf strips the origin and normalises, so two spellings of one page compare equal", () => {
  assert.equal(pathOf("http://localhost:5050/route-title-stale/good.html"), "/route-title-stale/good.html");
  assert.equal(pathOf("http://192.0.2.10:5050/route-title-stale/good.html"), "/route-title-stale/good.html");
  // Trailing slashes and case are normalised by `normaliseUrl`, the same function `realPageFor` uses —
  // reused rather than re-spelled, so the prune and the gate can never disagree about what one page is.
  assert.equal(pathOf("https://Example.com/About/"), pathOf("https://other.example/about"));
  // A bare origin has no path; it must not become the empty string, which would match everything.
  assert.equal(pathOf("https://example.com"), "/");
});


// --- #940: DATASET_BASE_URL MUST NOT DECIDE WHAT MAY BE DELETED -------------------------------------------

test("#940: a fixture declared at a NON-loopback base -- DATASET_BASE_URL set -- is still RELOCATED", () => {
  // The declaration as `FIXTURE_BASE` makes it when the variable names the lab's page server by address.
  // Decided by host alone, this came back RETIRED, and RETIRED is what `--apply` deletes.
  const underBase = new Map([["/route-title-stale/good.html",
    { url: "http://192.0.2.10:5050/route-title-stale/good.html", role: "fixture" }]]);
  const verdict = classifyOrphan("http://198.51.100.7:5050/route-title-stale/good.html", underBase);
  assert.equal(verdict.verdict, "RELOCATED");
  assert.match(verdict.why, /NOT deletable/);
});

test("#940: the host stays a second signal -- a loopback declaration with no role is still RELOCATED", () => {
  // Either signal keeps a capture. Wrongly keeping one costs a report line; wrongly deleting one is permanent.
  const noRole = new Map([["/route-title-stale/good.html", { url: "http://localhost:5050/route-title-stale/good.html" }]]);
  assert.equal(classifyOrphan("http://192.0.2.10:5050/route-title-stale/good.html", noRole).verdict, "RELOCATED");
});

test("#940: a REAL page's path match is still RETIRED -- the role widens nothing for a published page", () => {
  // The other direction, and the reason it matters: a tool that called everything RELOCATED would pass the
  // tests above and never delete anything again.
  assert.equal(classifyOrphan("https://www.nationalarchives.gov.uk/about/", DECLARED).verdict, "RETIRED");
  assert.equal(classifyOrphan("https://www.historicenvironment.scot/visit-a-place/places/edinburgh-castle/", DECLARED).verdict,
    "RETIRED");
});

const PRUNE = fileURLToPath(new URL("../../scripts/corpus-prune-orphans.mjs", import.meta.url));
/** Every fixture's path, from the declarations themselves -- never a second, hand-typed list of ten. */
const FIXTURE_PATHS = REAL_PAGES.filter((page) => page.role === "fixture").map((page) => pathOf(page.url));
/** A documentation-range base standing in for "the lab's page server, configured by DATASET_BASE_URL". */
const CONFIGURED_BASE = "http://192.0.2.10:5050";
const RETIRED_REAL_PAGE = "https://www.historicenvironment.scot/visit-a-place/places/edinburgh-castle/";

test("#940: with DATASET_BASE_URL non-loopback, --apply deletes NO fixture capture and still deletes a retired page", () => {
  // THE REAL TOOL, IN THE REAL ENVIRONMENT, ON A SYNTHETIC CORPUS. `FIXTURE_BASE` is read from the variable at
  // import, so only a process started with it set can show what the lab would do. Before #940 this deleted
  // every fixture capture below as RETIRED -- "the declaration moved and this stayed" -- because
  // `classifyOrphan` decided "fixture" from the declaration's HOST, and the variable had moved the host.
  assert.ok(FIXTURE_PATHS.length > 0, "no fixture in REAL_PAGES, so this test asserts over nothing");
  const dir = mkdtempSync(join(tmpdir(), "prune-940-"));
  try {
    const write = (file: string, url: string) =>
      writeFileSync(join(dir, file), JSON.stringify({ role: "fixture", capturedAt: "2026-09-10T00:00:00Z", capture: { url } }));
    // Two shapes of fixture capture: at an ADDRESS (a worker reached the page server by IP), and at a NAMED
    // host no matcher undoes -- the second can only be saved by `classifyOrphan` itself.
    FIXTURE_PATHS.forEach((path, i) => {
      write(`fixture-${i}-address.json`, `http://198.51.100.7:5050${path}`);
      write(`fixture-${i}-named.json`, `http://pages.example.test:5050${path}`);
    });
    writeFileSync(join(dir, "retired.json"), JSON.stringify({ capture: { url: RETIRED_REAL_PAGE } }));

    const env: Record<string, string | undefined> = { ...process.env, DATASET_BASE_URL: CONFIGURED_BASE, REAL_CORPUS_ROOT: dir };
    delete env.A11Y_RUNS_READONLY;
    const run = spawnSync(process.execPath, [PRUNE, "--apply"], { env, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);

    const gone = FIXTURE_PATHS.flatMap((_, i) => [`fixture-${i}-address.json`, `fixture-${i}-named.json`])
      .filter((file) => !existsSync(join(dir, file)));
    assert.deepEqual(gone, [], "fixture captures were DELETED -- the only real-page grounding for five criteria");
    assert.ok(!existsSync(join(dir, "retired.json")), "the other direction: a genuinely retired page is still deleted");
    // The named-host captures are the ones `classifyOrphan` decides, so they must be reported RELOCATED.
    assert.match(run.stdout, new RegExp(`1 RETIRED, ${FIXTURE_PATHS.length} RELOCATED`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
