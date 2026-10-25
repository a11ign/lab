/**
 * The capture clients that moved onto the fleet job service (A11-263), driven end to end against a STUBBED service.
 *
 * `fleet` is a script the test writes and points `FLEET` at (`src/fleet/stub-fleet.ts`): it logs what it was asked, prints a job ID at once for a submit and a re-capture,
 * exits with a chosen code for `job wait`, and for `job fetch` copies a fixture results directory (a manifest in the shape control writes, and its records). Nothing reaches the
 * control plane, a box or a page server, and each test says what the client asked of the service and what it wrote from the answer.
 *
 * The clients' own scripts cannot be imported whole here (their closure reaches the corpus), so what is driven is what they are built from: the job a client submits
 * (`datasetJob`, `realPagesJob`), the collector it hands the flow (`datasetCollector`, `realPagesCollector`), and the flow itself (`follow`, `collectFlow`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { scratchDir as tempDir } from "../fleet/scratch-dir.ts";
import { stubFleet, manifestFixture, writeResults } from "../fleet/stub-fleet.ts";
import { collectFlow, follow, submitJob } from "../fleet/capture-flow.ts";
import type { Flow } from "../fleet/capture-flow.ts";
import { fleetInputs, realFleet, readPending } from "../fleet/fleet-job.ts";
import { datasetCollector, datasetJob } from "./dataset-fleet.ts";
import { beginRun, continueRun, readProgress } from "./capture-progress.mjs";
import { cacheKey, skipWhenFor, stampProvenance } from "./capture-cache.mjs";
import { captureOptions } from "./capture-screenreader-dataset.mjs";
import { caseIdsFor, publisherOf, realPageBody, realPagesCollector, realPagesJob } from "./capture-real-pages.mjs";
import { FAULT } from "@a11ign/screenreader-worker/capture-faults";

const TITLE = "Aquarium 001 schedule";
const EMPTY_STRUCTURE = { headings: [], landmarks: [], formFields: [] };
/** A capture the pipeline's own gates ACCEPT for `TITLE`, and one they refuse: the wrong page, which is what a rejected variant is. */
const EVIDENCE = { transcript: ["heading, level 1, Aquarium 001 schedule", "Departures from Central station"], structure: { ...EMPTY_STRUCTURE, headings: ["Aquarium 001 schedule, heading, level 1"] } };
const NOT_EVIDENCE = { transcript: ["Cannot reach this site", "Try again"], structure: EMPTY_STRUCTURE };
const ENVIRONMENT = { screenReader: "NVDA", screenReaderVersion: "2026.1", browser: "Edge", browserVersion: "151", windowsVersion: "11", architecture: "x64", captureProtocol: 7 };
const BASE = "http://pages.test";

/** Everything one client run needs: a corpus root, a stub service, and the flow wired to them. */
function rig(config: Parameters<typeof stubFleet>[1], { wait = "1h", now }: { wait?: string | null; now?: () => number } = {}) {
  const root = tempDir("capture-fleet-job-");
  const stub = stubFleet(join(root, "stub"), config);
  const out: string[] = [];
  const err: string[] = [];
  const corpus = join(root, "corpus");
  const captureRoot = join(corpus, "captures");
  mkdirSync(captureRoot, { recursive: true });
  const progress = beginRun({ root: corpus, worker: null, baseUrl: BASE, cases: [{ id: "x" }] });
  const logged: string[] = [];
  const checked: string[][] = [];
  const io = {
    captureRoot, rejectedRoot: join(captureRoot, "rejected"), progress,
    assertFleetRunsThisCheckout: async (boxes: string[]) => { checked.push(boxes); },
    log: (line: string) => void logged.push(line), logError: (line: string) => void logged.push(line),
  };
  const deps = { run: realFleet({ ...process.env, ...stub.env }), out: (t: string) => void out.push(t), err: (t: string) => void err.push(t), ...(now ? { now } : {}) };
  const flow = (collect: Flow["collect"]): Flow => ({
    root: corpus, inputs: { boxes: "1", label: "A11-263", wait }, collect, deps, hint: (job) => `collect it: --collect=${job}`,
  });
  /** Replace the stub's config after the results directories it will serve exist. */
  const configure = (next: Parameters<typeof stubFleet>[1]) => writeFileSync(stub.env.STUB_CONFIG!, JSON.stringify(next));
  return { root, stub, out, err, corpus, captureRoot, progress, io, logged, checked, deps, flow, configure };
}

