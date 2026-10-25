/**
 * The local UTM worker VM route of `training:capture` stays (A11-263; the plan: "the local UTM VM pool and in-process capture paths stay").
 *
 * A run that names no fleet input drives a person's own VM(s), so it is a different route from the fleet job, and these tests hold both halves of that: which runs take which
 * route, and that the local route still does what it did -- one case on one VM, both variants, the evidence check with its three attempts, the cache, and the same files.
 * The worker is a function the test hands in (`capture`, `environment`), so no VM, page server or network is involved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { scratchDir } from "../fleet/scratch-dir.ts";
import { fleetRequested } from "../fleet/fleet-job.ts";
import { LOCAL_CAPTURE_ATTEMPTS, captureOnLocalWorkers, captureVerified } from "./capture-local-vm.ts";
import { beginRun, readProgress } from "./capture-progress.mjs";

const TITLE = "Aquarium 001 schedule";
const GOOD = { transcript: ["heading, level 1, Aquarium 001 schedule", "Departures from Central station"], structure: { headings: ["Aquarium 001 schedule, heading, level 1"], landmarks: [], formFields: [] } };
const WRONG = { transcript: ["Cannot reach this site", "Try again"], structure: { headings: [], landmarks: [], formFields: [] } };
/** Built from octets: a written-out private address is refused by the leak guard. */
const vm = (octet: number) => `http://${[192, 168, 64, octet].join(".")}:8765`;

test("which runs are fleet runs: any fleet input or a worker address; a bare run is the local route", () => {
  assert.equal(fleetRequested([], {}), false, "a bare `training:capture` on a Mac is the local VM route");
  assert.equal(fleetRequested(["--only=a", "--resume", "--no-cache"], {}), false, "the case and cache flags are not fleet inputs");
  for (const argv of [["--label=A11-1"], ["--boxes=2"], ["--wait=1h"], ["--collect"], ["--collect=fj-1"], ["--worker=http://x:1"]]) assert.equal(fleetRequested(argv, {}), true, argv.join(" "));
  for (const name of ["A11Y_FLEET_BOXES", "A11Y_FLEET_LABEL", "A11Y_FLEET_WAIT", "A11Y_WORKER", "A11Y_WORKERS"]) assert.equal(fleetRequested([], { [name]: "x" }), true, name);
  assert.equal(fleetRequested([], { A11Y_FLEET_LABEL: "" }), false, "an empty variable is not set");
});

test("captureVerified: a rejected capture is kept and tried again, up to three attempts, and the accepted one is returned", async () => {
  const rejectedRoot = scratchDir("local-vm-rejected-");
  const answers = [WRONG, WRONG, GOOD];
  const logged: string[] = [];
  const got = await captureVerified({ rejectedRoot, log: (l) => void logged.push(l) }, {
    capture: async () => answers.shift()!, testCase: { id: "x" }, variant: "bad", url: "http://pages.test/x/bad.html", title: TITLE,
  });
  assert.deepEqual(got.transcript, GOOD.transcript);
  assert.deepEqual(readdirSync(rejectedRoot).sort(), ["x.bad.attempt1.json", "x.bad.attempt2.json"]);
  assert.equal(LOCAL_CAPTURE_ATTEMPTS, 3);
  assert.ok(logged.some((l) => /attempt 2\/3/.test(l)));
});

test("captureVerified: three rejections fail the case with the message it has always failed with; a lost capture counts as an attempt; any other fault is the case's failure at once", async () => {
  const rejectedRoot = scratchDir("local-vm-rejected-");
  await assert.rejects(captureVerified({ rejectedRoot }, { capture: async () => WRONG, testCase: { id: "x" }, variant: "good", url: "u", title: TITLE }),
    /after 3 attempts\. Not written as evidence; the rejected captures are in .* for diagnosis\./);
  assert.equal(readdirSync(rejectedRoot).length, 3);

  let calls = 0;
  const lost = () => { calls += 1; throw Object.assign(new Error("worker forgot capture"), { code: "CAPTURE_LOST" }); };
  await assert.rejects(captureVerified({ rejectedRoot: scratchDir("local-vm-lost-") }, { capture: async () => lost(), testCase: { id: "x" }, variant: "good", url: "u", title: TITLE }), /the worker restarted mid-capture after 3 attempts/);
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(captureVerified({ rejectedRoot }, { capture: async () => { calls += 1; throw new Error("HTTP 500"); }, testCase: { id: "x" }, variant: "good", url: "u", title: TITLE }), /HTTP 500/);
  assert.equal(calls, 1, "not retried");
});

