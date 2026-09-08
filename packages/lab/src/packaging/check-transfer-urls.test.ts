import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  findTransferUrls, checkTransferUrls, reportTransferUrls,
} from "../../../../scripts/check-transfer-urls.mjs";

/**
 * #524: every public doc URL naming `a11ign/a11ign` is a 404 today, and nothing tracked the interval
 * before the transfer (#63, 2026-09-15). `scripts/check-transfer-urls.mjs` is what runs ON that day and
 * gets pasted; these tests prove its two halves offline, with NO live network call, since CI has no
 * business fetching ~30 external URLs on every push for a check whose whole point is a single future date.
 *
 * DISCOVERY, proven against the real tree (fast, no network): the walk finds a real, non-trivial
 * population, not a hand-picked one -- the same "discovered, not typed" correction
 * `documented-checkout-step.test.ts` needed after missing a real file on its first pass.
 *
 * CLASSIFICATION, proven with an INJECTED fetch (no network, mutation-checkable): a 2xx is `ok`, a
 * non-2xx is `broken` and reported by file:line, and a THROWN fetch is `unreachable` -- a distinct
 * outcome from `broken`, per #524's own explicit requirement that "the link is dead" and "I could not
 * reach the network" must never collapse into one report.
 */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

test("the vacuity guard: the walk finds a real, non-trivial population in the real tree", () => {
  const found = findTransferUrls(REPO);
  // 29 URLs across 22 files, measured 2026-09-08 -- NOT the 34 the #524 issue first counted, which
  // measured a different quantity: every file containing the bare STRING "a11ign/a11ign", including
  // twelve with no fetchable URL at all (PLAN.md's prose, repo-identity.mjs's own declaration, three
  // consistency tests reading PRODUCT_REPO via the imported constant rather than a literal). Both counts
  // are correct answers to different questions; this test's floor is the URL count, the one this script
  // can actually check.
  assert.ok(found.length >= 20,
    `found only ${found.length} a11ign/a11ign URL(s) -- 29 were found across 22 files on 2026-09-08; a `
    + "shrunk count means the discovery pattern stopped matching, not that the tree needs fewer checked");
});

test("the population spans more than markdown -- package.json fields are not missed", () => {
  const found = findTransferUrls(REPO);
  const packageJsonHits = found.filter((f) => f.file.endsWith("package.json"));
  assert.ok(packageJsonHits.length > 0,
    "found no package.json repository/homepage field naming a11ign/a11ign -- a walk that only reads "
    + "markdown would miss exactly these, which are published to the npm registry and outlive a doc edit");
});

test("a README badge line yields TWO separate URLs, not one string spanning both", () => {
  const found = findTransferUrls(REPO);
  const readmeHits = found.filter((f) => f.file === "README.md");
  assert.ok(readmeHits.length >= 2, "README.md should carry at least the two workflow badge URLs");
  for (const hit of readmeHits) {
    assert.ok(!hit.url.includes("]("),
      `${hit.file}:${hit.line} carries markdown syntax inside the extracted URL (${hit.url}) -- the `
      + "pattern swallowed the gap between two adjacent badge links instead of stopping at the delimiter");
  }
});

test("a synthetic test fixture (trunk-revert.test.ts's own PR-body URL) is included, not hidden", () => {
  // The walk cannot tell a real documented URL from a look-alike fixture string in another test's own
  // source -- trunk-revert.test.ts builds a synthetic `runUrl: "https://github.com/a11ign/a11ign/actions/
  // runs/123"` to test revertPrBody()'s formatting, and that string matches this script's pattern exactly
  // as written. Deliberately OVER-included rather than filtered out by an exclusion list: a hidden
  // exclusion is a thing a future reader cannot see, while a fixture appearing in the transfer-day output
  // is harmless and self-explanatory (it names its own file and is obviously not a real doc reference).
  const found = findTransferUrls(REPO);
  const hit = found.find((f) => f.file === "packages/lab/src/packaging/trunk-revert.test.ts");
  assert.ok(hit, "trunk-revert.test.ts's synthetic fixture URL should still be found by the walk");
});

test("CLASSIFICATION: a 2xx response is reported as resolved cleanly", async () => {
  const sites = [{ file: "fixture.md", line: 1, url: "https://example.com/ok" }];
  const results = await checkTransferUrls(sites, {
    fetchImpl: async () => ({ status: 200, ok: true }),
  });
  assert.equal(results[0].reachable, true);
  assert.equal(results[0].ok, true);
  const report = reportTransferUrls(results);
  assert.match(report, /1 resolved cleanly/);
});

test("MUTATION TARGET: a real 404 is reported as broken, by file:line, not silently passed", async () => {
  // A plain example.com path, deliberately NOT shaped like a real PRODUCT_REPO URL: this fixture is read
  // by node:test as SOURCE TEXT, and the live script walks the whole tree on transfer day -- a literal
  // `github.com/a11ign/a11ign/...` string here would make this test file part of the population it is
  // meant to be testing, the same look-alike-fixture trap flagged elsewhere today. The classification
  // logic under test does not care what domain the URL names.
  const sites = [{ file: "docs/known-dead.md", line: 42, url: "https://example.com/known-dead-path" }];
  const results = await checkTransferUrls(sites, {
    fetchImpl: async () => ({ status: 404, ok: false }),
  });
  assert.equal(results[0].reachable, true);
  assert.equal(results[0].ok, false);
  const report = reportTransferUrls(results);
  assert.match(report, /404\s+docs\/known-dead\.md:42/,
    "a broken URL must be named by its exact file:line in the report, not just counted");
});

test("MUTATION TARGET: a fetch that THROWS is UNREACHABLE, never silently reported as broken or as clean", async () => {
  const sites = [{ file: "docs/x.md", line: 7, url: "https://example.com/whatever" }];
  const results = await checkTransferUrls(sites, {
    fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); },
  });
  assert.equal(results[0].reachable, false);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, null);
  const report = reportTransferUrls(results);
  assert.match(report, /COULD NOT BE REACHED/);
  assert.doesNotMatch(report, /resolved and answered NON-200/,
    "an unreachable URL must not also be counted as a resolved-but-broken one");
});

test("CONTROL: a mix of ok, broken and unreachable is reported as three distinct groups, never merged", async () => {
  const sites = [
    { file: "a.md", line: 1, url: "https://example.com/a" },
    { file: "b.md", line: 2, url: "https://example.com/b" },
    { file: "c.md", line: 3, url: "https://example.com/c" },
  ];
  let call = 0;
  const results = await checkTransferUrls(sites, {
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return { status: 200, ok: true };
      if (call === 2) return { status: 404, ok: false };
      throw new Error("network down");
    },
  });
  assert.deepEqual(results.map((r) => r.reachable), [true, true, false]);
  assert.deepEqual(results.map((r) => r.ok), [true, false, false]);
});
