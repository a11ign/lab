// @ts-check
// command: run axe-core over the corpus's CONFORMANT CALIBRATION pages (#1614's population, 46 pages),
// writing one JSON per run. Refuses if `install-axe-browser`'s browser is not on disk (#1626).
//
// Usage:
//   npm run lab:job -- -e job=axe-calibration       # the real run, on the lab, after install-axe-browser
//   node packages/lab/scripts/axe-calibration.mjs --dry-run   # prints the selected pages, launches nothing
//
// No sanctioned route existed for this before #1626: the lab-job catalogue had no browser and no job
// for axe over a URL list (the CLI's own axe scan takes exactly one URL). See #1626 for the full
// derivation -- npm packages (`@axe-core/playwright`, `playwright`) were already present; the browser and
// its system libraries were not.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pagesFor } from "../src/training/real-page-corpus.mjs";
import { runsRoot, refuseIfRunsReadonly } from "../src/dataset-paths.mjs";

const require = createRequire(import.meta.url);

/** Where `install-axe-browser` puts Chromium -- both jobs' `setenv` in lab-job.yml pin the SAME value, and
 * `lab-job.test.ts` asserts they agree, so this file names it once rather than repeating a literal nobody
 * compares. */
export const PLAYWRIGHT_BROWSERS_PATH = "/opt/a11ign/playwright-browsers";

export const OUT_DIR = resolve(runsRoot(), "axe-calibration");
export const RESULTS_PATH = resolve(OUT_DIR, "results.json");

/** @typedef {{ url: string, role?: string, publishedClaim?: string }} CalibrationCandidate */

/**
 * THE POPULATION, derived from the corpus's OWN `role`/`publishedClaim` fields, never a URL list copied
 * out of them -- #1614 measured 46 conformant calibration pages, and a URL list frozen at that count would
 * silently stop matching the corpus the moment a page is added, renamed or reclassified.
 * `entries` defaults to the real corpus and takes any `CalibrationCandidate[]` so a test can prove the
 * SHAPE of the selection against a small synthetic corpus, without depending on today's real 46.
 * @param {readonly CalibrationCandidate[]} [entries]
 * @returns {CalibrationCandidate[]}
 */
export function conformantCalibrationPages(entries = pagesFor("calibration")) {
  return entries.filter((page) => page.role === "calibration" && page.publishedClaim === "conformant");
}

/**
 * `null` when the browser `install-axe-browser` writes is on disk; the refusal message otherwise. Reads
 * the SAME path Playwright itself will launch (`chromium.executablePath()`), rather than a separate marker
 * file that could go stale independently of whether the binary is actually there.
 * @param {{ chromiumExecutablePath?: () => string, existsSync?: (p: string) => boolean }} [deps]
 * @returns {Promise<string | null>}
 */
export async function installRefusal(deps = {}) {
  const exists = deps.existsSync ?? existsSync;
  const executablePath = deps.chromiumExecutablePath ?? (async () => {
    const { chromium } = await import("playwright");
    return chromium.executablePath();
  });
  const path = await executablePath();
  if (exists(path)) return null;
  return `no browser at ${path} -- run the install-axe-browser lab job first `
    + "(npm run lab:job -- -e job=install-axe-browser), or set PLAYWRIGHT_BROWSERS_PATH to where it was "
    + "installed.";
}

const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * axe tags include e.g. "wcag143" for SC 1.4.3 -- extract criterion numbers.
 *
 * A short, deliberate duplicate of `packages/cli/src/scan/axe.ts`'s own `criteriaFromTags`: that file's
 * `exports` map does not carry a `./scan/axe` subpath, and #1626's Region does not include
 * `packages/cli` to add one. Seven lines of regex over axe-core's OWN fixed tag format, not a shared
 * decision that could drift the way #1559's `SPOKEN_ADDRESS` could -- there is one way to parse
 * `wcagNNN` into `N.N.N`, and axe-core, not this repo, owns the format.
 * @param {readonly string[]} tags
 * @returns {string[]}
 */
function criteriaFromTags(tags) {
  const out = [];
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return out;
}

/**
 * @param {readonly { id?: unknown, tags?: unknown }[]} violations
 * @returns {{ violatedCriteria: string[], ruleIds: string[] }}
 */
function violatedCriteriaAndRules(violations) {
  const criteria = new Set();
  /** @type {string[]} */
  const ruleIds = [];
  for (const rule of violations) {
    const id = typeof rule.id === "string" ? rule.id : "";
    if (id && !ruleIds.includes(id)) ruleIds.push(id);
    for (const c of criteriaFromTags(Array.isArray(rule.tags) ? rule.tags.map(String) : [])) criteria.add(c);
  }
  return { violatedCriteria: [...criteria].sort(), ruleIds };
}

