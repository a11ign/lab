/**
 * Batch 2 of the real-page corpus (A11-170): the procedure that draws it, as pure functions.
 *
 * ## Why a second batch exists
 *
 * The announcement emulator's final Gate (A11-166) is measured on pages whose fleet transcripts were never
 * read while the emulator was being fixed. Every page of the first batch has been read, so none is held out
 * any more. Batch 2 is drawn by the corpus's own selection rule (ADR 0010: every page comes from a publisher
 * that publishes its own conformance claim, so the label is never our judgement) and by a procedure fixed
 * BEFORE any page was looked at, so that a pass on it means what the Gate says.
 *
 * ## The procedure, in the order it runs
 *
 *   1. ELIGIBLE PUBLISHERS (`eligibleOrigins`): an origin the corpus already cites in `calibration` or
 *      `training`, where every page on it is `publishedClaim: "conformant"`. Their statements have been read
 *      and mapped onto `SCORED_CRITERIA` already, so batch 2 invents no label. A site-level statement never
 *      licenses a page-level `inaccessible` label (the corpus's own "SEARCHED FOR MORE" note), so an origin
 *      carrying one is out.
 *   2. THE POOL (`scripts/build-real-page-batch.ts`, the only step that touches the network): each eligible
 *      origin's own sitemaps, snapshotted once into `real-page-batch-2/pool.json` with a sha256 per body.
 *      Sitemaps drift; the committed snapshot is what makes the draw reproducible.
 *   3. THE DRAW (`selectBatchTwo`): seeded, round-robin over publishers so no publisher's sitemap size can
 *      dominate. A candidate is accepted on a recorded plain-HTTP probe, never on a fleet capture.
 *   4. THE LABEL (`batchTwoLabel`): inherited from the origin's existing entries, the mask as their UNION --
 *      the corpus's "Mask at SITE level, conservatively ... the cheap direction to be wrong in".
 *
 * The caps and the seed are constants HERE, fixed in the plan before any fetch, so nobody can tune them after
 * seeing a result. If fewer than `BATCH_2_SIZE` addresses come out, the build stops and says so: changing the
 * seed, a cap or the eligible set to get more would be choosing the sample after seeing it.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isFixture, normaliseUrl } from "./real-page-corpus.mjs";

/** The string every ordering in the draw is hashed with. Never changed to get a different sample. */
export const BATCH_2_SEED = "A11-170";
/** The ticket's number: at least 120 new addresses. The draw takes exactly this many. */
export const BATCH_2_SIZE = 120;
/** A sitemap index is followed to at most this many child sitemaps, in document order. */
export const MAX_CHILD_SITEMAPS = 5;
/** The first this-many candidates in document order, per origin, make up its pool. */
export const MAX_CANDIDATES_PER_ORIGIN = 300;
/** A document is not a page: a candidate with one of these extensions is not collected. */
export const DOCUMENT_EXTENSIONS = Object.freeze([
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "odt", "ods", "ppt", "pptx", "zip", "xml", "json", "rss",
  "jpg", "jpeg", "png", "gif", "svg", "webp",
]);

/** The fields of a corpus entry the batch reads. `REAL_PAGES` entries satisfy it. */
export interface LabelledPage {
  url: string;
  role?: string;
  publishedClaim?: string;
  source: string;
  claimExcludes?: readonly string[];
}

/** What a batch-2 entry carries. No `role`: roles are assigned, if ever, after A11-166's freeze. */
export interface BatchTwoLabel {
  publishedClaim: "conformant";
  source: string;
  claimExcludes?: string[];
}

/** One sitemap fetched for an origin, with the candidates it yielded (after the origin's cap). */
export interface PoolSitemap {
  url: string;
  fetchedAt: string;
  status: number | null;
  sha256: string | null;
  candidates: string[];
}

/** An origin's pool: what was fetched, or why there is nothing. */
export interface PoolOrigin {
  origin: string;
  sitemaps: PoolSitemap[];
  /** Why the pool is empty or short (no sitemap, a fetch error), when it is. */
  note?: string;
}

export interface Pool {
  seed: string;
  caps: { childSitemaps: number; candidatesPerOrigin: number };
  origins: PoolOrigin[];
}

/** The outcome of one plain GET of a candidate. */
export interface Probe {
  url: string;
  status: number | null;
  contentType: string | null;
  final: string | null;
  at: string;
  error?: string;
}