/** The results directory of a dataset job whose cases are `x.good` and `x.bad` on box `w1`, with the captures given. */
function datasetResults(root: string, job: string, captures: Record<string, unknown>, { attempt = 1, only }: { attempt?: number; only?: string[] } = {}) {
  const wanted = (only ?? ["x.good", "x.bad"]);
  const manifest = manifestFixture({
    job, recaptureOf: attempt > 1 ? "fj-1" : null,
    boxes: [{ name: "w1", workerCode: "code-1", environment: { ...ENVIRONMENT, workerCode: "code-1" } }],
    captures: wanted.map((c) => ({ case: c, group: "x", url: `${BASE}/x/${c.split(".")[1]}.html`, box: "w1", attempt, body: { task: "t" } })),
  });
  return writeResults(join(root, `results-${job}`), manifest, captures);
}

const extra = { titles: { "x.good": TITLE, "x.bad": TITLE }, pageHashes: { x: "feedface00000000" } };
const submitX = (r: ReturnType<typeof rig>, flow: Flow) => submitJob(flow, {
  kind: "dataset", ...datasetJob({ cases: [{ id: "x" }], baseUrl: BASE, optionsOf: () => ({ task: "t" }), captureRoot: r.captureRoot }), extra,
});

// ---- what a client SUBMITS -------------------------------------------------------------------------------------------------------------------------------

test("a case is ONE group of good and bad, each variant with exactly the body captureOptions gives its case", () => {
  const plain = { id: "plain-case", task: "read the page" };
  const forms = { id: "forms-case", task: "fill the form", probeForms: true, probeTables: true, probeOrder: "focus-first", probeSomethingNew: true };
  const job = datasetJob({ cases: [plain, forms], baseUrl: BASE, optionsOf: captureOptions, captureRoot: "/captures" });
  assert.deepEqual(job.cases.map((c) => [c.id, c.group]), [
    ["plain-case.good", "plain-case"], ["plain-case.bad", "plain-case"], ["forms-case.good", "forms-case"], ["forms-case.bad", "forms-case"],
  ], "two service cases per case, in one group, good before bad");
  assert.deepEqual(job.cases.find((c) => c.id === "plain-case.bad")!.body, captureOptions(plain));
  assert.deepEqual(job.cases.find((c) => c.id === "forms-case.good")!.body, captureOptions(forms));
  assert.notDeepEqual(job.cases[0]!.body, job.cases[2]!.body, "per-case bodies: the two cases are not sent the same body");
  assert.equal((job.cases[2]!.body as Record<string, unknown>).probeSomethingNew, true, "a probe nobody listed is forwarded by prefix");
  for (const c of job.cases) assert.ok(!("url" in c.body), "the service adds the url; a body that sets it is refused");
  assert.equal(job.cases[0]!.url, `${BASE}/plain-case/good.html`);
  assert.equal(job.names["plain-case.bad"], "/captures/plain-case.bad.json", "each case's output is named, so a collect writes the file its readers read");
});

