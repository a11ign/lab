/**
 * Batch 2 of the real-page corpus (A11-170): drawn by the corpus's own selection rule, from a committed pool
 * and committed probes, by a seed -- and sealed away from every reader that could capture or score it.
 *
 * Nothing here touches the network. The draw is replayed over `real-page-batch-2/pool.json` and
 * `probes.json`, and a probe missing from the record throws rather than falling back to a fetch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCORED_CRITERIA } from "@a11ign/judge/coverage";
import {
  BATCH_2_PAGES, normaliseUrl, pagesFor, realPageFor, REAL_PAGES, supersededBy,
} from "./real-page-corpus.mjs";
import {
  addressesSamePage, batchTwoLabel, BATCH_2_SEED, BATCH_2_SIZE, candidatesFrom, eligibleOrigins, evalFixtureUrls,
  isCandidate, MAX_CANDIDATES_PER_ORIGIN, orderKey, originOf, parseSitemap, probeAccepts, replayProber,
  selectBatchTwo, sitemapsFromRobots, takenAddresses,
  type Pool, type Probe, type Prober,
} from "./real-page-batch.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pool = JSON.parse(readFileSync(join(here, "real-page-batch-2", "pool.json"), "utf8")) as Pool;
const probes = JSON.parse(readFileSync(join(here, "real-page-batch-2", "probes.json"), "utf8")) as Probe[];
const testUrls = evalFixtureUrls(join(here, "..", "eval", "fixtures"));
const taken = takenAddresses(REAL_PAGES, testUrls);

const accepting: Prober = async (url) => ({
  url, status: 200, contentType: "text/html; charset=utf-8", final: url, at: "1970-01-01T00:00:00Z",
});
const answering = (status: number, only: string): Prober => async (url) =>
  normaliseUrl(url) === normaliseUrl(only) ? { ...(await accepting(url)), status } : accepting(url);

test("the eval fixture directory really does yield test URLs, or the duplicate check below is vacuous", () => {
  assert.ok(testUrls.length >= 20, `expected the eval fixtures to yield test URLs, got ${testUrls.length}`);
  assert.ok(testUrls.some((u) => u.includes("w3.org")), "expected at least one real W3C page in the test set");
});

// --- The duplicate guard fails closed -----------------------------------------------------------------

/** A fixture directory holding the given files (a nested one included), written as given. */
function fixtureDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "eval-fixtures-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }
  return root;
}

test("CONTROL: a malformed eval fixture stops the guard, naming the file, and is never read as having no url", () => {
  const root = fixtureDir({ "ok.json": '{"url":"https://a.example/x"}', "nested/broken.json": '{"url": "https://b.example/y"' });
  assert.throws(() => evalFixtureUrls(root), (error: Error) => /nested[\\/]broken\.json/.test(error.message) && /refusing to draw/.test(error.message));
});

test("CONTROL: an empty fixture file stops the guard too", () => {
  assert.throws(() => evalFixtureUrls(fixtureDir({ "empty.json": "" })), /empty\.json/);
});

test("the same guard reads valid JSON: a capture gives its url, valid JSON that records none gives nothing (the passing twins)", () => {
  const root = fixtureDir({
    "a.json": '{"url":"https://a.example/x"}',
    "nested/b.json": '{"url":"https://b.example/y","other":1}',
    "no-url.json": '{"name":"not a capture"}',
    "null.json": "null",
    "list.json": "[1,2]",
    "non-string.json": '{"url":42}',
    "notes.txt": "not json, and not read",
  });
  assert.deepEqual(evalFixtureUrls(root).sort(), ["https://a.example/x", "https://b.example/y"]);
});

// --- Reproduced from the seed ------------------------------------------------------------------------

test("BATCH_2_PAGES is exactly the draw the seed makes over the committed pool and probes, in order", async () => {
  const drawn = await selectBatchTwo(pool, replayProber(probes), { seed: BATCH_2_SEED, taken });
  assert.deepEqual(BATCH_2_PAGES.map((p) => p.url), drawn.map((d) => d.url));
  assert.deepEqual(BATCH_2_PAGES.map((p) => p.drawnFrom), drawn.map((d) => d.drawnFrom));
});

