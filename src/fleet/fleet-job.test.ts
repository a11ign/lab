/**
 * The lab's one client of the `fleet` command (A11-263), driven against a stub script the test points `FLEET` at.
 *
 * Nothing here reaches the control plane. The stub logs what it was asked and answers as the real command's contract says (control `docs/fleet-jobs.md`): a job ID at once on
 * stdout, `wait` ending with the exit code it is given, `fetch` copying a fixture results directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { scratchDir as tempDir } from "./scratch-dir.ts";
import { stubFleet, manifestFixture, writeResults } from "./stub-fleet.ts";
import {
  EXIT_UNCOLLECTED, FleetInputError, controlHost, fetchManifest, fleetCommand, fleetInputs, jobIdFrom, markCollected, newestPending, parseEnvFile, pendingDir, readPending,
  realFleet, recapture, reachableFromBoxes, submitCases, waitOnce, workerAddressNotice, writePending,
} from "./fleet-job.ts";

const CASE = { id: "alpha.good", url: "http://pages.test/alpha/good.html", body: { task: "t", probeForms: true }, group: "alpha" };

/** A stub fleet and the directory the client files its pending jobs under. */
function setup(config: Parameters<typeof stubFleet>[1]) {
  const root = tempDir("fleet-job-");
  const stub = stubFleet(join(root, "stub"), config);
  return { root, stub, run: realFleet({ ...process.env, ...stub.env }), dir: pendingDir(join(root, "corpus")) };
}

test("submit writes the cases file, passes --boxes and --label, and returns the job ID the command prints", () => {
  const { stub, run, dir } = setup({ ids: ["fj-20261025T000000Z-aaaaaa"] });
  const id = submitCases({
    cases: [CASE, { ...CASE, id: "alpha.bad", url: "http://pages.test/alpha/bad.html" }],
    groups: { alpha: { skipWhen: { environment: { screenReaderVersion: "2026.1" } } } },
    boxes: "2", label: "A11-263", dir, run,
  });
  assert.equal(id, "fj-20261025T000000Z-aaaaaa");
  const [call] = stub.calls();
  assert.deepEqual([call!.argv[0], call!.argv[1], call!.argv[2]], ["capture", "submit", "--cases"]);
  assert.deepEqual(call!.argv.slice(4), ["--boxes", "2", "--label", "A11-263"], "the boxes and the label, and nothing else the service takes");
  const sent = stub.submittedCases(id);
  assert.deepEqual(sent.cases.map((c) => [c.id, c.group]), [["alpha.good", "alpha"], ["alpha.bad", "alpha"]]);
  assert.deepEqual(sent.cases[0]!.body, { task: "t", probeForms: true }, "the body goes exactly as the client built it");
  assert.deepEqual(sent.groups, { alpha: { skipWhen: { environment: { screenReaderVersion: "2026.1" } } } });
  assert.ok(existsSync(dir), "the cases file sits under .fleet-jobs/, outside every captures/*.json glob");
});

test("a missing or malformed label is refused before fleet runs", () => {
  const { stub, run, dir } = setup({ ids: ["fj-x"] });
  assert.throws(() => fleetInputs([], {}), (error: Error) => error instanceof FleetInputError && /pass --label=<ticket key>/.test(error.message));
  assert.throws(() => fleetInputs(["--label=not a key"], {}), /is not one/);
  assert.throws(() => submitCases({ cases: [CASE], boxes: "1", label: "bad label", dir, run }), /ticket key/);
  assert.deepEqual(stub.calls(), [], "fleet was never run");
});

test("the boxes, the label and the wait come from the environment, else the flags, else their defaults", () => {
  assert.deepEqual(fleetInputs(["--boxes=3", "--label=A11-1", "--wait=2h"], {}), { boxes: "3", label: "A11-1", wait: "2h" });
  assert.deepEqual(fleetInputs(["--boxes=3", "--label=A11-1", "--wait=2h"], { A11Y_FLEET_BOXES: "w1,w2", A11Y_FLEET_LABEL: "A11-2", A11Y_FLEET_WAIT: "28800s" }),
    { boxes: "w1,w2", label: "A11-2", wait: "28800s" }, "the environment wins, as the catalogue sets it");
  assert.deepEqual(fleetInputs(["--label=A11-1"], {}), { boxes: "ready", label: "A11-1", wait: null }, "no boxes means ready, and no wait means the client does not wait");
  assert.throws(() => fleetInputs(["--label=A11-1", "--boxes=a;b"], {}), /--boxes/);
  assert.deepEqual(fleetInputs([], {}, { forCollect: true }), { boxes: "ready", label: "", wait: null }, "a --collect needs no label: the job it reads was booked under one");
  assert.throws(() => fleetInputs(["--label=bad label"], {}, { forCollect: true }), /is not one/, "but one it is given must still be a ticket key");
  assert.throws(() => fleetInputs(["--label=A11-1", "--wait=forever"], {}), /--wait/);
});