test("a case whose usable pair on disk matches the page and options carries skipWhen, from the environment the pair was taken under", () => {
  const dir = tempDir("capture-skipwhen-");
  const options = { task: "t", steps: 150 };
  const stamp = (variant: string, extra: Record<string, unknown> = {}) => writeFileSync(join(dir, `x.${variant}.json`), JSON.stringify(
    stampProvenance({ screenReader: "NVDA", transcript: ["a", "b"], structure: {}, environment: ENVIRONMENT, ...extra }, {
      key: cacheKey({ caseId: "x", pageHash: "abc", options, environment: ENVIRONMENT }), pageHash: "abc", options, environment: ENVIRONMENT, worker: "w9",
    })));
  stamp("good"); stamp("bad");
  const want = skipWhenFor({ captureRoot: dir, caseId: "x", pageHash: "abc", options });
  assert.ok(want, "a usable pair that matches on everything but the box is eligible");
  assert.equal(want.environment.screenReaderVersion, "2026.1");
  assert.equal(want.environment.guidepupVersion, null, "a field the pair never recorded reads null, as the service reads an absent field of a box");
  assert.deepEqual(Object.keys(want.environment).sort(), ["architecture", "browser", "browserProfile", "browserVersion", "captureProtocol", "guidepupVersion", "provisionRevision", "screenReader", "screenReaderSettings", "screenReaderVersion", "windowSize", "windowsVersion"]);

  // The other directions, each a different reason the pair must be captured again whatever box it lands on.
  assert.equal(skipWhenFor({ captureRoot: dir, caseId: "x", pageHash: "CHANGED", options }), null, "the page changed");
  assert.equal(skipWhenFor({ captureRoot: dir, caseId: "x", pageHash: "abc", options: { ...options, probeForms: true } }), null, "the options changed");
  assert.equal(skipWhenFor({ captureRoot: dir, caseId: "nothing-captured", pageHash: "abc", options }), null, "no pair on disk");
  stamp("bad", { environment: { ...ENVIRONMENT, browserVersion: "150" } });
  assert.equal(skipWhenFor({ captureRoot: dir, caseId: "x", pageHash: "abc", options }), null, "the two halves came from different environments: a pair is only comparable from one");
});

// ---- the evidence check becomes a re-capture request -------------------------------------------------------------------------------------------------------

test("a rejected bad is re-captured through `job recapture` with only that case, and written after a passing second attempt", async () => {
  const r = rig({ ids: ["fj-1", "fj-2"] });
  const first = datasetResults(r.root, "fj-1", { "x.good": EVIDENCE, "x.bad": NOT_EVIDENCE });
  const second = datasetResults(r.root, "fj-2", { "x.bad": EVIDENCE }, { attempt: 2, only: ["x.bad"] });
  r.configure({ ids: ["fj-1", "fj-2"], fixtures: { "fj-1": first, "fj-2": second } });
  const flow = r.flow(datasetCollector(r.io));
  const exit = await follow(flow, [submitX(r, flow)]);

  assert.equal(exit, 0, r.err.join(""));
  const asked = r.stub.calls().map((c) => c.argv.slice(0, 3).join(" "));
  assert.deepEqual(asked, [
    "capture submit --cases", "job wait fj-1", "job fetch fj-1", "job recapture fj-1", "job wait fj-2", "job fetch fj-2",
  ], "one wait per job, and the re-capture between the first collect and the second wait");
  assert.deepEqual(r.stub.recaptured("fj-2"), { source: "fj-1", cases: ["x.bad"], label: "A11-263" }, "only the rejected variant, never the pair");

  const good = JSON.parse(readFileSync(join(r.captureRoot, "x.good.json"), "utf8"));
  const bad = JSON.parse(readFileSync(join(r.captureRoot, "x.bad.json"), "utf8"));
  assert.deepEqual(good.transcript, EVIDENCE.transcript);
  assert.deepEqual(bad.transcript, EVIDENCE.transcript, "the second attempt is what is written");
  assert.ok(existsSync(join(r.captureRoot, "rejected", "x.bad.attempt1.json")), "the rejected first attempt is kept for diagnosis, as it always was");
  assert.equal(readdirSync(join(r.captureRoot, "rejected")).length, 1);
  assert.equal(good.provenance.worker, "w1", "the box's NAME: the service never gives an address");
  assert.equal(bad.provenance.worker, "w1", "and the re-captured bad variant sits on the box its good variant was taken on");
  assert.equal(good.provenance.workerCode, "code-1");
  assert.equal(good.provenance.cacheKey, cacheKey({ caseId: "x", pageHash: "feedface00000000", options: { task: "t" }, environment: { ...ENVIRONMENT, workerCode: "code-1" } as never }));
  assert.equal(good.provenance.pageHash, "feedface00000000", "the page as it was SUBMITTED");
  assert.equal(readProgress(r.corpus)?.cases.x.status, "captured");
  assert.ok(readProgress(r.corpus)?.finishedAt, "the run ends when no case is left in flight");
  assert.deepEqual(r.checked, [["w1"], ["w1"]], "the stale-worker preflight ran over the boxes each job captured on");
});

