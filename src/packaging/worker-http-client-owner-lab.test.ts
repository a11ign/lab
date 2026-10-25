// The lab half of a11ign/control `src/fleet-layer/worker-http-client-owner.test.ts`, split out by a11ign#5345 step 2b (a11ign#5347): the converted functions in `packages/worker-fleet` moved with the fleet; the two in lab files and the EXEMPT read-back are the lab's.
// FIRST, so it observes every read below it -- #929. See `packages/guards/src/walk-scope.ts`.
import { declareWalkScope } from "../../../guards/src/walk-scope.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * WHAT THIS GUARD READS, declared so a diff outside it does not run it -- #929. It reads three lab files and nothing else outside its own imports.
 * Its own run checks that, and fails if it ever reads wider.
 */
export const WALK_SCOPE = ["packages/lab/src"];
await declareWalkScope(import.meta.url);

/**
 * Audit §9, "the HTTP client": `requestJson` (`packages/worker-fleet/src/worker-http.ts`) exists because global `fetch`
 * truncates a response silently past undici's ~300 s headers cap, so a raw `fetch` reaching a capture worker is a live
 * risk, not merely style. Call sites were converted one by one; the one that talks to a different service (the dataset
 * page server, fetching raw HTML rather than the worker's JSON API) is EXEMPT.
 *
 * `fetch-wrapper-coverage.test.ts` (beside this file) is the tree-wide discovery and is what to extend when a site is
 * found; this file stays for the per-function precision it does not need (presence or absence of `fetch(` inside the
 * exact function that was converted, not merely that the file changed).
 */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (relPath: string) => readFileSync(`${REPO}${relPath}`, "utf8");

const EXEMPT = {
  file: "packages/lab/src/training/capture-screenreader-dataset.mjs",
  reason: "fetches the dataset page server's raw HTML for a title check, not the worker's JSON API",
};

/**
 * The exact function(s) converted, per file -- checked by NAME rather than by the shape of a fetch call,
 * because the shape alone cannot tell "the worker's JSON API" from "the dataset page server".
 */
const CONVERTED_FUNCTIONS: Record<string, string[]> = {
  // `capture-status.mjs`'s `workerState` was the other entry. It went with the worker probe (A11-263): a run the fleet job service holds names no worker, so the status
  // command asks `fleet job status <id>` and sends nothing to a box. The assertion that it stays so is the test below this one.
  "packages/lab/src/harnesses/capture-check.ts": ["workerIsServing"],
};

function functionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`\\bfunction ${name}\\(`));
  assert.ok(start >= 0, `could not find "function ${name}(" -- the function was renamed or removed, `
    + "which this guard needs to know about rather than silently checking nothing");
  // Up to the next top-level function/export, or end of file -- good enough for a single-function scope.
  const rest = source.slice(start + 1);
  const nextTop = rest.search(/\n(export )?(async )?function /);
  return rest.slice(0, nextTop === -1 ? undefined : nextTop);
}

test("every converted lab call site no longer bypasses requestJson for a worker endpoint", () => {
  // The positive control for the emptiness assertions: the population is the entry above, and
  // `functionBody` asserts on a name that is gone, so a rename fails rather than passing over nothing.
  assert.ok(Object.keys(CONVERTED_FUNCTIONS).length >= 1, "CONVERTED_FUNCTIONS was emptied");
  const stillRaw: string[] = [];
  for (const [file, names] of Object.entries(CONVERTED_FUNCTIONS)) {
    const source = read(file);
    for (const name of names) {
      if (/\bfetch\(/.test(functionBody(source, name))) stillRaw.push(`${file} :: ${name}()`);
    }
  }
  assert.deepEqual(stillRaw, [], `these functions still contain a raw fetch(:\n${stillRaw.join("\n")}`);
  const missingImport = Object.keys(CONVERTED_FUNCTIONS).filter((file) => !/requestJson/.test(read(file)));
  assert.deepEqual(missingImport, [],
    `these files no longer import requestJson at all -- either the conversion regressed or the file `
    + `changed shape:\n${missingImport.join("\n")}`);
});

test("the status command sends nothing to a box: a run the service holds names no worker (A11-263)", () => {
  const text = read("packages/lab/src/training/capture-status.mjs");
  assert.doesNotMatch(text, /requestJson|\bfetch\(|worker-http/, "capture-status.mjs probes a worker again; it should ask `fleet job status <id>` instead");
});

test("the one exempt call site is still raw fetch, and still says why", () => {
  const text = read(EXEMPT.file);
  assert.match(text, /\bfetch\(/, `${EXEMPT.file} no longer calls fetch( at all -- if it was converted, `
    + "delete this EXEMPT entry rather than leaving a stale one");
  assert.match(text, /EXEMPT from audit §9/,
    `${EXEMPT.file} carries a raw fetch( with no EXEMPT comment explaining why -- restore the reason, `
    + "which the audit could otherwise not tell from an oversight");
});