test("the pool was drawn with the committed seed and within the committed caps", () => {
  assert.equal(pool.seed, BATCH_2_SEED);
  assert.equal(pool.caps.candidatesPerOrigin, MAX_CANDIDATES_PER_ORIGIN);
  for (const entry of pool.origins) {
    const candidates = entry.sitemaps.flatMap((s) => s.candidates);
    assert.ok(candidates.length <= MAX_CANDIDATES_PER_ORIGIN, `${entry.origin} holds ${candidates.length} candidates`);
    for (const url of candidates) assert.ok(isCandidate(url, entry.origin), `${url} is not a candidate of ${entry.origin}`);
    for (const sitemap of entry.sitemaps) {
      assert.ok(sitemap.sha256 !== null || sitemap.candidates.length === 0, `${sitemap.url}: candidates without a body hash`);
    }
  }
});

test("the pool covers exactly the eligible publishers", () => {
  assert.deepEqual(pool.origins.map((o) => o.origin).sort(), eligibleOrigins(REAL_PAGES).sort());
});

test("a replayed probe that is missing from the record fails, and never reaches the network", async () => {
  await assert.rejects(replayProber(probes)("https://example.invalid/never-probed"), /no recorded probe/);
});

test("CONTROL: a different seed draws a different list", async () => {
  const other = await selectBatchTwo(pool, accepting, { seed: "not-the-seed", taken });
  const same = await selectBatchTwo(pool, accepting, { seed: BATCH_2_SEED, taken });
  assert.equal(other.length, BATCH_2_SIZE);
  assert.notDeepEqual(other.map((d) => d.url), same.map((d) => d.url));
});

test("CONTROL: a planted duplicate (a corpus url with a trailing slash) is refused before it is probed", async () => {
  const real = REAL_PAGES.find((p) => p.role === "calibration")!;
  const origin = originOf(real.url);
  const planted: Pool = {
    seed: BATCH_2_SEED,
    caps: pool.caps,
    origins: [{
      origin,
      sitemaps: [{
        url: `${origin}/sitemap.xml`, fetchedAt: "", status: 200, sha256: "x",
        candidates: [`${real.url.replace(/\/+$/, "")}/`, `${origin}/a-page-nobody-has`],
      }],
    }],
  };
  const probed: string[] = [];
  const drawn = await selectBatchTwo(planted, async (url) => { probed.push(url); return accepting(url); }, { seed: BATCH_2_SEED, taken });
  assert.deepEqual(drawn.map((d) => d.url), [`${origin}/a-page-nobody-has`]);
  assert.deepEqual(probed, [`${origin}/a-page-nobody-has`]);
});

test("CONTROL: a planted 404 removes that candidate, and the next in hash order takes its place", async () => {
  const first = (await selectBatchTwo(pool, accepting, { seed: BATCH_2_SEED, taken, size: pool.origins.length }))[0];
  const after = await selectBatchTwo(pool, answering(404, first.url), { seed: BATCH_2_SEED, taken, size: pool.origins.length });
  assert.ok(!after.some((d) => d.url === first.url), "the 404 candidate was still drawn");
  const ordered = pool.origins.find((o) => o.origin === first.origin)!.sitemaps
    .flatMap((s) => s.candidates)
    .filter((url) => !taken.has(normaliseUrl(url)))
    .sort((a, b) => (orderKey(BATCH_2_SEED, normaliseUrl(a)) < orderKey(BATCH_2_SEED, normaliseUrl(b)) ? -1 : 1));
  assert.equal(ordered[0], first.url);
  assert.equal(after.find((d) => d.origin === first.origin)?.url, ordered[1]);
});