test("a third rejection fails the case, keeps all three attempts under rejected/, and writes nothing as evidence for the variant", async () => {
  const r = rig({ ids: ["fj-1", "fj-2", "fj-3"] });
  const fixtures = {
    "fj-1": datasetResults(r.root, "fj-1", { "x.good": EVIDENCE, "x.bad": NOT_EVIDENCE }),
    "fj-2": datasetResults(r.root, "fj-2", { "x.bad": NOT_EVIDENCE }, { attempt: 2, only: ["x.bad"] }),
    "fj-3": datasetResults(r.root, "fj-3", { "x.bad": NOT_EVIDENCE }, { attempt: 3, only: ["x.bad"] }),
  };
  r.configure({ ids: ["fj-1", "fj-2", "fj-3"], fixtures });
  const flow = r.flow(datasetCollector(r.io));
  const exit = await follow(flow, [submitX(r, flow)]);

  assert.equal(exit, 1, "the case failed");
  assert.deepEqual(readdirSync(join(r.captureRoot, "rejected")).sort(), ["x.bad.attempt1.json", "x.bad.attempt2.json", "x.bad.attempt3.json"]);
  assert.ok(!existsSync(join(r.captureRoot, "x.bad.json")), "a variant rejected three times is never written as evidence");
  assert.ok(existsSync(join(r.captureRoot, "x.good.json")), "the accepted variant was written when it was accepted");
  const failed = readProgress(r.corpus)!.cases.x;
  assert.equal(failed.status, "failed");
  assert.match(failed.reason, /after 3 attempts\. Not written as evidence; the rejected captures are in .* for diagnosis\./, "the message it fails with today");
  assert.equal(r.stub.calls().filter((c) => c.argv[1] === "recapture").length, 2, "two re-captures: the first attempt and two more make three, and no fourth is asked for");
});

test("a capture the worker lost is re-captured like a rejected one", async () => {
  const r = rig({ ids: ["fj-1", "fj-2"] });
  const lost = manifestFixture({
    job: "fj-1", boxes: [{ name: "w1", workerCode: "code-1", environment: ENVIRONMENT }],
    captures: [
      { case: "x.good", group: "x", url: `${BASE}/x/good.html`, box: "w1", body: { task: "t" } },
      { case: "x.bad", group: "x", url: `${BASE}/x/bad.html`, box: "w1", status: "failed", error: "worker forgot capture c1 after accepting it — it restarted mid-capture, so the work is gone and the case must be re-issued" },
    ],
  });
  const fixtures = {
    "fj-1": writeResults(join(r.root, "lost"), lost, { "x.good": EVIDENCE }),
    "fj-2": datasetResults(r.root, "fj-2", { "x.bad": EVIDENCE }, { attempt: 2, only: ["x.bad"] }),
  };
  r.configure({ ids: ["fj-1", "fj-2"], fixtures });
  const flow = r.flow(datasetCollector(r.io));
  assert.equal(await follow(flow, [submitX(r, flow)]), 0);
  assert.deepEqual(r.stub.recaptured("fj-2").cases, ["x.bad"]);
  assert.ok(existsSync(join(r.captureRoot, "x.bad.json")));
  assert.ok(r.logged.some((line) => /the worker restarted mid-capture and forgot this one; re-issuing/.test(line)));
});

test("a case whose box left the fleet is submitted again, whole, in a new job, once; a second loss fails it", async () => {
  const r = rig({ ids: ["fj-1", "fj-2"] });
  const gone = (job: string) => writeResults(join(r.root, `gone-${job}`), manifestFixture({
    job, boxes: [{ name: "w1", workerCode: "code-1", environment: ENVIRONMENT }],
    captures: ["good", "bad"].map((v) => ({ case: `x.${v}`, group: "x", url: `${BASE}/x/${v}.html`, box: "w1", status: "failed" as const, error: "w1 left the fleet: 3 captures in a row failed on it", body: { task: "t" } })),
  }), {});
  r.configure({ ids: ["fj-1", "fj-2"], fixtures: { "fj-1": gone("fj-1"), "fj-2": gone("fj-2") } });
  const flow = r.flow(datasetCollector(r.io));
  const exit = await follow(flow, [submitX(r, flow)]);

  assert.equal(exit, 1);
  const submits = r.stub.calls().filter((c) => c.argv[0] === "capture" && c.argv[1] === "submit");
  assert.equal(submits.length, 2, "the group was submitted again once, and not a third time");
  assert.equal(r.stub.calls().filter((c) => c.argv[1] === "recapture").length, 0, "a lost box is a resubmission of the whole group, not a re-capture pinned to the box that left");
  assert.deepEqual(r.stub.submittedCases("fj-2").cases.map((c) => c.id), ["x.good", "x.bad"], "both variants: a pair is only comparable from one box");
  assert.match(readProgress(r.corpus)!.cases.x.reason, /left the fleet a second time/);
});

