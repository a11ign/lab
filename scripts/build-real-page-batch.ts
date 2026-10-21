/**
 * Build batch 2 of the real-page corpus (A11-170). The ONLY step of the procedure that touches the network,
 * and it touches no fleet machine: plain HTTP GETs of public pages, throttled per host.
 *
 *   node scripts/build-real-page-batch.ts            fetch each eligible publisher's sitemaps, probe the
 *                                                    draw, write `src/training/real-page-batch-2/pool.json`
 *                                                    and `probes.json`, and print the `BATCH_2_PAGES` entries
 *   node scripts/build-real-page-batch.ts --print    print the entries again from the committed pool and
 *                                                    probes, offline (what a reader runs to reproduce the list)
 *
 * What it will not do is retune. The seed, the caps, the extension list and the eligible set are constants in
 * `src/training/real-page-batch.ts`, fixed before the first fetch. If fewer than `BATCH_2_SIZE` addresses come
 * out it writes what it recorded, says so and exits 1: choosing a different seed or wider caps to reach the
 * number would be choosing the sample after seeing it.
 *
 * It never reads a fleet transcript. A11-170 forbids that before A11-166 commits its freeze.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { refuseUnknownFlags } from "./refuse-unknown-flags.ts";
import { createHostThrottle, hostOf } from "../src/training/host-throttle.mjs";
import { REAL_PAGES } from "../src/training/real-page-corpus.mjs";
import {
  BATCH_2_SEED, BATCH_2_SIZE, MAX_CANDIDATES_PER_ORIGIN, MAX_CHILD_SITEMAPS,
  batchTwoLabel, candidatesFrom, eligibleOrigins, evalFixtureUrls, parseSitemap, replayProber, selectBatchTwo,
  sha256, sitemapsFromRobots, takenAddresses,
  type Drawn, type Pool, type PoolOrigin, type PoolSitemap, type Probe, type Prober,
} from "../src/training/real-page-batch.ts";

refuseUnknownFlags(["--print"], { entry: import.meta.url, command: "node scripts/build-real-page-batch.ts" });

const LAB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BATCH_DIR = join(LAB_ROOT, "src", "training", "real-page-batch-2");
const POOL_FILE = join(BATCH_DIR, "pool.json");
const PROBES_FILE = join(BATCH_DIR, "probes.json");

/** The gap and the timeout `audit-corpus-urls.ts` uses: never two requests to one host inside this window. */
const POLITE_GAP_MS = 2_000;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) a11ign/corpus-urls";

const waitTurn = createHostThrottle({ minGapMs: POLITE_GAP_MS });

async function politeGet(url: string): Promise<Response> {
  await waitTurn(hostOf(url));
  return fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": USER_AGENT },
  });
}

