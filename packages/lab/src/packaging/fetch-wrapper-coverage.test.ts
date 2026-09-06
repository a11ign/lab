/**
 * Every raw `fetch(` anywhere in the tree is accounted for: routed through `requestJson`
 * (`packages/worker-fleet/src/worker-http.mjs`), or named here with a REAL reason it is not.
 *
 * `requestJson` exists because global `fetch` truncates a response silently past undici's ~300 s headers
 * cap (see that file's own header) — a live risk for anything that talks to a capture worker, whose
 * captures run 12–520 s. CLAUDE.md records the cost of a bypassing caller directly: a CLI hang of
 * **10 minutes 20 seconds in silence** because `ECONNREFUSED` was treated as a transient network code and
 * the recovery ran its whole 620 s budget against an address nothing had ever answered — `requestJson`
 * carries the real error CODE a bypassing `fetch` collapses into `TypeError: fetch failed`.
 *
 * `worker-http-client-owner.test.ts` (`packages/worker-fleet/src`) checks the SPECIFIC functions that were
 * converted, by name, inside `worker-fleet` and `lab`. This is the other half: a TREE-WIDE discovery,
 * because "the four originally-cited call sites" turned out not to be the whole story twice already.
 *
 * ## Verified before fixing, not assumed
 *
 * `architecture-audit.md`'s 2026-09-05 23:40 re-check said raw `fetch` was "surviving at all four
 * originally-cited call sites... still open". It was already stale by the time it was written: `d7c1870`
 * (2026-09-06 00:37, less than an hour later) converted three of the four and exempted the fourth with a
 * documented reason. A LATER unit converted five more `worker-fleet` sites the original audit never named.
 * THIS sweep, tree-wide rather than scoped to one package, found exactly one more:
 * `deploy-worker.mjs`'s `healthCode` — the UTM VM deploy path's own `/health` probe, missed by both
 * earlier passes because neither was looking at that file. It is now converted (`CONVERTED` below).
 *
 * ## Why a count, not just a filename
 *
 * `browser-session.mjs` carries two raw `fetch(` calls to the SAME reason (CDP's own endpoints); most
 * other files carry one. A file gaining or losing a raw `fetch(` without this list changing is exactly
 * the drift a filename-only check cannot see — the "list of fields to check, and the one field with a
 * different shape" defect, applied to a count instead of a shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["dist", "node_modules", "__pycache__", "isolation-fixtures", "tsconfig-fixtures"].includes(entry.name)
        ? [] : sourceFiles(full);
    }
    // Test files are excluded: they exercise `fetch` (real or mocked) for reasons that have nothing to do
    // with production traffic to a worker, and including them would mix two different questions.
    if (/\.test\.(ts|mjs)$/.test(entry.name)) return [];
    return /\.(ts|mjs)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Files that USED to bypass `requestJson` and are now fully converted -- `capture-status.mjs`,
 * `capture-check.mjs`, `protocol-guard.mjs`, `compare-workers.mjs`, `check-worker-code.mjs`,
 * `code-drift.mjs` and `deploy-worker.mjs`'s `healthCode` (see `worker-http-client-owner.test.ts`, which
 * checks each by function name) -- carry NO raw `fetch(` at all any more, so none of them need an entry
 * below: a file with zero matches never reaches `found`, and a regression back to raw `fetch` would land
 * it in `found` with no `EXEMPT` entry, which the loop below already fails on. `doctor.mjs` is the one
 * exception worth naming explicitly: it had ONE converted function (`httpJson`) and STILL carries one raw
 * `fetch(` -- the page-server probe, entered below with count 1, which already accounts for it.
 */

/**
 * Every file with a raw `fetch(` call this repo has decided to KEEP, and why — each reason is either a
 * different TARGET (not a capture worker's JSON API at all) or a structural reason (the package dependency
 * graph forbids the import).
 */
