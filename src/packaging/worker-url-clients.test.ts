// The lab half of a11ign/control `src/fleet-layer/worker-url.test.ts`, split out by a11ign#5345 step 2b (a11ign#5347): the five `assertWorkerUrl` unit tests moved with the fleet; this discovery reads lab files, and in the fleet repository it failed its own `>= 3` vacuity floor.
// FIRST, so it observes every read below it -- #929. See `packages/guards/src/walk-scope.ts`.
import { declareWalkScope } from "../../../guards/src/walk-scope.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { sourceFiles } from "../../../worker-fleet/src/source-walk.ts";

/**
 * WHAT THIS GUARD READS, declared so a diff outside it does not run it -- #929. It walks the lab and nothing else outside its own imports.
 * Its own run checks that, and fails if it ever reads wider.
 */
export const WALK_SCOPE = ["packages/lab"];
await declareWalkScope(import.meta.url);

/**
 * A worker address is validated where it ENTERS the program, and every client does it.
 *
 * `--worker=http://:8765` reached a real run: four capture shards spent 29 minutes against an unparseable address
 * while every worker sat idle, and the run recorded "worker never became ready" as a failure of the PAGE. A validator
 * is only worth anything if every client calls it, so this is a DISCOVERY test rather than a list: a hardcoded list
 * of clients checks the places somebody already thought of.
 *
 * The validator's own tests (`assertWorkerUrl` accepts, normalises and refuses) live with it, in the fleet repository.
 */
const LAB = fileURLToPath(new URL("../../", import.meta.url));

/** Every lab script that reads a `--worker=` argument, discovered rather than listed. */
function workerArgClients(): Array<[string, string]> {
  return sourceFiles({ root: LAB }).filter(([, src]) => src.includes('"--worker="'));
}

test("every client that takes --worker validates it", () => {
  const clients = workerArgClients();

  // A discovery finding nothing passes every assertion below in perfect silence, which is this repo's own
  // rule about a check that reports success having examined nothing. Measured at the move: 7 lab files.
  // The message names no count: a floor that also REPORTS its subject is refused by `reported-counts.test.ts`.
  assert.ok(clients.length >= 3,
    "found too few --worker clients; the discovery walk is broken, not the codebase clean");

  for (const [name, src] of clients) {
    // A client that submits to the fleet job service takes no address at all (A11-263): it ignores `--worker=` with a line, or refuses it, through `fleet-job.ts`, so
    // there is no address to validate. Either way the argument is dealt with where it ENTERS the program.
    assert.match(src, /assertWorkerUrl|workerAddressNotice\(/,
      `${name} reads --worker but neither validates it nor routes it through workerAddressNotice. A truthiness check passes \`http://:8765\`, and the `
      + "cost of that is 5 minutes per page of readiness timeout recorded as a failure of the page.");
  }
});

test("a client that submits to the fleet job service never reads a worker address for a box", () => {
  // The positive control is the floor above; this is the other direction. `workerAddressNotice` ignores or refuses an address, so a file that calls it and then
  // validates an address with `assertWorkerUrl` as well is a file that still dispatches to one. The three clients that moved in A11-263 are named, and each must do only the former.
  const moved = ["capture-screenreader-dataset.mjs", "capture-real-pages.mjs"];
  const found = workerArgClients().filter(([name]) => moved.some((file) => name.endsWith(file)));
  assert.equal(found.length, moved.length, "the discovery must find the moved clients, or this test compares nothing");
  for (const [name, src] of found) {
    assert.match(src, /workerAddressNotice\(/, `${name} must route a worker address through workerAddressNotice`);
    assert.doesNotMatch(src, /assertWorkerUrl/, `${name} submits to the service and must not validate an address for a box`);
  }
});

test("no client rolls its own worker-URL check instead of calling the shared one", () => {
  // A second validator is a second thing to drift. This is the same argument as one channel table, one
  // inventory reader, one source walk.
  for (const [name, src] of workerArgClients()) {
    assert.ok(!/new URL\((?:WORKER|worker)/.test(src),
      `${name} parses the worker address itself — call assertWorkerUrl so there is one definition`);
  }
});