/** A fetched sitemap body as text, un-gzipped when the publisher serves `sitemap.xml.gz` as a file. */
async function fetchText(url: string): Promise<{ status: number | null; body: string | null; error?: string }> {
  try {
    const response = await politeGet(url);
    if (response.status !== 200) {
      await response.body?.cancel();
      return { status: response.status, body: null };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
    return { status: response.status, body: (gzipped ? gunzipSync(bytes) : bytes).toString("utf8") };
  } catch (error) {
    return { status: null, body: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** One sitemap, recorded; `room` is how many more candidates the origin's cap leaves. */
async function snapshot(url: string, origin: string, room: number): Promise<{ record: PoolSitemap; children: string[] }> {
  const fetched = await fetchText(url);
  const record: PoolSitemap = {
    url,
    fetchedAt: new Date().toISOString(),
    status: fetched.status,
    sha256: fetched.body === null ? null : sha256(fetched.body),
    candidates: [],
  };
  if (fetched.body === null) return { record, children: [] };
  const { index, locs } = parseSitemap(fetched.body);
  if (index) return { record, children: locs.slice(0, MAX_CHILD_SITEMAPS) };
  record.candidates = candidatesFrom(locs, origin, room);
  return { record, children: [] };
}

/** An origin's pool: its robots.txt `Sitemap:` lines (else `/sitemap.xml`), indexes followed, capped. */
async function poolFor(origin: string): Promise<PoolOrigin> {
  const robots = await fetchText(`${origin}/robots.txt`);
  const declared = robots.body === null ? [] : sitemapsFromRobots(robots.body);
  const roots = declared.length > 0 ? declared : [`${origin}/sitemap.xml`];
  const sitemaps: PoolSitemap[] = [];
  const total = () => sitemaps.reduce((sum, s) => sum + s.candidates.length, 0);
  const room = () => MAX_CANDIDATES_PER_ORIGIN - total();
  for (const root of roots) {
    if (room() <= 0) break;
    const top = await snapshot(root, origin, room());
    sitemaps.push(top.record);
    for (const child of top.children) {
      if (room() <= 0) break;
      sitemaps.push((await snapshot(child, origin, room())).record);
    }
  }
  const note = total() === 0
    ? `no candidates: ${sitemaps.map((s) => `${s.url} -> ${s.status ?? "no response"}`).join("; ")}`
    : undefined;
  return { origin, sitemaps, ...(note ? { note } : {}) };
}

/** A plain GET of a candidate, recorded. Never a fleet capture. */
function liveProber(record: Probe[]): Prober {
  return async (url) => {
    const probe: Probe = { url, status: null, contentType: null, final: null, at: new Date().toISOString() };
    try {
      const response = await politeGet(url);
      probe.status = response.status;
      probe.contentType = response.headers.get("content-type");
      probe.final = response.url;
      await response.body?.cancel();
    } catch (error) {
      probe.error = error instanceof Error ? error.message : String(error);
    }
    record.push(probe);
    return probe;
  };
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);

/** The `BATCH_2_PAGES` entries for a draw, as the literal text that goes into `real-page-corpus.mjs`. */
export function printEntries(drawn: readonly Drawn[]): string {
  const lines = drawn.map((page) => {
    const label = batchTwoLabel(page.origin, REAL_PAGES);
    const excludes = label.claimExcludes ? `, claimExcludes: ${JSON.stringify(label.claimExcludes)}` : "";
    return `  { url: ${JSON.stringify(page.url)}, batch: 2, publishedClaim: "conformant", `
      + `source: ${JSON.stringify(label.source)}${excludes}, drawnFrom: ${JSON.stringify(page.drawnFrom)} },`;
  });
  return lines.join("\n");
}

function takenByTheCorpus(): Set<string> {
  return takenAddresses(REAL_PAGES, evalFixtureUrls(join(LAB_ROOT, "src", "eval", "fixtures")));
}

/** Offline: the entries again, from the committed pool and probes. */
async function printCommitted() {
  const drawn = await selectBatchTwo(
    readJson<Pool>(POOL_FILE), replayProber(readJson<Probe[]>(PROBES_FILE)), BATCH_2_SEED, takenByTheCorpus(),
  );
  process.stdout.write(`${printEntries(drawn)}\n`);
}

/** Online: snapshot every eligible publisher's sitemaps, probe the draw, record both, print the entries. */
async function buildFresh() {
  const origins = eligibleOrigins(REAL_PAGES);
  process.stderr.write(`${origins.length} eligible publishers; seed ${BATCH_2_SEED}; politely, ${POLITE_GAP_MS} ms per host\n`);
  const pool: Pool = {
    seed: BATCH_2_SEED,
    caps: { childSitemaps: MAX_CHILD_SITEMAPS, candidatesPerOrigin: MAX_CANDIDATES_PER_ORIGIN },
    origins: [],
  };
  for (const origin of origins) {
    const entry = await poolFor(origin);
    pool.origins.push(entry);
    const count = entry.sitemaps.reduce((sum, s) => sum + s.candidates.length, 0);
    process.stderr.write(`  ${origin}: ${count} candidate(s)${entry.note ? ` (${entry.note})` : ""}\n`);
  }
  const probes: Probe[] = [];
  const drawn = await selectBatchTwo(pool, liveProber(probes), BATCH_2_SEED, takenByTheCorpus());
  writeJson(POOL_FILE, pool);
  writeJson(PROBES_FILE, probes);
  if (drawn.length < BATCH_2_SIZE) {
    process.stderr.write(`\nSHORTFALL: ${drawn.length} of ${BATCH_2_SIZE} addresses. The pool and probes are written as evidence. `
      + "The seed, caps and eligible set are NOT changed to get more: that would choose the sample after seeing it.\n");
    process.exit(1);
  }
  process.stdout.write(`${printEntries(drawn)}\n`);
}

const main = () => (process.argv.includes("--print") ? printCommitted() : buildFresh());

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