test("a group the service skipped is reported cached, with no capture requested and no file written", async () => {
  const r = rig({ ids: ["fj-1"] });
  const skipped = manifestFixture({
    job: "fj-1", boxes: [{ name: "w1", workerCode: "code-1", environment: ENVIRONMENT }],
    captures: ["good", "bad"].map((v) => ({ case: `x.${v}`, group: "x", url: `${BASE}/x/${v}.html`, box: "w1", status: "skipped" as const })),
  });
  r.configure({ ids: ["fj-1"], fixtures: { "fj-1": writeResults(join(r.root, "skipped"), skipped, {}) } });
  const flow = r.flow(datasetCollector(r.io));
  assert.equal(await follow(flow, [submitX(r, flow)]), 0);
  assert.deepEqual(readProgress(r.corpus)!.cases.x, { status: "skipped", reason: "cached: unchanged" });
  assert.deepEqual(readdirSync(r.captureRoot), [], "nothing written for a cached case");
  assert.deepEqual(r.checked, [], "no capture was taken, so no box's code is asked about");
  assert.match(readProgress(r.corpus)!.outcome, /1 skipped \(1 cached\)/);
});

test("records from a box that does not run this checkout are not written, and the run ends naming the box", async () => {
  const r = rig({ ids: ["fj-1"] });
  r.configure({ ids: ["fj-1"], fixtures: { "fj-1": datasetResults(r.root, "fj-1", { "x.good": EVIDENCE, "x.bad": EVIDENCE }) } });
  const refuse = datasetCollector({ ...r.io, assertFleetRunsThisCheckout: async (boxes) => { throw new Error(`worker code on ${boxes.join(",")} is not this checkout's`); } });
  const flow = r.flow(refuse);
  await assert.rejects(follow(flow, [submitX(r, flow)]), /worker code on w1 is not this checkout's/);
  assert.deepEqual(readdirSync(r.captureRoot), [], "nothing was written from the stale box");
});

// ---- the flow: one wait, one budget, exit 75 -------------------------------------------------------------------------------------------------------------

test("with no wait the client prints the ID and the collect command, exits 75, and --collect finishes the job without waiting", async () => {
  const r = rig({ ids: ["fj-1"] }, { wait: null });
  r.configure({ ids: ["fj-1"], fixtures: { "fj-1": datasetResults(r.root, "fj-1", { "x.good": EVIDENCE, "x.bad": EVIDENCE }) } });
  const flow = r.flow(datasetCollector(r.io));
  const exit = await follow(flow, [submitX(r, flow)]);

  assert.equal(exit, 75);
  assert.deepEqual(r.stub.calls().map((c) => c.argv[1]), ["submit"], "submitted, and nothing waited on or fetched");
  assert.match(r.out.join(""), /^fj-1\n/, "the job ID on stdout");
  assert.match(r.err.join(""), /waitingOn: \[\{ "fleetJob": "fj-1" \}\]/, "the line to declare, so the board wakes the agent");
  assert.match(r.err.join(""), /collect it: --collect=fj-1/);
  assert.equal(readPending(r.corpus, "fj-1")?.kind, "dataset");
  assert.ok(!existsSync(join(r.captureRoot, "x.good.json")), "nothing is written for a job that has not been collected");

  assert.equal(await collectFlow(r.flow(datasetCollector({ ...r.io, progress: continueRun(r.corpus) })), undefined, "dataset"), 0);
  assert.ok(existsSync(join(r.captureRoot, "x.good.json")) && existsSync(join(r.captureRoot, "x.bad.json")), "--collect with no ID reads the newest pending job");
  assert.equal(r.stub.calls().filter((c) => c.argv[1] === "wait").length, 0, "and never waits");
  assert.ok(readPending(r.corpus, "fj-1")?.collectedAt, "a collected job is marked");
});

test("a wait that ends in 124 leaves the job running, says how to collect it, and fetches nothing", async () => {
  const r = rig({ ids: ["fj-1"], waitCodes: { "fj-1": 124 } });
  const flow = r.flow(datasetCollector(r.io));
  assert.equal(await follow(flow, [submitX(r, flow)]), 124);
  assert.deepEqual(r.stub.calls().map((c) => c.argv[1]), ["submit", "wait"]);
  assert.match(r.err.join(""), /still running; it goes on in the service\. collect it: --collect=fj-1/);
});

test("a job that fails or is cancelled stops the run with the code `job wait` gave, and fetches nothing", async () => {
  for (const code of [1, 3, 2]) {
    const r = rig({ ids: ["fj-1"], waitCodes: { "fj-1": code } });
    const flow = r.flow(datasetCollector(r.io));
    assert.equal(await follow(flow, [submitX(r, flow)]), code);
    assert.ok(!r.stub.calls().some((c) => c.argv[1] === "fetch"));
  }
});

test("one wait budget covers the submit and every re-capture: the second wait gets what the first left", async () => {
  let clock = 1_000_000;
  const r = rig({ ids: ["fj-1", "fj-2"] }, { wait: "1h", now: () => clock });
  const first = datasetResults(r.root, "fj-1", { "x.good": EVIDENCE, "x.bad": NOT_EVIDENCE });
  const second = datasetResults(r.root, "fj-2", { "x.bad": EVIDENCE }, { attempt: 2, only: ["x.bad"] });
  r.configure({ ids: ["fj-1", "fj-2"], fixtures: { "fj-1": first, "fj-2": second } });
  // Time passes while the first job runs: 40 minutes of the hour.
  const flow = r.flow(datasetCollector({ ...r.io, assertFleetRunsThisCheckout: async () => { clock += 40 * 60_000; } }));
  assert.equal(await follow(flow, [submitX(r, flow)]), 0);
  const waits = r.stub.calls().filter((c) => c.argv[1] === "wait").map((c) => c.argv[c.argv.indexOf("--timeout") + 1]);
  assert.deepEqual(waits, ["3600s", "1200s"], "the hour, then what the first job left of it");
});

// ---- the real pages -----------------------------------------------------------------------------------------------------------------------------------------

const PAGES = [
  { url: "https://www.w3.org/WAI/a/", role: "calibration", publishedClaim: "conforms", source: "w3.org", demonstrates: ["1.1.1"] },
  { url: "https://www.w3.org/WAI/b/", role: "calibration", publishedClaim: "conforms", source: "w3.org", demonstrates: [], formState: { name: "x" } },
  { url: "https://example.org/c", role: "training", publishedClaim: "partial", source: "example.org", demonstrates: [] },
];

test("real pages: a publisher's pages share a group, and every body is the curated policy exactly", () => {
  const job = realPagesJob({ pages: PAGES, out: "/out" });
  assert.deepEqual(job.cases.map((c) => c.group), ["www.w3.org", "www.w3.org", "example.org"], "grouped by publisher, so no site is ever captured twice at once");
  assert.equal(new Set(job.cases.map((c) => c.group)).size, 2);
  assert.deepEqual(job.cases[0]!.body, realPageBody(PAGES[0]!));
  assert.deepEqual(job.cases[1]!.body, { ...realPageBody(PAGES[0]!), formState: { name: "x" } }, "a declared form state travels with its page");
  assert.equal(job.cases[0]!.body.probeForms, false, "probeForms stays OFF on somebody else's live page");
  assert.equal(job.names[job.cases[0]!.id], "/out/www-w3-org-WAI-a.json", "the output keeps the name its readers read");
  assert.equal(publisherOf("http://localhost:5050/x/good.html"), "localhost-5050", "a port's colon is not a valid group character");
});

test("real pages: a case ID is a valid, unique, lower-case slug even for a long or colliding URL", () => {
  const long = `https://example.org/${"segment/".repeat(40)}`;
  const ids = caseIdsFor([PAGES[0]!.url, "https://WWW.w3.org/WAI/a/", long, "https://example.org/manifest"]);
  const values = [...ids.values()];
  assert.equal(new Set(values.map((v) => v.toLowerCase())).size, values.length, "unique, case-insensitively");
  for (const id of values) assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._+-]{0,160}$/);
  assert.notEqual(ids.get("https://example.org/manifest"), "manifest");
});