test("CONTROL: the draw stops at the size asked for and never widens itself to make up a shortfall", async () => {
  const tiny: Pool = {
    seed: BATCH_2_SEED, caps: pool.caps,
    origins: [{ origin: "https://a.example", sitemaps: [{
      url: "https://a.example/sitemap.xml", fetchedAt: "", status: 200, sha256: "x",
      candidates: ["https://a.example/1", "https://a.example/2"],
    }] }],
  };
  assert.equal((await selectBatchTwo(tiny, accepting, { seed: BATCH_2_SEED, taken: new Set(), size: 5 })).length, 2);
  assert.equal((await selectBatchTwo(tiny, accepting, { seed: BATCH_2_SEED, taken: new Set(), size: 1 })).length, 1);
});

test("CONTROL: the draw visits every publisher before it visits one twice", async () => {
  const withCandidates = pool.origins.filter((o) => o.sitemaps.some((s) => s.candidates.length > 0));
  assert.ok(withCandidates.length > 1 && withCandidates.length < BATCH_2_SIZE);
  const drawn = await selectBatchTwo(pool, accepting, { seed: BATCH_2_SEED, taken, size: withCandidates.length });
  assert.equal(drawn.length, withCandidates.length);
  assert.equal(new Set(drawn.map((d) => d.origin)).size, drawn.length);
});

// --- Count and marking -------------------------------------------------------------------------------

test("there are at least 120 new addresses, each marked batch 2, conformant, sourced and drawn", () => {
  assert.ok(BATCH_2_PAGES.length >= BATCH_2_SIZE, `only ${BATCH_2_PAGES.length} batch-2 pages`);
  for (const page of BATCH_2_PAGES) {
    assert.equal(page.batch, 2, page.url);
    assert.equal(page.publishedClaim, "conformant", page.url);
    assert.ok(page.source.length > 0, `${page.url} has no source`);
    assert.ok(page.drawnFrom.length > 0, `${page.url} has no drawnFrom`);
    assert.ok(!("role" in page), `${page.url} carries a role; roles are assigned after A11-166's freeze`);
  }
});

test("every address came from the sitemap it names, in the committed pool", () => {
  for (const page of BATCH_2_PAGES) {
    const sitemap = pool.origins.flatMap((o) => o.sitemaps).find((s) => s.url === page.drawnFrom);
    assert.ok(sitemap?.candidates.includes(page.url), `${page.url} is not a candidate of ${page.drawnFrom}`);
  }
});

// --- No duplicates -----------------------------------------------------------------------------------

test("no batch-2 address repeats within the batch, the corpus, a moved-from address or an eval TEST fixture", () => {
  const seen = new Set<string>();
  for (const page of BATCH_2_PAGES) {
    const key = normaliseUrl(page.url);
    assert.ok(!seen.has(key), `${page.url} appears twice in batch 2`);
    seen.add(key);
    assert.ok(!taken.has(key), `${page.url} is already a corpus entry, a moved-from address or an eval TEST fixture`);
    assert.equal(supersededBy(page.url), undefined, `${page.url} is a moved-from address`);
  }
});

test("CONTROL: the taken set really holds corpus urls, moved-from urls and fixtures", () => {
  assert.ok(taken.has(normaliseUrl(REAL_PAGES[0].url)));
  const moved = REAL_PAGES.find((p) => (p.movedFrom ?? []).length > 0);
  if (moved) assert.ok(taken.has(normaliseUrl(moved.movedFrom![0].url)));
  assert.ok(taken.has(normaliseUrl(testUrls[0])));
});

// --- The rule ----------------------------------------------------------------------------------------

test("every batch-2 address is on an eligible publisher, and carries exactly that publisher's label", () => {
  const eligible = eligibleOrigins(REAL_PAGES);
  const scored = new Set<string>(SCORED_CRITERIA);
  for (const page of BATCH_2_PAGES) {
    const origin = originOf(page.url);
    assert.ok(eligible.includes(origin), `${page.url}: ${origin} is not an eligible publisher`);
    const label = batchTwoLabel(origin, REAL_PAGES);
    assert.equal(page.source, label.source, page.url);
    assert.deepEqual(page.claimExcludes, label.claimExcludes, page.url);
    for (const criterion of page.claimExcludes ?? []) {
      assert.ok(scored.has(criterion.split(":")[0]), `${page.url}: ${criterion} names no SCORED_CRITERIA criterion`);
    }
  }
});