const EXEMPT: { file: string; count: number; reason: string }[] = [
  {
    file: "packages/nvda-worker/src/browser-session.mjs", count: 2,
    reason: "talks to the LOCAL Chromium DevTools protocol (CDP's own /json/version and /json/list "
      + "endpoints on 127.0.0.1:9222), not a capture worker's JSON API -- and worker-fleet depends on "
      + "nvda-worker, never the reverse, so this package could not import requestJson even if the target "
      + "matched.",
  },
  {
    file: "packages/worker-fleet/src/doctor.mjs", count: 1,
    reason: "the dataset PAGE SERVER (a titleOf() probe at a fixed local port), not a worker -- the "
      + "worker probe in this same file (httpJson) is the one that was converted; see "
      + "worker-http-client-owner.test.ts.",
  },
  {
    file: "packages/lab/scripts/audit-corpus-urls.mjs", count: 1,
    reason: "92 real third-party government websites, following redirects with a spoofed browser "
      + "user-agent -- the opposite shape from requestJson, which is built around a worker's own JSON "
      + "contract and refuses to guess at a wire format.",
  },
  {
    file: "packages/lab/scripts/evidence-check.mjs", count: 1,
    reason: "the dataset PAGE SERVER's raw HTML, read for a title check -- the same shape as "
      + "capture-screenreader-dataset.mjs's exemption below, independently arrived at.",
  },
  {
    file: "packages/lab/src/training/capture-screenreader-dataset.mjs", count: 1,
    reason: "the dataset PAGE SERVER's raw HTML for a title check, not the worker's JSON API -- documented "
      + "in-file as \"EXEMPT from audit §9\" and pinned by worker-http-client-owner.test.ts.",
  },
  {
    file: "packages/lab/src/training/page-server.mjs", count: 1,
    reason: "the page server probing ITSELF (is something already answering on this port) -- it cannot be "
      + "its own client through a wrapper built for talking to a capture worker.",
  },
  {
    file: "packages/cli/src/scan/page-title.ts", count: 1,
    reason: "the TARGET page a user asked to scan -- an arbitrary external URL the CLI was pointed at, "
      + "never a capture worker.",
  },
  {
    file: "packages/judge/src/judge.ts", count: 1,
    reason: "a rented LLM's chat-completions endpoint (JUDGE_BASE_URL), for the codex/anthropic/openai "
      + "judge backends -- a different external service entirely, not a capture worker.",
  },
];

test("every raw fetch( in the tree is CONVERTED, EXEMPT with a reason, or fails this test", () => {
  const files = [...sourceFiles(join(ROOT, "packages")), ...sourceFiles(join(ROOT, "scripts"))]
    .filter((f) => !f.endsWith("worker-http.mjs")); // requestJson's own implementation calls http.request, not fetch -- excluded for clarity, not because it would match

  // VACUITY GUARD. A walk or a regex that stopped finding anything would pass having examined nothing,
  // which is exactly how this repo's checks have come to vouch for trees they never read.
  assert.ok(files.length > 60, `the walk only found ${files.length} source files; it is broken, not the tree clean`);

  const found = new Map<string, number>();
  for (const file of files) {
    const matches = readFileSync(file, "utf8").match(/\bfetch\(/g);
    if (matches) found.set(relative(ROOT, file), matches.length);
  }
  assert.ok(found.size >= 5,
    `only found a raw fetch( in ${found.size} file(s) across the whole tree; the regex or the walk is `
    + "broken -- this repo has had this many bypassing sites in living memory, so zero or near-zero means "
    + "the search stopped seeing files, not that the tree got clean overnight");

  const exemptByFile = new Map(EXEMPT.map((e) => [e.file, e]));
  const problems: string[] = [];

  for (const [file, count] of found) {
    const exempt = exemptByFile.get(file);
    if (!exempt) {
      problems.push(`${file}: ${count} raw fetch( call(s), classified as NEITHER converted nor exempt -- `
        + "either convert it to requestJson, or add it to EXEMPT above with a real reason");
      continue;
    }
    if (exempt.count !== count) {
      problems.push(`${file}: EXEMPT says ${exempt.count} call(s), the file actually has ${count} -- read `
        + "the new/removed call(s) before updating the count: a new one may be the same exempt shape, or "
        + "a genuinely new bypass hiding behind an old exemption");
    }
    exemptByFile.delete(file);
  }
  for (const stale of exemptByFile.keys()) {
    problems.push(`${stale}: EXEMPT lists it with no raw fetch( found at all -- either it was converted `
      + "(delete the EXEMPT entry) or the file moved (update the path)");
  }

  assert.deepEqual(problems, []);
});
