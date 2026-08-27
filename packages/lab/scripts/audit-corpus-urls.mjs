// @ts-check
/**
 * Does every real-page URL still address the page it was chosen for?
 *
 * These are 92 live public-sector sites and their publishers keep editing them. A page that MOVES is not
 * a broken capture, it is a stale corpus entry — and until 2026-08-26 nothing looked, so it was found at
 * capture time, one page at a time, disguised as a fault.
 *
 * Measured that day: **7 of 50** calibration URLs were redirects the corpus had never been updated for.
 * The capture guard refused each of them correctly — `addressesSamePage` compares origin and path — and
 * the seven failures read as a 14% capture-fault rate, which is what a whole investigation was spent on.
 * One of them, the Met Office warnings page, had moved to a different HOST.
 *
 * ## Why this is a script and not a test
 *
 * It makes 92 network requests to third parties. As a unit test it would be slow, flaky, and would fail
 * in CI for reasons that have nothing to do with the change under review — and a test that fails for the
 * wrong reason gets deleted. Run it deliberately, before a real-page capture, or when a capture starts
 * refusing pages.
 *
 * ## What it will not do
 *
 * It reports and never edits. A redirect has three meanings and only a human can tell them apart: the
 * same page at a new address (update the url), the page gone and the site offering its parent (the entry
 * needs a new `demonstrates`, or retiring), and a consent or region interstitial (neither). Rewriting the
 * corpus automatically would turn the third into a silent corpus change, which is the one thing this
 * corpus exists not to do.
 */
import { REAL_PAGES } from "../src/training/real-page-corpus.mjs";
import { createHostThrottle, hostOf } from "../src/training/host-throttle.mjs";
import { pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * `--json` for a machine, `--timeout=` for a slow host.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--json", "--timeout="], { entry: import.meta.url, command: "npm run corpus:urls" });

/** Same courtesy the capture pays: never two requests to one host inside this window. */
const POLITE_GAP_MS = 2_000;
/** Long enough for a slow government host, short enough that 92 of them finish. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** @param {string} name */
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const TIMEOUT_MS = Number(arg("timeout") ?? DEFAULT_TIMEOUT_MS);
const AS_JSON = process.argv.includes("--json");

/**
 * Where a URL actually lands, following redirects.
 *
 * GET rather than HEAD: several of these hosts answer HEAD with 405 or with a different redirect chain,
 * so HEAD would report a move that a real capture never sees. `redirect: "follow"` gives the final
 * address in `response.url`, which is exactly what the capture's own guard compares against.
 */
/**
 * @param {string} url
 * @returns {Promise<{final: string|null, status: number|null, error?: string}>}
 */
async function landsAt(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      // A default fetch UA gets a different page from some of these sites, which would report a move
      // the capture does not see. This is the closest honest approximation of the capture's browser.
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) a11y-witness/corpus-urls" },
    });
    return { final: response.url, status: response.status };
  } catch (error) {
    return { final: null, status: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Same rule the capture applies, so this cannot report a move the capture would tolerate — or miss one
 * it would refuse. Trailing slashes and `.html` are things a server adds or drops while serving exactly
 * what was asked for.
 */
/**
 * @param {string} actual
 * @param {string} requested
 */
function addressesSamePage(actual, requested) {
  try {
    const got = new URL(actual);
    const want = new URL(requested);
    /** @param {string} path */
    const normalise = (path) => path.replace(/\/$/, "").replace(/\.html?$/i, "").replace(/\/index$/i, "");
    return got.origin === want.origin && normalise(got.pathname) === normalise(want.pathname);
  } catch {
    return false;
  }
}

async function main() {
  const waitTurn = createHostThrottle({ minGapMs: POLITE_GAP_MS });
  const moved = [];
  const unreachable = [];
  let checked = 0;
  let local = 0;

  if (!AS_JSON) {
    process.stdout.write(`Checking ${REAL_PAGES.length} real-page url(s), politely (${POLITE_GAP_MS} ms `
      + `between requests to one host)\n\n`);
  }
  for (const page of REAL_PAGES) {
    // LOCALLY SERVED FIXTURES ARE NOT SUBJECT TO ROT. Four corpus entries are `http://localhost:5050/...`
    // pages this project writes and serves itself, so no publisher can move them — and without the page
    // server up they report UNREACHABLE, which is noise about the machine rather than news about the
    // corpus. Counted so their absence from the report is a fact rather than a silence.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(page.url)) { local += 1; continue; }
    await waitTurn(hostOf(page.url));
    const { final, status, error } = await landsAt(page.url);
    checked += 1;
    if (!final) {
      unreachable.push({ url: page.url, error });
      if (!AS_JSON) process.stdout.write(`  UNREACHABLE  ${page.url}\n               ${error}\n`);
      continue;
    }
    if (addressesSamePage(final, page.url)) continue;
    moved.push({ url: page.url, to: final, status, role: page.role, demonstrates: page.demonstrates });
    if (!AS_JSON) {
      process.stdout.write(`  MOVED  ${page.url.replace(/^https:\/\//, "")}\n`
        + `      -> ${final.replace(/^https:\/\//, "")}  (${status})\n`
        + `         it demonstrates "${page.demonstrates}" — does the new address still?\n`);
    }
  }

  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify({ checked, local, moved, unreachable }, null, 2)}\n`);
  } else {
    process.stdout.write(`\n  ${checked} checked, ${moved.length} moved, ${unreachable.length} `
      + `unreachable, ${local} locally served (not subject to rot)\n`);
    if (moved.length) {
      process.stdout.write("\n  A move is one of three things and only you can tell them apart:\n"
        + "    - the SAME page at a new address — update `url` in real-page-corpus.mjs;\n"
        + "    - the page GONE and the site offering its parent — `demonstrates` changes with it, or the\n"
        + "      entry retires, because the old description now claims evidence the corpus does not hold;\n"
        + "    - a consent or region interstitial — neither, and the capture will hit it too.\n"
        + "  Nothing here edits the corpus: rewriting it automatically would make the third case a silent\n"
        + "  corpus change, which is the one thing this corpus exists not to do.\n");
    }
  }
  // UNREACHABLE does not fail. A third-party host being down says nothing about the corpus, and a check
  // that goes red for somebody else's outage is one people learn to ignore.
  process.exit(moved.length ? 1 : 0);
}

// GUARDED, so importing this file does not fire 92 requests at third-party sites. `entry-points.test.ts`
// caught it: a module that acts on import cannot be read by a test, a doc generator, or anything else
// that merely wants to know what it exports — and here it would also be rude.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
