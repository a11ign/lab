/**
 * #954: THE CROSS-REFERENCE HALF OF THIS FILE IS OFF THE PULL-REQUEST PATH. `check-transfer-urls`'s rule now runs
 * once a night, in `scripts/doc-cross-reference-report.mjs`, which imports the same module this file
 * does -- so nothing about the rule changed, only when it runs and what a disagreement costs. See #905
 * for the argument and #954 for the retirement, which waited until the first nightly report had posted.
 *
 * WHAT STAYS HERE is what that report does not assert: how a URL is parsed out of a line, and how a 2xx, a 404 and a thrown fetch are classified -- proved against fixtures and a fake fetch, never the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findTransferUrls, checkTransferUrls, reportTransferUrls,
} from "../../../../scripts/check-transfer-urls.mjs";
import { PRODUCT_REPO } from "../../../../scripts/repo-identity.mjs";

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

test("a badge-shaped line yields TWO separate URLs, not one string spanning both", () => {
  // #569 moved README.md's own two badge URLs off PRODUCT_REPO (they must resolve today, so they now
  // cite REPO, not the future org name) -- exactly the fix this file's population is built to prove is
  // safe to make, one site at a time. So the regex property this test guards (a README badge line packs
  // TWO adjacent URLs with no separator between them, `[![...](URL1)](URL2)`, and a bare `\S+` would
  // swallow the markdown between them into one unfetchable string) can no longer be demonstrated against
  // README.md's live content -- the population it depended on is the thing #569 correctly emptied.
  // A synthetic fixture, in the identical shape, proves the SAME property without depending on any real
  // file continuing to carry PRODUCT_REPO in this exact adjacency forever.
  const dir = mkdtempSync(join(tmpdir(), "check-transfer-urls-badge-"));
  try {
    const badgeLine = `[![lint](https://github.com/${PRODUCT_REPO}/actions/workflows/lint.yml/badge.svg)]`
      + `(https://github.com/${PRODUCT_REPO}/actions/workflows/lint.yml)`;
    writeFileSync(join(dir, "fixture.md"), `${badgeLine}\n`, "utf8");
    const found = findTransferUrls(dir);
    assert.ok(found.length >= 2, "the fixture's badge line should yield at least two URLs");
    for (const hit of found) {
      assert.ok(!hit.url.includes("]("),
        `${hit.file}:${hit.line} carries markdown syntax inside the extracted URL (${hit.url}) -- the `
        + "pattern swallowed the gap between two adjacent badge links instead of stopping at the delimiter");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