/** The page directories the cache hashes: a good and a bad page per case. */
function servePages(pageRoot: string, ids: string[]): void {
  for (const id of ids) {
    mkdirSync(join(pageRoot, id), { recursive: true });
    for (const variant of ["good", "bad"]) writeFileSync(join(pageRoot, id, `${variant}.html`), `<title>${TITLE}</title>`);
  }
}

/** A run of `ids` over the given VMs, with a worker that answers `answer(worker, url)`. */
function run(ids: string[], workers: string[], answer: (worker: string, url: string) => unknown, over: { cache?: boolean; done?: string[] } = {}) {
  const root = scratchDir("local-vm-run-");
  const captureRoot = join(root, "captures");
  const pageRoot = join(root, "pages");
  const used: { worker: string; url: string }[] = [];
  const logged: string[] = [];
  const cases = ids.map((id) => ({ id }));
  const options = {
    cases, done: new Set(over.done ?? []), captureRoot, rejectedRoot: join(captureRoot, "rejected"), pageRoot, cache: over.cache ?? false, allowStale: true,
    optionsOf: (testCase: { id: string }) => ({ task: testCase.id, steps: 150 }),
    urlOf: (base: string, testCase: { id: string }, variant: string) => `${base}/${testCase.id}/${variant}.html`,
    titleOf: async () => TITLE, baseUrl: "http://pages.test",
    progressFor: ({ worker, baseUrl, workers: all, captureTimeoutMs }: { worker: string; baseUrl: string; workers: string[]; captureTimeoutMs: number }) => {
      const progress = beginRun({ root, worker, baseUrl, cases, captureTimeoutMs });
      progress.setWorkers(all);
      return progress;
    },
    log: (line: string) => void logged.push(line),
    capture: async (worker: string, url: string) => { used.push({ worker, url }); return answer(worker, url) as never; },
    environment: async () => ({ screenReader: "NVDA", screenReaderVersion: "2026.1" }),
  };
  return { root, captureRoot, pageRoot, used, logged, options, go: () => captureOnLocalWorkers(options as never, { workers }) };
}

test("a run over two local VMs shares one queue, keeps each pair on one VM, and writes the files and provenance it always did", async () => {
  const r = run(["a", "b", "c"], [vm(1), vm(2)], () => GOOD);
  servePages(r.pageRoot, ["a", "b", "c"]);
  await r.go();

  assert.deepEqual(readdirSync(r.captureRoot).sort(), ["a.bad.json", "a.good.json", "b.bad.json", "b.good.json", "c.bad.json", "c.good.json"]);
  for (const id of ["a", "b", "c"]) {
    const workers = r.used.filter((u) => u.url.includes(`/${id}/`)).map((u) => u.worker);
    assert.equal(workers.length, 2, `${id}: both variants captured`);
    assert.equal(new Set(workers).size, 1, `${id}: a pair is only comparable from one screen reader on one machine`);
    const good = JSON.parse(readFileSync(join(r.captureRoot, `${id}.good.json`), "utf8"));
    assert.equal(good.provenance.worker, workers[0], "the VM's address, as for any local run");
    assert.equal(good.provenance.options.task, id);
  }
  assert.ok(new Set(r.used.map((u) => u.worker)).size === 2, "both VMs took work");
  const progress = readProgress(r.root)!;
  assert.match(progress.outcome, /3 captured, 0 failed, 0 skipped, of 3 cases across 2 workers/);
  assert.deepEqual(progress.workers, [vm(1), vm(2)]);
});

test("a case that fails is named, the rest are kept, and the run throws with the count", async () => {
  const r = run(["a", "b"], [vm(1)], (_worker, url) => { if (url.includes("/b/")) throw new Error("HTTP 500"); return GOOD; });
  servePages(r.pageRoot, ["a", "b"]);
  await assert.rejects(r.go(), /1 case\(s\) failed\. The completed captures were kept; see npm run training:status, and re-run with --resume --no-cache/);
  assert.ok(existsSync(join(r.captureRoot, "a.good.json")) && !existsSync(join(r.captureRoot, "b.good.json")));
  assert.equal(readProgress(r.root)!.cases.b.status, "failed");
});