test("eligible publishers are the conformant origins the corpus cites in calibration or training", () => {
  const eligible = eligibleOrigins(REAL_PAGES);
  assert.ok(eligible.length > 0);
  for (const origin of eligible) {
    const own = REAL_PAGES.filter((p) => !p.url.startsWith("http://localhost") && originOf(p.url) === origin);
    assert.ok(own.every((p) => p.publishedClaim === "conformant"), `${origin} carries a page that is not conformant`);
    assert.ok(own.some((p) => p.role === "calibration" || p.role === "training"), `${origin} is in neither role`);
  }
});

test("CONTROL: the origins the rule excludes are excluded -- inaccessible, field and fixture", () => {
  const eligible = eligibleOrigins(REAL_PAGES);
  assert.ok(!eligible.includes("https://www.w3.org"), "w3.org carries the inaccessible BAD pages");
  assert.ok(!eligible.includes("https://the-internet.herokuapp.com"));
  for (const page of pagesFor("field")) assert.ok(!eligible.includes(originOf(page.url)), page.url);
  for (const page of pagesFor("fixture")) assert.ok(!eligible.includes(originOf(page.url)), page.url);
  assert.throws(() => batchTwoLabel("https://www.w3.org", REAL_PAGES), /not an eligible publisher/);
});

test("CONTROL: a publisher whose entries carry different masks is labelled with their union", () => {
  const pages = [
    { url: "https://x.example/a", role: "calibration", publishedClaim: "conformant", source: "first", claimExcludes: ["4.1.2"] },
    { url: "https://x.example/b", role: "training", publishedClaim: "conformant", source: "second", claimExcludes: ["1.3.1", "4.1.2"] },
    { url: "https://x.example/c", role: "training", publishedClaim: "conformant", source: "third" },
  ];
  assert.deepEqual(batchTwoLabel("https://x.example", pages),
    { publishedClaim: "conformant", source: "first", claimExcludes: ["1.3.1", "4.1.2"] });
  assert.deepEqual(batchTwoLabel("https://x.example", [pages[2]]),
    { publishedClaim: "conformant", source: "third" });
});

test("CONTROL: one real publisher with differing masks (www.nhs.uk) carries the union in batch 2", () => {
  const masks = REAL_PAGES.filter((p) => p.url.startsWith("https://www.nhs.uk/")).map((p) => p.claimExcludes ?? []);
  assert.ok(new Set(masks.map((m) => m.join())).size > 1, "expected differing masks on www.nhs.uk");
  const union = [...new Set(masks.flat())].sort();
  assert.deepEqual(batchTwoLabel("https://www.nhs.uk", REAL_PAGES).claimExcludes, union);
});

// --- Sealed ------------------------------------------------------------------------------------------

test("batch 2 is sealed: no reader of REAL_PAGES, realPageFor or pagesFor can reach a batch-2 address", () => {
  const roles = ["calibration", "training", "fixture", "field"] as const;
  for (const page of BATCH_2_PAGES) {
    assert.ok(!REAL_PAGES.some((p) => normaliseUrl(p.url) === normaliseUrl(page.url)), `${page.url} is in REAL_PAGES`);
    assert.equal(realPageFor(page.url), undefined, `${page.url} resolves through realPageFor`);
    for (const role of roles) {
      assert.ok(!pagesFor(role).some((p) => normaliseUrl(p.url) === normaliseUrl(page.url)), `${page.url} is in pagesFor(${role})`);
    }
  }
  assert.ok(REAL_PAGES.every((p) => !("batch" in p)), "a REAL_PAGES entry carries a batch marker");
});

test("CONTROL: the sealed check can see a page that is reachable", () => {
  const real = REAL_PAGES[0];
  assert.equal(realPageFor(real.url), real);
  assert.ok(pagesFor(real.role).includes(real));
});