test("an address is ignored with one line when A11Y_FLEET_BOXES is set, and refused naming the new form when it is not", () => {
  const ignored = workerAddressNotice({ argv: ["--worker=http://192.0.2.7:8765"], env: { A11Y_FLEET_BOXES: "ready", A11Y_WORKERS: "http://192.0.2.8:8765,http://192.0.2.9:8765" } });
  assert.match(ignored ?? "", /^ignoring the worker address\(es\) given \(http:\/\/192\.0\.2\.7:8765, http:\/\/192\.0\.2\.8:8765,http:\/\/192\.0\.2\.9:8765\)/);
  assert.equal(ignored!.trim().split("\n").length, 1, "one stderr line");
  for (const given of [{ argv: ["--worker=http://192.0.2.7:8765"], env: {} }, { argv: [], env: { A11Y_WORKER: "http://192.0.2.7:8765" } },
    { argv: [], env: {}, positional: ["http://192.0.2.7:8765"] }]) {
    assert.throws(() => workerAddressNotice(given), (error: Error) => error instanceof FleetInputError && /--boxes=<a number\|ready\|box,box> with --label=<ticket key>/.test(error.message));
  }
  assert.equal(workerAddressNotice({ argv: [], env: { A11Y_FLEET_BOXES: "ready" } }), null, "control: no address, nothing to say");
});

test("waitOnce runs `job wait --timeout` exactly once, and passes on each of the exit codes", () => {
  for (const code of [0, 124, 1, 3, 2]) {
    const { stub, run } = setup({ ids: [], waitCodes: { "fj-w": code } });
    assert.equal(waitOnce({ job: "fj-w", duration: "90s", run }), code);
    assert.deepEqual(stub.calls().map((c) => c.argv), [["job", "wait", "fj-w", "--timeout", "90s"]], "once, with the timeout, and with nothing around it");
  }
  assert.throws(() => waitOnce({ job: "fj-w", duration: "forever" }), /whole number and a unit/);
});

test("a re-capture names the source job and only the cases asked, and returns the NEW job ID", () => {
  const { stub, run } = setup({ ids: ["fj-new"] });
  assert.equal(recapture({ job: "fj-old", caseIds: ["alpha.bad", "beta.bad"], label: "A11-263", run }), "fj-new");
  assert.deepEqual(stub.calls()[0]!.argv, ["job", "recapture", "fj-old", "--cases", "alpha.bad,beta.bad", "--label", "A11-263"]);
  assert.deepEqual(stub.recaptured("fj-new").cases, ["alpha.bad", "beta.bad"]);
});

test("a command that returns no job ID is an error saying what the service said", () => {
  const { run, dir } = setup({ ids: [], refuse: "no box is ready" });
  assert.throws(() => submitCases({ cases: [CASE], boxes: "ready", label: "A11-263", dir, run }), /did not return a job ID \(fleet exit 2\): no box is ready/);
});

