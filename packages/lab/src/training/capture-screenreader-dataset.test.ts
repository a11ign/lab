/**
 * #2756 (the chairman, 2026-09-28): one named worker being down must not refuse the whole run --
 * `fleet:deploy`'s own `--allow-offline` (report the held box, act on the rest) is the precedent named.
 *
 * SCOPED TO `survivingNamedWorkers`, not `wakeNamedWorkers` itself. `wakeNamedWorkers` (`wake-by-hand.mjs`)
 * is shared by six other by-hand capture entries (`wake-by-hand.test.ts`'s own `REGION_ENTRIES`) this row
 * did not individually audit, so its all-or-nothing contract is untouched -- `survivingNamedWorkers` is
 * this file's OWN re-probe, called only from `acquireDatasetWorkers`'s two named-pool branches.
 *
 * Importing this module is guarded against starting a real capture run (see the file's own header
 * comment: `main()` only fires when the module IS `process.argv[1]`), so importing its named export here
 * is safe -- no network, no worker, no clock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { survivingNamedWorkers } from "./capture-screenreader-dataset.mjs";

/** A `probe` stand-in: answers for the URLs in `up`, throws ECONNREFUSED for everything else. */
function probeFor(up: string[]) {
  return async (url: string) => {
    const worker = url.replace(/\/health$/, "");
    if (up.includes(worker)) return { status: 200, ok: true, text: "", json: { ready: true } };
    throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  };
}

test("wakeNamedWorkers reporting ok is passed straight through, no re-probe at all", async () => {
  let probed = 0;
  const urls = ["http://192.0.2.20:8765", "http://192.0.2.21:8765"];
  const got = await survivingNamedWorkers(urls, { ok: true }, { probe: async () => { probed += 1; return {}; } });
  assert.deepEqual(got, urls, "wakeNamedWorkers already said everyone is up -- nothing to narrow");
  assert.equal(probed, 0, "a successful wake needs no re-probe of its own");
});

test("one of three named workers still down after wakeNamedWorkers's own attempt: the OTHER TWO still run", async () => {
  const urls = ["http://192.0.2.22:8765", "http://192.0.2.23:8765", "http://192.0.2.24:8765"];
  const got = await survivingNamedWorkers(urls,
    { ok: false, refusal: "REFUSING: 1 of 3 named worker(s) did not come up:\n192.0.2.23:8765: no-answer" },
    { probe: probeFor(["http://192.0.2.22:8765", "http://192.0.2.24:8765"]) });
  assert.deepEqual(got, ["http://192.0.2.22:8765", "http://192.0.2.24:8765"],
    "the down worker is excluded, not blocking; the two that answer proceed");
});

test("every named worker still down: REFUSES, naming the same reason wakeNamedWorkers gave (never zero workers)", async () => {
  const urls = ["http://192.0.2.25:8765", "http://192.0.2.26:8765"];
  const refusal = "REFUSING: 2 of 2 named worker(s) did not come up:\n...";
  await assert.rejects(
    survivingNamedWorkers(urls, { ok: false, refusal }, { probe: probeFor([]) }),
    (error: Error) => error.message === refusal,
  );
});

test("a single named worker, itself the one down: still refuses (one worker IS the whole pool)", async () => {
  const urls = ["http://192.0.2.27:8765"];
  const refusal = "REFUSING: 1 of 1 named worker(s) did not come up:\n192.0.2.27:8765: no-mac";
  await assert.rejects(
    survivingNamedWorkers(urls, { ok: false, refusal }, { probe: probeFor([]) }),
    (error: Error) => error.message === refusal,
  );
});
