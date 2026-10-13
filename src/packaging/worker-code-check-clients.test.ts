// The lab half of a11ign/control `src/fleet-layer/worker-code-check.test.ts`, split out by a11ign#5345 step 2b (a11ign#5347): the drift, empty-pool and shared-hasher tests moved with the fleet; these three read lab files, so they cannot.
// FIRST, so it observes every read below it -- #929. See `packages/guards/src/walk-scope.ts`.
import { declareWalkScope } from "../../../guards/src/walk-scope.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * WHAT THIS GUARD READS, declared so a diff outside it does not run it -- #929. It reads the capture clients under `packages/lab/src` and nothing else outside its own imports.
 * Its own run checks that, and fails if it ever reads wider.
 */
export const WALK_SCOPE = ["packages/lab/src"];
await declareWalkScope(import.meta.url);

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Every module that drives a capture is classified, and the union must cover what is DISCOVERED.
 *
 * A plain list rots: `worker-files.mjs`, the budget ladder and the signal-type scrape all read a hardcoded
 * set and all eventually missed the case that mattered. A plain discovery test over-fires here, because
 * "posts to /capture" admits diagnostics as well as corpus writers and the right behaviour differs — a
 * diagnostic must NEVER be the thing that takes the pool offline (`fleet-consistency` says so explicitly,
 * and it is why that check reports rather than refuses).
 *
 * So: two lists whose union must equal what is found. A seventh capture client fails this test until
 * somebody decides which kind it is, which is the decision that was missed when this preflight did not
 * exist.
 */
const CORPUS_WRITERS = [
  "packages/lab/src/training/capture-real-pages.mjs",
  "packages/lab/src/training/capture-screenreader-dataset.mjs",
];

const DIAGNOSTICS = [
  "packages/lab/src/training/repeat-capture.mjs",
  "packages/lab/src/harnesses/capture-fixtures.ts",
  "packages/lab/src/harnesses/page-identity-rate.ts",
  "packages/lab/src/harnesses/occurrence-verdict-stability.ts",
  "packages/lab/src/harnesses/capture-check.ts",
];

/** Every lab module that POSTs a capture to a worker. */
function captureClients(): string[] {
  const found: string[] = [];
  for (const dir of ["packages/lab/src/training", "packages/lab/src/harnesses"]) {
    for (const entry of readdirSync(`${REPO}${dir}`)) {
      // `.ts` since lab v0.1.27 (a11ign/a11ign#4519). The control copy matched `.mjs` alone, so the five harness
      // clients, now `.ts`, were never discovered and DIAGNOSTICS was classified by hand and never checked.
      if (!/\.(mjs|ts)$/.test(entry) || /\.(test|d)\.ts$/.test(entry)) continue;
      const path = `${dir}/${entry}`;
      const source = readFileSync(`${REPO}${path}`, "utf8");
      // DISPATCHING WORK is the signature, and it now has two spellings: a literal POST, or a call to the
      // shared `captureTolerantly`. Matching only the first found four clients after nine moved behind the
      // shared one -- a discovery walk quietly describing less than half the codebase, which is the exact
      // rot this test's own count assertion exists to catch.
      //
      // Still NOT matched: reading `/capture/<id>` to recover a lost response. That is asking for work
      // already done, not dispatching it, and a module that merely mentions the route is not a client.
      const dispatches = /["'`][^"'`]*\/capture["'`][^]{0,120}?method:\s*["']POST["']/.test(source)
        || /\bcaptureTolerantly\(/.test(source);
      if (dispatches) found.push(path);
    }
  }
  return found.sort();
}

const CLIENTS = captureClients();

test("capture clients are still found -- the positive control for the emptiness assertion below", () => {
  // Without this, `deepEqual(unclassified, [])` passes having compared nothing, which is what an empty
  // `CLIENTS` would look like. The floor is the number classified: every one of them must be discovered.
  assert.ok(CLIENTS.length >= CORPUS_WRITERS.length + DIAGNOSTICS.length,
    `discovery found ${CLIENTS.length} clients, fewer than the ${CORPUS_WRITERS.length + DIAGNOSTICS.length} classified `
    + "-- either clients were removed, or the dispatch pattern changed and the regex needs updating, not the count");
});

test("every capture client is classified as a corpus writer or a diagnostic", () => {
  const classified = new Set([...CORPUS_WRITERS, ...DIAGNOSTICS]);
  const unclassified = CLIENTS.filter((path) => !classified.has(path));
  assert.ok(CLIENTS.length > 0,
    "#1160: if `CLIENTS` is empty this assertion passes having compared nothing -- the control is the "
    + "population floor in the test above");
  assert.deepEqual(unclassified, [],
    "A new module drives captures and nobody has said whether it writes evidence. If it does, it must "
    + "call assertFleetRunsThisCheckout — a capture taken by a stale worker is indistinguishable from a "
    + "current one for ever after. If it is a diagnostic, add it to DIAGNOSTICS: a diagnostic must never "
    + "be the thing that takes the pool offline.");
});

test("EVERY corpus writer runs the preflight — not one of them", () => {
  // The shape this repo has paid for three times: `anchorToTop` had the focus-mode remedy and the other
  // sweeps did not; `startScreenReader` adopted a live NVDA and `ensureSpeechChannel` did not;
  // `waitForAnnouncement` settled speech at the end of a delta and not at the start. Each remedy was
  // correct, commented, and reachable from only one of the paths that needed it.
  assert.ok(CORPUS_WRITERS.length > 0, "the list this loop walks is empty, so the assertions below compare nothing");
  for (const path of CORPUS_WRITERS) {
    const source = readFileSync(`${REPO}${path}`, "utf8");
    assert.match(source, /assertFleetRunsThisCheckout\(/,
      `${path} writes captures into a corpus and does not check the fleet runs this checkout.`);
    assert.match(source, /--allow-stale-workers/,
      `${path} must offer the escape hatch, and by the same name as its sibling.`);
  }
});

test("the classified clients are real files, so the lists cannot rot into a no-op", () => {
  // A guard written against a shape you did not verify is the count-based check all over again: the first
  // version of `verify.corpus.test.ts` read a field that does not exist and passed against a corpus
  // carrying 604 crashes.
  for (const path of [...CORPUS_WRITERS, ...DIAGNOSTICS]) {
    assert.ok(readFileSync(`${REPO}${path}`, "utf8").length > 0, `${path} does not exist`);
  }
});
