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

import { assertDisjoint, pagesFor, REAL_PAGES } from "./real-page-corpus.mjs";

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

test("every page carries a PUBLISHED claim and a citation for it", () => {
  // The selection rule of the whole corpus: the label comes from the source, never from us. A page whose
  // `source` does not say where the claim is published is a page we labelled ourselves.
  for (const page of REAL_PAGES) {
    assert.match(page.url, /^https:\/\//, `${page.url} must be a real fetchable page`);
    assert.ok(["conformant", "inaccessible"].includes(page.publishedClaim));
    assert.match(page.source, /https:\/\//, `${page.url} must cite where its claim is published`);
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
