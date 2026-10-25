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
 * NO LAB FILE READS A WORKER ADDRESS FOR THE FLEET (A11-263).
 *
 * This was a rule that every client validate the address it took: `--worker=http://:8765` reached a real run, four capture shards spent 29 minutes against an unparseable address while every
 * worker sat idle, and the run recorded "worker never became ready" as a failure of the PAGE. The remedy was a validator at the entry of every client.
 *
 * Every lab client now SUBMITS a fleet job, and the service names boxes and never gives an address (A11-243). So there is no address to validate: a client that still names `--worker=` hands it to
 * `workerAddressNotice` (directly, or through `runFleetClient`, which calls it), which ignores it with one line when `A11Y_FLEET_BOXES` is set (the job catalogue still passes the old addresses
 * until the lab on the lab host reads the new variables) and refuses it, naming the new form, when it is not. What the test keeps is the other direction: a file that names `--worker=` and
 * also validates an address with `assertWorkerUrl` is a file that still dispatches to one. The validator's own tests live with it, in the fleet repository.
 */
const LAB = fileURLToPath(new URL("../../", import.meta.url));

/** Every lab script that reads a `--worker=` argument, discovered rather than listed. */
function workerArgClients(): Array<[string, string]> {
  return sourceFiles({ root: LAB }).filter(([, src]) => src.includes('"--worker="'));
}

/** The files among `clients` that handle the argument as the fleet route requires, and the ones that do not. */
export function addressFaults(clients: Array<[string, string]>): string[] {
  const faults: string[] = [];
  for (const [name, src] of clients) {
    if (!/workerAddressNotice\(|runFleetClient\(/.test(src)) faults.push(`${name} reads --worker but neither routes it through workerAddressNotice nor submits through runFleetClient`);
    if (/assertWorkerUrl/.test(src)) faults.push(`${name} validates an address for a box; a client that submits a fleet job takes no address`);
  }
  return faults;
}

test("no lab file reads a worker address for the fleet", () => {
  const clients = workerArgClients();

  // A discovery finding nothing passes every assertion below in perfect silence, which is this repo's own
  // rule about a check that reports success having examined nothing. Eleven lab files name the flag.
  // The message names no count: a floor that also REPORTS its subject is refused by `reported-counts.test.ts`.
  assert.ok(clients.length >= 10,
    "found too few --worker clients; the discovery walk is broken, not the codebase clean");

  assert.deepEqual(addressFaults(clients), [],
    "a client that submits to the fleet job service takes no worker address: it ignores `--worker=` with a line (when A11Y_FLEET_BOXES is set) or refuses it, naming the new form, "
    + "through fleet-job.ts. A truthiness check on an address passes `http://:8765`, and the cost of that is 5 minutes per page of readiness timeout recorded as a failure of the page.");
});

test("the check can fail: a client that validates an address, or never routes the flag, is named", () => {
  // The positive control for the assertion above, run on seeded sources rather than on the tree, so it proves the detector sees both shapes.
  const validates: Array<[string, string]> = [["seed-a.ts", 'refuseUnknownFlags(["--worker="]); workerAddressNotice({}); assertWorkerUrl(x);']];
  const ignores: Array<[string, string]> = [["seed-b.ts", 'refuseUnknownFlags(["--worker="]); doNothing();']];
  const sound: Array<[string, string]> = [["seed-c.ts", 'refuseUnknownFlags(["--worker="]); await runFleetClient({});']];
  assert.equal(addressFaults(validates).length, 1);
  assert.equal(addressFaults(ignores).length, 1);
  assert.deepEqual(addressFaults(sound), []);
});

test("no client rolls its own worker-URL check instead of calling the shared one", () => {
  // A second validator is a second thing to drift. This is the same argument as one channel table, one
  // inventory reader, one source walk.
  for (const [name, src] of workerArgClients()) {
    assert.ok(!/new URL\((?:WORKER|worker)/.test(src),
      `${name} parses the worker address itself — a client that submits a fleet job takes no address`);
  }
});