export type Prober = (url: string) => Promise<Probe>;

export interface Drawn {
  url: string;
  origin: string;
  drawnFrom: string;
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The origin (scheme + host) of a page address. */
export const originOf = (url: string): string => new URL(url).origin;

/**
 * The origins batch 2 may draw from: an origin of a `calibration` or `training` entry where EVERY entry on
 * that origin is `conformant`. `field` pages make no claim and our own fixtures are ours; an origin carrying
 * an `inaccessible` page is excluded whole, because a site-level statement never licenses a page-level
 * `inaccessible` label.
 */
export function eligibleOrigins(pages: readonly LabelledPage[]): string[] {
  const byOrigin = new Map<string, LabelledPage[]>();
  for (const page of pages) {
    if (isFixture(page)) continue;
    const origin = originOf(page.url);
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), page]);
  }
  return [...byOrigin]
    .filter(([, group]) => group.some((p) => p.role === "calibration" || p.role === "training"))
    .filter(([, group]) => group.every((p) => p.publishedClaim === "conformant"))
    .map(([origin]) => origin);
}

/**
 * The label a batch-2 page inherits from its origin's entries: `conformant`; the UNION of their
 * `claimExcludes` (sorted, so the label does not depend on file order); and the `source` of the FIRST entry,
 * in file order. Throws for an origin that is not eligible, so a wrong call cannot yield a label.
 */
export function batchTwoLabel(origin: string, pages: readonly LabelledPage[]): BatchTwoLabel {
  if (!eligibleOrigins(pages).includes(origin)) throw new Error(`${origin} is not an eligible publisher`);
  const own = pages.filter((p) => !isFixture(p) && originOf(p.url) === origin);
  const excludes = [...new Set(own.flatMap((p) => p.claimExcludes ?? []))].sort();
  return {
    publishedClaim: "conformant",
    source: own[0].source,
    ...(excludes.length > 0 ? { claimExcludes: excludes } : {}),
  };
}

/** The `Sitemap:` addresses a robots.txt declares, in order. */
export function sitemapsFromRobots(robots: string): string[] {
  return [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
}

/** The `<loc>` addresses of a sitemap or a sitemap index, in document order, and which of the two it is. */
export function parseSitemap(xml: string): { index: boolean; locs: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi)]
    .map((m) => m[1].replace(/&amp;/g, "&"));
  return { index: /<sitemapindex[\s>]/i.test(xml), locs };
}

/** Whether a sitemap address can be a candidate page of `origin`. */
export function isCandidate(url: string, origin: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  if (parsed.origin !== origin || parsed.hash !== "" || url.includes("#")) return false;
  const extension = /\.([a-z0-9]+)$/i.exec(parsed.pathname)?.[1]?.toLowerCase();
  return extension === undefined || !DOCUMENT_EXTENSIONS.includes(extension);
}

/** The candidates of one sitemap's `<loc>` list, in document order, at most `room` of them. */
export function candidatesFrom(locs: readonly string[], origin: string, room: number): string[] {
  return locs.filter((loc) => isCandidate(loc, origin)).slice(0, Math.max(0, room));
}

/**
 * The same comparison the capture guard and `audit-corpus-urls.ts` make: origin and path, where a trailing
 * slash, `.html` and `/index` are things a server adds or drops while serving exactly what was asked for.
 */
export function addressesSamePage(actual: string, requested: string): boolean {
  if (!URL.canParse(actual) || !URL.canParse(requested)) return false;
  const got = new URL(actual);
  const want = new URL(requested);
  const path = (p: string) => p.replace(/\/$/, "").replace(/\.html?$/i, "").replace(/\/index$/i, "");
  return got.origin === want.origin && path(got.pathname) === path(want.pathname);
}

/** A probe that says the page is there: 200, HTML, and the address it landed on is the one asked for. */
export function probeAccepts(probe: Probe, requested: string): boolean {
  return probe.status === 200
    && /^text\/html\b/i.test(probe.contentType ?? "")
    && probe.final !== null
    && addressesSamePage(probe.final, requested);
}

/** Every `url` recorded in an eval fixture: the TEST set, derived from the directory rather than copied. */
export function evalFixtureUrls(root: string): string[] {
  const urls: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".json")) {
        try {
          const url = (JSON.parse(readFileSync(path, "utf8")) as { url?: unknown }).url;
          if (typeof url === "string") urls.push(url);
        } catch { /* a fixture that is not a capture is not a test page */ }
      }
    }
  };
  walk(root);
  return urls;
}

