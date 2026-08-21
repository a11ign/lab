// A run must not stop a page server another run is still using. The module header has always said so --
// "a long run must not shut down something another run is using" -- and the code implemented only half of
// it: the ADOPTER released with a no-op, and the STARTER stopped the server on exit whatever had joined
// since.
//
// Measured 2026-08-21. A 48-capture `evidence:check` adopted the server; a one-case capture run that had
// started it finished first and killed it; the remaining 46 captures read a dead port. They still
// "succeeded", because Edge serves its own error page, so the check compared 2 of 48 and called it
// "evidence unchanged — safe to ship". Two defects, one incident: this file covers the cause, and
// evidence-diff.test.ts covers the verdict that made it dangerous.
//
// Tested at the bookkeeping layer because the fault is a two-process INTERLEAVING, and spawning two real
// `serve` processes would test `npx` more than the rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import { createServer } from "node:http";

import { holdersPath, joinHolders, leasePageServer, leaveHolders, readHolders } from "./page-server.mjs";

/** A root whose `..` is a scratch dir, matching how the real caller passes `<dataset>/pages`. */
function scratchRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "a11y-holders-"));
  return resolve(dir, "pages");
}

/** A pid that is certainly alive and certainly not us: init. `kill(1, 0)` raises EPERM, not ESRCH. */
const OTHER_LIVE_PID = 1;
/** Comfortably above any real pid, so it is certainly gone. */
const DEAD_PID = 4_194_303;

test("a starter that finishes first leaves the server up for a holder still using it", () => {
  const root = scratchRoot();
  const path = holdersPath(root);

  // This process starts it, records the server, and another run joins.
  joinHolders(root, process.pid);
  writeFileSync(path, JSON.stringify({
    serverPid: process.pid,
    holders: [process.pid, OTHER_LIVE_PID],
  }) + "\n", "utf8");

  const outcome = leaveHolders(root);
  assert.equal(outcome.lastOut, false, "another run is still holding it — this is the whole bug");
  assert.deepEqual(outcome.remaining, [OTHER_LIVE_PID]);
  assert.ok(existsSync(path), "the file must survive so the remaining holder can still release");
  assert.deepEqual(readHolders(path).holders, [OTHER_LIVE_PID]);
});

test("the last one out reports it, and the file is removed", () => {
  const root = scratchRoot();
  joinHolders(root, process.pid);

  const outcome = leaveHolders(root);
  assert.equal(outcome.lastOut, true);
  assert.equal(outcome.serverPid, process.pid, "the pid must survive the read, or nobody can stop it");
  assert.ok(!existsSync(holdersPath(root)), "a server with no holders leaves no lease behind");
});

test("a crashed holder cannot pin a server forever", () => {
  // The property that makes a crash safe: the file is a hint, the process table is the truth.
  const root = scratchRoot();
  const path = holdersPath(root);
  writeFileSync(path, JSON.stringify({ serverPid: process.pid, holders: [process.pid, DEAD_PID] }) + "\n", "utf8");

  assert.deepEqual(readHolders(path).holders, [process.pid], "a dead pid is not a holder");
  assert.equal(leaveHolders(root).lastOut, true, "the only live holder leaving IS the last one out");
});

test("a lease whose server has died describes nothing", () => {
  const root = scratchRoot();
  const path = holdersPath(root);
  writeFileSync(path, JSON.stringify({ serverPid: DEAD_PID, holders: [process.pid] }) + "\n", "utf8");

  // Otherwise a stale file from a crashed run would have a later run signal a pid it does not own -- which
  // after pid reuse is somebody else's process.
  assert.equal(readHolders(path).serverPid, null);
});

test("an adopter registers, so it is visible to the run that started the server", () => {
  const root = scratchRoot();
  const path = holdersPath(root);
  // The starter's state, written by another process.
  writeFileSync(path, JSON.stringify({ serverPid: OTHER_LIVE_PID, holders: [OTHER_LIVE_PID] }) + "\n", "utf8");

  joinHolders(root, null); // adopting: no server pid of our own to contribute
  const state = readHolders(path);
  assert.deepEqual(state.holders.sort(), [OTHER_LIVE_PID, process.pid].sort(),
    "an unregistered adopter is invisible, which is how the server got stopped underneath one");
  assert.equal(state.serverPid, OTHER_LIVE_PID, "adopting must not overwrite whose server it is");
});

test("registering twice does not double-count", () => {
  const root = scratchRoot();
  joinHolders(root, process.pid);
  joinHolders(root, process.pid);
  assert.deepEqual(readHolders(holdersPath(root)).holders, [process.pid]);
  assert.equal(leaveHolders(root).lastOut, true, "or one process could never fully release");
});

test("the lease file is written atomically", () => {
  // Same rule as capture-progress.mjs: a concurrent reader must never see half a file. Checked by content
  // rather than by trusting the rename, and no `.tmp` may be left behind.
  const root = scratchRoot();
  joinHolders(root, process.pid);
  const raw = readFileSync(holdersPath(root), "utf8");
  assert.deepEqual(JSON.parse(raw).holders, [process.pid]);
  assert.ok(!existsSync(`${holdersPath(root)}.${process.pid}.tmp`), "the temp file must be renamed, not left");
});

test("leasePageServer REGISTERS when it adopts, and leaves the adopted server alone", async () => {
  // This asserts the CALL SITE, not the helper, and it exists because the first version of this suite did
  // the opposite: deleting `joinHolders` from the adopt branch left all seven tests green. A test that
  // proves the bookkeeping works while the code that had the bug never calls it is the count-based check
  // all over again -- so this drives the real entry point against a real listening socket.
  const served = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>probe</title>");
  });
  await new Promise<void>((ready) => served.listen(0, "127.0.0.1", ready));
  const { port } = served.address() as { port: number };

  try {
    const root = scratchRoot();
    const lease = await leasePageServer({ root, port, probePath: "probe.html" });
    assert.equal(lease.started, false, "something is already serving our probe, so it must be adopted");
    assert.deepEqual(readHolders(holdersPath(root)).holders, [process.pid],
      "an unregistered adopter is invisible to the run that started the server");

    await lease.release();
    assert.ok(!existsSync(holdersPath(root)), "the last holder out clears the lease");
    // And the adopted server is untouched: it was never ours to stop, and there was no recorded serverPid.
    assert.ok(served.listening, "releasing an adopted lease must not kill somebody else's server");
  } finally {
    await new Promise((closed) => served.close(closed));
  }
});

test("both of the starter's teardown paths are guarded by lastOut", () => {
  // A CALL-SITE check, and labelled as one. The starter's `release()` and its `exit` handler are the two
  // places that actually killed a server another run was using, and exercising them behaviourally means
  // spawning `npx serve` and waiting on its 90 s readiness budget -- which does not belong in a unit suite.
  //
  // `lastOut` itself is covered behaviourally above; what this pins is that neither path stops the server
  // without asking. Deleting either guard is the original incident, and nothing else in this file sees it.
  const source = readFileSync(resolve(process.cwd(), "packages/lab/src/training/page-server.mjs"), "utf8");
  assert.match(source, /if \(leaveHolders\(root\)\.lastOut\) stopGroup\(child\)/,
    "the exit path must not stop a server another run still holds");
  assert.match(source, /const \{ lastOut, remaining \} = leaveHolders\(root\);\s*\n\s*if \(!lastOut\)/,
    "release() must check for other holders before stopping");
  assert.match(source, /if \(lastOut && serverPid\) stopPid\(serverPid\)/,
    "the last holder out must be able to stop a server it did not start, or the server leaks");
});