// --- The pure parts ----------------------------------------------------------------------------------

test("robots.txt Sitemap lines are read in order, whatever the case", () => {
  assert.deepEqual(sitemapsFromRobots("User-agent: *\nSitemap: https://a.example/one.xml\nsitemap:https://a.example/two.xml\n"),
    ["https://a.example/one.xml", "https://a.example/two.xml"]);
  assert.deepEqual(sitemapsFromRobots("User-agent: *\nDisallow: /"), []);
});

test("a sitemap is told from an index, and its locs are read in order, unescaped", () => {
  const urlset = "<urlset><url><loc>https://a.example/x?a=1&amp;b=2</loc></url><url><loc> https://a.example/y </loc></url></urlset>";
  assert.deepEqual(parseSitemap(urlset), { index: false, locs: ["https://a.example/x?a=1&b=2", "https://a.example/y"] });
  const index = "<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>";
  assert.deepEqual(parseSitemap(index), { index: true, locs: ["https://a.example/s1.xml"] });
});

test("a candidate is on the same origin, has no fragment, and is not a document", () => {
  const origin = "https://a.example";
  assert.ok(isCandidate("https://a.example/page", origin));
  assert.ok(isCandidate("https://a.example/page.html", origin));
  assert.ok(isCandidate("https://a.example/", origin));
  assert.ok(!isCandidate("https://b.example/page", origin));
  assert.ok(!isCandidate("http://a.example/page", origin));
  assert.ok(!isCandidate("https://a.example/page#top", origin));
  for (const name of ["a.pdf", "a.DOCX", "a.csv", "a.xml", "a.json", "a.png", "a.zip"]) {
    assert.ok(!isCandidate(`https://a.example/${name}`, origin), name);
  }
  assert.ok(!isCandidate("not a url", origin));
});

test("the candidate cap keeps the first in document order", () => {
  const locs = ["https://a.example/1", "https://a.example/x.pdf", "https://a.example/2", "https://a.example/3"];
  assert.deepEqual(candidatesFrom(locs, "https://a.example", 2), ["https://a.example/1", "https://a.example/2"]);
  assert.deepEqual(candidatesFrom(locs, "https://a.example", 0), []);
});

test("a probe is accepted on 200, HTML, and the same origin and path -- and on nothing less", () => {
  const url = "https://a.example/page";
  const ok = { url, status: 200, contentType: "text/html; charset=utf-8", final: "https://a.example/page/", at: "" };
  assert.ok(probeAccepts(ok, url));
  assert.ok(!probeAccepts({ ...ok, status: 404 }, url));
  assert.ok(!probeAccepts({ ...ok, status: 301 }, url));
  assert.ok(!probeAccepts({ ...ok, contentType: "application/pdf" }, url));
  assert.ok(!probeAccepts({ ...ok, contentType: null }, url));
  assert.ok(!probeAccepts({ ...ok, final: "https://a.example/elsewhere" }, url));
  assert.ok(!probeAccepts({ ...ok, final: "https://b.example/page" }, url));
  assert.ok(!probeAccepts({ ...ok, final: null, error: "timeout" }, url));
  assert.ok(addressesSamePage("https://a.example/p.html", "https://a.example/p"));
});

test("every recorded probe is for an address the pool holds, and every drawn address has an accepting probe", () => {
  const candidates = new Set(pool.origins.flatMap((o) => o.sitemaps.flatMap((s) => s.candidates)).map(normaliseUrl));
  for (const probe of probes) assert.ok(candidates.has(normaliseUrl(probe.url)), `${probe.url} is not in the pool`);
  const byUrl = new Map(probes.map((p) => [normaliseUrl(p.url), p]));
  for (const page of BATCH_2_PAGES) {
    const probe = byUrl.get(normaliseUrl(page.url));
    assert.ok(probe && probeAccepts(probe, page.url), `${page.url} has no accepting probe on record`);
  }
});
