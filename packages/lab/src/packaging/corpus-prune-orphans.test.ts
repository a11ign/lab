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
import { classifyOrphan, pathOf } from "../../scripts/corpus-prune-orphans.mjs";

// 192.0.2.0/24 is TEST-NET-1 (RFC 5737), reserved for documentation and routable nowhere. The real fleet
// address is deliberately NOT written here: #83 is about internal addresses reaching a repo meant to be
// generic, and a test fixture is a source file like any other. The property under test is that the ORIGIN
// differs from the declaration — any origin will do, and a fake one proves it more honestly.

/** The fixture pages as `REAL_PAGES` declares them — localhost, which no fleet worker can reach. */
const DECLARED = new Set([
  "/route-title-stale/good.html",
  "/visit/all/edinburgh-castle",
  "/search?query=",
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

test("RELOCATED wins over RETIRED — a path match is decisive whatever the host", () => {
  // If this ever inverted, the prune would delete a declared page's only capture while reporting a tidy-up.
  // Asserted with a host that shares nothing with the declaration, so only the PATH can be doing the work.
  const verdict = classifyOrphan("https://some-other-host.example/search?query=", DECLARED);
  assert.equal(verdict.verdict, "RELOCATED",
    "a path that a declared page has must never be classified deletable, whatever the origin");
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