test("real pages: collect writes each page's record in the shape its readers read, and a wrong-page failure says the site probably moved it", async () => {
  const root = tempDir("real-pages-");
  const out = join(root, "corpus");
  mkdirSync(out, { recursive: true });
  const job = realPagesJob({ pages: PAGES.slice(0, 2), out });
  const [a, b] = job.cases;
  const manifest = manifestFixture({
    job: "fj-r", boxes: [{ name: "w1", workerCode: "c", environment: ENVIRONMENT }, { name: "w2", workerCode: "c", environment: ENVIRONMENT }],
    captures: [
      { case: a!.id, group: a!.group!, url: a!.url, box: "w1" },
      { case: b!.id, group: b!.group!, url: b!.url, box: "w1", status: "failed", error: "wrong page" },
    ],
  });
  const results = writeResults(join(root, "results"), manifest, { [a!.id]: { transcript: ["one", "two"], structure: {} } });
  // The failed page's record carries the worker's fault code, as the worker's 500 body does.
  writeFileSync(join(results, manifest.captures[1]!.file), JSON.stringify({ capturedAt: "x", worker: "w1", status: 500, capture: { error: "wrong page", fault: FAULT.WRONG_PAGE } }));
  const progress = beginRun({ root: out, worker: null, baseUrl: null, cases: PAGES.slice(0, 2).map((p) => ({ id: p.url })) });
  const logged: string[] = [];
  const recorded: string[] = [];
  const collect = realPagesCollector({
    out, progress, assertFleetRunsThisCheckout: async () => undefined, assertOneBrowser: async (m) => void recorded.push(`browser:${m.boxes.map((x) => x.name)}`),
    recordRun: (m) => void recorded.push(`run:${m.job}`), log: (line) => void logged.push(line),
  });
  const fetched = { job: "fj-r", dir: results, manifest, record: (c: { file: string }) => JSON.parse(readFileSync(join(results, c.file), "utf8")) };
  const outcome = await collect(fetched as never, { job: "fj-r", names: job.names, label: "A11-263", submittedAt: "x", kind: "real-pages", extra: { pages: job.described, wanted: PAGES.slice(0, 2).map((p) => p.url), total: 2, reused: 0, taken: 2 } });

  const written = JSON.parse(readFileSync(join(out, "www-w3-org-WAI-a.json"), "utf8"));
  assert.deepEqual(Object.keys(written), ["role", "publishedClaim", "claimSource", "demonstrates", "capturedAt", "capture"], "the shape its readers read");
  assert.equal(written.claimSource, "w3.org");
  assert.equal(written.capturedAt, "2026-10-25T00:05:00.000Z", "when the service took it, not when it was collected");
  assert.ok(!existsSync(join(out, "www-w3-org-WAI-b.json")), "a page that failed leaves no record behind");
  assert.equal(outcome.exit, 1);
  assert.ok(logged.some((line) => /FAILED: https:\/\/www\.w3\.org\/WAI\/b\/: wrong page/.test(line)));
  assert.ok(logged.some((line) => /the site probably MOVED this page/.test(line)));
  assert.ok(logged.some((line) => /1\/2 captured/.test(line)));
  assert.deepEqual(recorded, ["browser:w1,w2", "run:fj-r"], "the browser check and the run record, once, from the manifest");
  assert.match(readProgress(out)!.outcome, /1 of 2 captured, 1 failed/);
});

test("the flow reads the three inputs the catalogue sets, and a client with no label is refused before it submits", () => {
  const inputs = fleetInputs([], { A11Y_FLEET_BOXES: "ready", A11Y_FLEET_LABEL: "A11-263", A11Y_FLEET_WAIT: "28800s" });
  assert.deepEqual(inputs, { boxes: "ready", label: "A11-263", wait: "28800s" });
  assert.throws(() => fleetInputs([], { A11Y_FLEET_BOXES: "ready" }), /--label/);
});