test("fetching a job copies its results and reads its manifest and each capture's record", () => {
  const root = tempDir("fleet-fetch-");
  const manifest = manifestFixture({ job: "fj-f", boxes: [{ name: "w1" }], captures: [{ case: "alpha.good", group: "alpha", url: CASE.url, box: "w1" }, { case: "alpha.bad", group: "alpha", url: CASE.url, box: "w1", status: "failed", error: "w1: boom" }] });
  const fixture = writeResults(join(root, "fixture"), manifest, { "alpha.good": { transcript: ["hello"] } });
  const stub = stubFleet(join(root, "stub"), { ids: [], fixtures: { "fj-f": fixture } });
  const fetched = fetchManifest({ job: "fj-f", dir: join(root, "out"), run: realFleet({ ...process.env, ...stub.env }) });
  assert.equal(fetched.manifest.job, "fj-f");
  assert.deepEqual(fetched.manifest.captures.map((c) => [c.case, c.status]), [["alpha.good", "done"], ["alpha.bad", "failed"]], "a failed capture is a record in the manifest");
  assert.deepEqual(fetched.record(fetched.manifest.captures[0]!)?.capture, { transcript: ["hello"] });
  assert.equal(fetched.record(fetched.manifest.captures[1]!)?.capture.error, "w1: boom");
  assert.equal(fetched.record({ ...fetched.manifest.captures[0]!, file: "nope.json" }), null, "a case the service wrote no record for reads as none");
  assert.deepEqual(stub.calls().map((c) => c.argv.slice(0, 3)), [["job", "fetch", "fj-f"]]);
});

test("the pending file is written under .fleet-jobs/, read back, and the newest uncollected job of a kind is what --collect finds", () => {
  const root = tempDir("fleet-pending-");
  const base = { label: "A11-263", names: { "a.good": "/out/a.good.json" } };
  writePending(root, { ...base, job: "fj-1", submittedAt: "2026-10-25T10:00:00.000Z", kind: "dataset" });
  writePending(root, { ...base, job: "fj-2", submittedAt: "2026-10-25T11:00:00.000Z", kind: "dataset" });
  writePending(root, { ...base, job: "fj-3", submittedAt: "2026-10-25T12:00:00.000Z", kind: "real-pages" });
  assert.ok(existsSync(join(root, ".fleet-jobs", "fj-1.json")));
  assert.deepEqual(readPending(root, "fj-1")?.names, { "a.good": "/out/a.good.json" });
  assert.equal(newestPending(root, "dataset")?.job, "fj-2", "newest of its kind, and never another client's job");
  markCollected(root, readPending(root, "fj-2")!);
  assert.equal(newestPending(root, "dataset")?.job, "fj-1", "a collected job is not collected twice");
  assert.equal(newestPending(root, "evidence-check"), null);
  assert.equal(readPending(root, "fj-none"), null);
});

test("jobIdFrom takes the ID line and ignores the hint a person at a terminal is shown", () => {
  assert.equal(jobIdFrom("fj-20261025T085815Z-315a1b\n"), "fj-20261025T085815Z-315a1b");
  assert.equal(jobIdFrom("submitted 3 cases as fj-1; follow it with: fleet job wait fj-1 --timeout 30m\n"), null, "a hint is not an ID line");
  assert.equal(jobIdFrom(""), null);
});

test("the command is $FLEET, else `fleet`", () => {
  assert.equal(fleetCommand({ FLEET: "/stub/fleet" }), "/stub/fleet");
  assert.equal(fleetCommand({}), "fleet");
  assert.equal(fleetCommand({ FLEET: "" }), "fleet");
});

test("the control plane's address comes from the environment, else the file the fleet.env names", () => {
  assert.equal(controlHost({ A11Y_CONTROL_HOST: "192.0.2.5" }, () => null), "192.0.2.5");
  assert.equal(controlHost({ HOME: "/h" }, (path) => (path === "/etc/a11ign/fleet.env" ? "A11Y_CONTROL_HOST_FILE=/run/host\n" : path === "/run/host" ? "192.0.2.6\n" : null)), "192.0.2.6");
  assert.equal(controlHost({ HOME: "/h" }, () => null), null);
  assert.deepEqual(parseEnvFile("export A11Y_PVE_KEY='/k'\n# x\nA11Y_CONTROL_HOST=1.2.3.4\n"), { A11Y_PVE_KEY: "/k", A11Y_CONTROL_HOST: "1.2.3.4" });
});

test("a localhost page URL is made one the boxes can fetch, and any other is left alone", () => {
  assert.equal(reachableFromBoxes("https://www.w3.org/WAI/", {}), "https://www.w3.org/WAI/");
  assert.throws(() => reachableFromBoxes("http://localhost:5050/x/good.html", { HOME: "/nowhere" }, () => null), (error: Error) => error instanceof FleetInputError && /DATASET_BASE_URL/.test(error.message));
});

test("EXIT_UNCOLLECTED is 75, the code a pipeline that forgot to say how long to wait stops on", () => {
  assert.equal(EXIT_UNCOLLECTED, 75);
});