/**
 * The addresses batch 2 must not repeat: every corpus entry, every address one moved from, and the eval
 * TEST fixtures. Normalised, because `…/labels` and `…/labels/` are the same page.
 */
export function takenAddresses(
  pages: readonly { url: string; movedFrom?: readonly { url: string }[] }[],
  testUrls: readonly string[],
): Set<string> {
  return new Set([
    ...pages.flatMap((p) => [p.url, ...(p.movedFrom ?? []).map((m) => m.url)]),
    ...testUrls,
  ].map(normaliseUrl));
}

/** `sha256(seed + "\n" + key)`, the ordering key of the draw. */
export const orderKey = (seed: string, key: string): string => sha256(`${seed}\n${key}`);

const byKey = <T>(key: (item: T) => string) => (a: T, b: T) => {
  const [x, y] = [key(a), key(b)];
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * THE DRAW. Pure over its inputs: the live build passes a prober that records each probe; the test passes the
 * committed `probes.json`, and a probe missing from it throws rather than falling back to the network.
 *
 *   - Each origin's candidates are ordered by `sha256(seed + "\n" + normaliseUrl(url))`; the origins by
 *     `sha256(seed + "\n" + origin)`.
 *   - Each round visits the origins in order and takes, from each, the first candidate that is ACCEPTED. An
 *     origin with none left is skipped. The draw stops at `size`.
 *   - Accepted: not in `taken`, not already drawn or already tried (refused BEFORE any probe is made), and
 *     the probe accepts it (`probeAccepts`).
 *
 * Returns fewer than `size` when the pools run out; it never widens itself to make up the number.
 */
export async function selectBatchTwo(
  pool: Pool,
  probe: Prober,
  seed: string,
  taken: ReadonlySet<string>,
  size: number = BATCH_2_SIZE,
): Promise<Drawn[]> {
  const queues = orderedQueues(pool, seed);
  const tried = new Set<string>();
  const drawn: Drawn[] = [];
  let progressed = true;
  while (drawn.length < size && progressed) {
    progressed = false;
    for (const entry of queues) {
      if (drawn.length >= size) break;
      const page = await firstAccepted(entry, probe, taken, tried);
      if (page) {
        drawn.push(page);
        progressed = true;
      }
    }
  }
  return drawn;
}

interface OriginQueue {
  origin: string;
  queue: { url: string; drawnFrom: string }[];
}

/** The origins in `sha256(seed + "\n" + origin)` order, each with its candidates in hash order. */
function orderedQueues(pool: Pool, seed: string): OriginQueue[] {
  return [...pool.origins].sort(byKey((o) => orderKey(seed, o.origin))).map((entry) => ({
    origin: entry.origin,
    queue: entry.sitemaps
      .flatMap((s) => s.candidates.map((url) => ({ url, drawnFrom: s.url })))
      .sort(byKey((c) => orderKey(seed, normaliseUrl(c.url)))),
  }));
}

/**
 * Walks one origin's queue to the first candidate that is accepted, consuming what it passes. A candidate
 * already taken or already tried is skipped BEFORE any probe is made.
 */
async function firstAccepted(
  entry: OriginQueue,
  probe: Prober,
  taken: ReadonlySet<string>,
  tried: Set<string>,
): Promise<Drawn | undefined> {
  while (entry.queue.length > 0) {
    const candidate = entry.queue.shift()!;
    const key = normaliseUrl(candidate.url);
    if (taken.has(key) || tried.has(key)) continue;
    tried.add(key);
    if (probeAccepts(await probe(candidate.url), candidate.url)) {
      return { url: candidate.url, origin: entry.origin, drawnFrom: candidate.drawnFrom };
    }
  }
  return undefined;
}

/** A prober that replays a recorded `probes.json`; an address with no record throws. */
export function replayProber(recorded: readonly Probe[]): Prober {
  const byUrl = new Map(recorded.map((p) => [normaliseUrl(p.url), p]));
  return async (url) => {
    const found = byUrl.get(normaliseUrl(url));
    if (!found) throw new Error(`no recorded probe for ${url}: the replay never falls back to the network`);
    return found;
  };
}