/** The installed axe-core's own version -- resolved by Node, not read off a path this file guesses at. */
export function axeVersion() {
  return require("axe-core/package.json").version;
}

/**
 * Launches ONE Chromium for the whole run (not one per page -- 46 launches would dwarf the scan time) from
 * wherever `install-axe-browser` put it, and hands back `scanOne` plus the version that answered. The
 * default a real run uses; a test supplies a fake one, the same injection seam
 * `packages/cli/src/scan/axe.ts`'s `axeAvailable` uses for the identical reason (neither a missing browser
 * nor a fake one can be produced from CI without uninstalling a real dependency).
 * @returns {Promise<{ browserVersion: string, scanOne: (url: string) => Promise<{ violations: unknown[] }>, close: () => Promise<void> }>}
 */
async function defaultLaunch() {
  const [{ chromium }, { AxeBuilder }] = await Promise.all([import("playwright"), import("@axe-core/playwright")]);
  const browser = await chromium.launch();
  return {
    browserVersion: browser.version(),
    scanOne: async (url) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "load" });
        return await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
      } finally {
        await context.close();
      }
    },
    close: () => browser.close(),
  };
}

/**
 * @typedef {{ url: string, axeVersion: string, browserVersion: string, runTimeMs: number, failed: false,
 *             violatedCriteria: string[], ruleIds: string[] }
 *           | { url: string, axeVersion: string, browserVersion: string, runTimeMs: number, failed: true,
 *               error: string }} ScanRecord
 */

/**
 * Scans every page, ONE BROWSER for the whole run. A page's own failure (navigation error, axe throwing)
 * is recorded IN THE OUTPUT as `failed: true` and the run continues -- #1626's done-when is explicit that
 * this must be a recorded failure, never a silently skipped page, because a skip and a clean pass both
 * read as "nothing wrong" to anyone summarising the file.
 * @param {readonly CalibrationCandidate[]} pages
 * @param {{ launch?: () => ReturnType<typeof defaultLaunch>, now?: () => number, axeVersion?: () => string }} [deps]
 * @returns {Promise<ScanRecord[]>}
 */
export async function scanCalibrationPages(pages, deps = {}) {
  const launch = deps.launch ?? defaultLaunch;
  const now = deps.now ?? (() => Date.now());
  const version = (deps.axeVersion ?? axeVersion)();
  const { browserVersion, scanOne, close } = await launch();
  /** @type {ScanRecord[]} */
  const results = [];
  try {
    for (const page of pages) {
      const startedAt = now();
      const base = { url: page.url, axeVersion: version, browserVersion, runTimeMs: 0 };
      try {
        const raw = await scanOne(page.url);
        const { violatedCriteria, ruleIds } = violatedCriteriaAndRules(
          /** @type {{ id?: unknown, tags?: unknown }[]} */ (raw.violations ?? []));
        results.push({ ...base, runTimeMs: now() - startedAt, failed: false, violatedCriteria, ruleIds });
      } catch (error) {
        results.push({ ...base, runTimeMs: now() - startedAt, failed: true,
          error: String(/** @type {Error} */ (error)?.message ?? error) });
      }
    }
  } finally {
    await close();
  }
  return results;
}

/** @param {readonly CalibrationCandidate[]} pages */
function printDryRun(pages) {
  process.stdout.write(`Would scan ${pages.length} conformant calibration page(s), no browser launched:\n`);
  for (const page of pages) process.stdout.write(`  ${page.url}\n`);
}

async function main() {
  const refusal = await installRefusal();
  if (refusal) {
    process.stderr.write(`${refusal}\n`);
    process.exitCode = 2;
    return;
  }
  const pages = conformantCalibrationPages();
  if (process.argv.includes("--dry-run")) {
    printDryRun(pages);
    return;
  }
  refuseIfRunsReadonly(RESULTS_PATH);
  const results = await scanCalibrationPages(pages);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify({ ranAt: new Date().toISOString(), pages: results }, null, 2));
  const failed = results.filter((r) => r.failed).length;
  process.stdout.write(`\n  axe-calibration: ${results.length} page(s), ${failed} failed. Wrote ${RESULTS_PATH}\n`);
  if (failed) process.exitCode = 1;
}

/**
 * Run ONLY when this file is the program, never when it is imported -- so a test can reach the functions
 * above without launching a browser. See `entry-points.test.ts`'s sibling check on the CLI's own scripts.
 */
const isProgram = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isProgram) main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
