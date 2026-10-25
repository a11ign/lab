/**
 * The gates and the one-box harnesses that submit to the fleet job service (A11-263, step 4), driven end to end against a STUBBED service.
 *
 * `fleet` is a script the test writes and points `FLEET` at (`src/fleet/stub-fleet.ts`): it logs what it was asked, prints a job ID at once for a submit and a re-capture, exits with
 * a chosen code for `job wait`, and for `job fetch` copies a fixture results directory (a manifest in the shape control writes, and its records). Nothing reaches the control plane, a
 * box or a page server. Each test says what the client asked of the service, and what it said or wrote from the answer.
 *
 * What is driven is what each client is built from, because the clients' `main` leases a page server: the job it submits (`stabilityJob`, `probeOrderCases`, `checkCases`,
 * `occurrenceCases`, `rotationCases`, `fixtureCases`), the collector it hands the flow, and the runner (`runFleetClient`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

import { scratchDir as tempDir } from "../fleet/scratch-dir.ts";
import { stubFleet, manifestFixture, writeResults } from "../fleet/stub-fleet.ts";
import { REPO_ROOT } from "../dataset-paths.ts";
import { realFleet } from "../fleet/fleet-job.ts";
import { holdingPages, repeatedCases, runFleetClient, singleBox, slugOf, stopExitWith } from "../fleet/harness-flow.ts";
import { analyseRepeats } from "../training/repeat-analysis.ts";
import { REPEAT_ATTEMPTS, clearRepeatSet, repeatBody, repeatCollector, repeatJob } from "../training/repeat-fleet.ts";
import { CANARIES, reportSets, stabilityJob } from "../../scripts/stability-gate.ts";
import { PAGES, probeOrderCases, probeOrderCollector } from "../../scripts/gate-probe-order.ts";
import { checkCases, checkCollector, fleetModeRequested } from "./capture-check.ts";
import { fixtureCases, fixtureCollector } from "./capture-fixtures.ts";
import { occurrenceCases } from "./occurrence-cases.ts";
import { rotationCases, rotationCollector } from "./page-identity-rate.ts";
import { benchCollector } from "../../scripts/bench-capture.ts";

const BASE = "http://pages.test:5050";

// EVERYTHING A CLIENT WRITES UNDER `runs/` GOES TO A SCRATCH DIRECTORY: the captures a gate keeps, the pending files, the settled state of a check. The clients resolve their directories
// when they are called, so this is set once, before any test builds a job. A test that wrote under the real `runs/` would also read what an earlier run left there.
process.env.RUNS_ROOT = tempDir("fleet-harnesses-runs-");

/** A capture that reads like a page: some phrases, empty channels, nothing that makes the pipeline reject it. */
const capture = (...phrases: string[]) => ({
  transcript: phrases.length ? phrases : ["Aquarium schedule", "Departures from Central station"],
  structure: { headings: [], landmarks: [], formFields: [], graphics: [], links: [], lists: [], tableCells: [], frames: [] },
  interaction: { controls: [], stateChanges: [], formChanges: [], postSubmitFields: [], focusOrder: [], postSubmitNames: [] },
  diagnostics: [],
});

/**
 * Run a block with stdout, stderr and the console captured. Written by hand rather than with `node:test`'s `mock`: this suite runs under rstest in CI, whose `node:test` shim has no
 * `mock.restore`, and whose console is its own, so `console.log` does not reach `process.stdout.write` there.
 */
async function quietly<T>(body: () => Promise<T> | T): Promise<{ result: T; out: string }> {
  const lines: string[] = [];
  const originals = { stdout: process.stdout.write, stderr: process.stderr.write, log: console.log, info: console.info, warn: console.warn, error: console.error };
  const capture = (chunk: unknown): boolean => { lines.push(String(chunk)); return true; };
  const captureLine = (...args: unknown[]): void => { lines.push(`${format(...args)}\n`); };
  process.stdout.write = capture as typeof process.stdout.write;
  process.stderr.write = capture as typeof process.stderr.write;
  console.log = captureLine; console.info = captureLine; console.warn = captureLine; console.error = captureLine;
  try {
    return { result: await body(), out: lines.join("") };
  } finally {
    process.stdout.write = originals.stdout;
    process.stderr.write = originals.stderr;
    console.log = originals.log; console.info = originals.info; console.warn = originals.warn; console.error = originals.error;
  }
}

/** A stub service, the flow's dependencies wired to it, and a scratch root for pending files. */
function rig(config: Parameters<typeof stubFleet>[1]) {
  const root = tempDir("fleet-harnesses-");
  const stub = stubFleet(join(root, "stub"), config);
  const out: string[] = [];
  const err: string[] = [];
  const deps = { run: realFleet({ ...process.env, ...stub.env }), out: (t: string) => void out.push(t), err: (t: string) => void err.push(t) };
  /** Point the stub at the results directories once they exist: they are written from the rig's own `results()` paths, after it. */
  const serve = (fixtures: Record<string, string>) => writeFileSync(stub.env.STUB_CONFIG!, JSON.stringify({ ...config, fixtures }));
  return { root, stub, out, err, deps, serve, results: (name: string) => join(root, `results-${name}`), pending: join(root, "pending") };
}

const ARGV = ["--boxes=2", "--label=A11-263", "--wait=1h"];

test("the clients write under a scratch runs root in this file, never under the repository's", () => {
  // The positive control for the hermeticity above: the one thing every other test here relies on, so that a rename of RUNS_ROOT fails here rather than writing under the real `runs/`.
  const where = stabilityJob(BASE).extra.targets[0]!.outDir;
  assert.ok(where.startsWith(process.env.RUNS_ROOT!), `${where} is not under the scratch runs root`);
  assert.ok(!where.startsWith(REPO_ROOT), `${where} is under the repository`);
});

// ---- gate:stability — one job, a group per canary ---------------------------------------------------------------------------------------------------------

test("gate:stability submits ONE job with a group per canary, each canary's repeats the same page and body on one box", async () => {
  const r = rig({ ids: ["fj-1"], fixtures: {} });
  const job = freshStabilityJob();
  r.serve({ "fj-1": stabilityResults(r, "fj-1", job, { capturesOf: () => capture() }) });
  await quietly(() => runFleetClient({ argv: ARGV, root: r.pending, kind: "stability-gate", hint: (id) => `collect ${id}`, deps: r.deps, prepare: async () => job, collect: async () => ({ recapture: [], exit: 0 }) }));

  const { cases, groups } = r.stub.submittedCases("fj-1");
  const groupNames = Object.keys(groups);
  assert.equal(groupNames.length, CANARIES.length, "a group per canary");
  assert.equal(new Set(cases.map((c) => c.group)).size, CANARIES.length);
  for (const group of groupNames) {
    const repeats = cases.filter((c) => c.group === group);
    assert.equal(repeats.length, 5, `${group}: the canary is captured five times`);
    assert.equal(new Set(repeats.map((c) => c.url)).size, 1, `${group}: the same page every time`);
    assert.equal(new Set(repeats.map((c) => JSON.stringify(c.body))).size, 1, `${group}: the same body every time, so a difference between them is the pipeline's`);
    assert.deepEqual(repeats.map((c) => c.id), [1, 2, 3, 4, 5].map((n) => `${group}.${n}`), "in order");
    assert.equal((repeats[0]?.body as Record<string, unknown>).reuseScreenReader, false, "fresh NVDA each repeat");
  }
  // A corpus canary is on the page server; a live one is its own URL; and the probes a canary asks for are the only ones in its body.
  assert.ok(cases.some((c) => c.url === `${BASE}/form-unlabelled/good`));
  assert.ok(cases.some((c) => c.url.startsWith("https://www.w3.org/")));
  const forms = cases.find((c) => c.group === slugOf("form-error-silent/good"));
  assert.equal((forms?.body as Record<string, unknown>).probeForms, true);
  assert.match(String((forms?.body as Record<string, unknown>).task), /Submit the request/);
  const plain = cases.find((c) => c.group === slugOf("form-unlabelled/good"));
  assert.equal("probeForms" in (plain?.body ?? {}), false, "no probe unless the canary asks");
  assert.equal(r.stub.calls().filter((c) => c.argv[0] === "capture").length, 1, "ONE submit for the whole gate");
  assert.ok(r.stub.calls()[0]?.argv.includes("--cases") && !r.stub.calls()[0]?.argv.includes("--pages"), "a job of cases, not of pages");
});

/** Results of the stability job: every canary's repeats on a box, each repeat as `capturesOf` says. */
function stabilityResults(r: ReturnType<typeof rig>, job: string, jobSpec: ReturnType<typeof stabilityJob>, { capturesOf, failed = {} }: { capturesOf: (caseId: string) => unknown; failed?: Record<string, { error: string; attempt?: number }> }) {
  const manifest = manifestFixture({
    job, boxes: [{ name: "w1" }, { name: "w2" }],
    captures: jobSpec.cases.map((c) => ({
      case: c.id, group: String(c.group), url: c.url, box: Number([...Object.keys(jobSpec.groups)].indexOf(String(c.group))) % 2 === 0 ? "w1" : "w2", body: c.body,
      ...(failed[c.id] ? { status: "failed" as const, error: failed[c.id]?.error, attempt: failed[c.id]?.attempt ?? 1 } : {}),
    })),
  });
  return writeResults(r.results(job), manifest, Object.fromEntries(jobSpec.cases.map((c) => [c.id, capturesOf(c.id)])));
}

/** The job the gate submits, with the directories its captures are kept in emptied, as the gate does before it submits. */
function freshStabilityJob(): ReturnType<typeof stabilityJob> {
  const job = stabilityJob(BASE);
  for (const target of job.extra.targets) clearRepeatSet(target);
  return job;
}

/** Run the stability gate's collector against a rig whose service holds `fixtures`. */
const judgeStability = (r: ReturnType<typeof rig>, spec: ReturnType<typeof stabilityJob>) => quietly(() => runFleetClient({
  argv: ARGV, root: r.pending, kind: "stability-gate", hint: String, deps: r.deps,
  // As the gate's own prepare does: what an earlier run left in a canary's directory is not this run's capture.
  prepare: async () => { for (const target of spec.extra.targets) clearRepeatSet(target); return spec; }, collect: repeatCollector((sets) => reportSets(sets), { log: (line) => process.stdout.write(`${line}\n`) }),
}));

test("gate:stability reads its verdict from the records: identical repeats PASS, and a field that varies FAILS and names the field", async () => {
  const spec = freshStabilityJob();
  const ok = rig({ ids: ["fj-1"], fixtures: {} });
  ok.serve({ "fj-1": stabilityResults(ok, "fj-1", spec, { capturesOf: () => capture() }) });
  const stable = await judgeStability(ok, spec);
  assert.equal(stable.result, 0, `a stable gate exits 0:\n${stable.out}`);
  assert.match(stable.out, /STABLE — 5 usable, all fields identical/);
  assert.match(stable.out, /WHERE THE WORK LANDED[\s\S]*w1 +5 item\(s\)[\s\S]*w2 +4 item\(s\)/, "the boxes the groups landed on are named");

  const varying = rig({ ids: ["fj-1"], fixtures: {} });
  varying.serve({ "fj-1": stabilityResults(varying, "fj-1", spec, { capturesOf: (id) => (id === `${slugOf("image-missing-alt/good")}.3` ? capture("Aquarium schedule", "Departures from Elsewhere") : capture()) }) });
  const unstable = await judgeStability(varying, spec);
  assert.equal(unstable.result, 1, "evidence that varies for an unchanged page fails the gate");
  assert.match(unstable.out, /VARIES +transcript/);
  assert.match(unstable.out, /UNSTABLE image-missing-alt\/good on w\d/);
  assert.match(unstable.out, /Do NOT start a corpus run/);
});

test("gate:stability captures a transient failure AGAIN, asking the service for that repeat alone, and a fault that is not transient is not retried", async () => {
  const spec = freshStabilityJob();
  const group = slugOf("image-missing-alt/good");
  const flaky = `${group}.2`;
  const r = rig({ ids: ["fj-1", "fj-2"], fixtures: {} });
  const second = manifestFixture({
    job: "fj-2", recaptureOf: "fj-1", boxes: [{ name: "w2" }],
    captures: [{ case: flaky, group, url: `${BASE}/image-missing-alt/good`, box: "w2", attempt: 2, body: {} }],
  });
  r.serve({
    "fj-1": stabilityResults(r, "fj-1", spec, { capturesOf: () => capture(), failed: { [flaky]: { error: "socket hang up" } } }),
    "fj-2": writeResults(r.results("fj-2"), second, { [flaky]: capture() }),
  });
  const run = await judgeStability(r, spec);

  assert.deepEqual(r.stub.recaptured("fj-2"), { source: "fj-1", cases: [flaky], label: "A11-263" }, "only the repeat that failed, from the job that took it");
  assert.equal(run.result, 0, `once the repeat is captured the canary has five usable captures:\n${run.out}`);
  assert.match(run.out, /transient .* capturing .* again on w\d/);
  assert.equal(r.stub.calls().filter((c) => c.argv[1] === "wait").length, 2, "one wait per job, and no more");

  // A fault that says nothing of the infrastructure is the page's: it is not captured again, and the canary is short of its repeats.
  const hard = rig({ ids: ["fj-1"], fixtures: {} });
  hard.serve({ "fj-1": stabilityResults(hard, "fj-1", spec, { capturesOf: () => capture(), failed: { [flaky]: { error: "HTTP 400: the url is not allowed" } } }) });
  const stopped = await judgeStability(hard, spec);
  assert.equal(hard.stub.calls().filter((c) => c.argv[1] === "recapture").length, 0, "a fault that is not transient is never captured again");
  assert.equal(stopped.result, 2, "four usable repeats compare, but the canary with an errored repeat is unjudgeable: INCONCLUSIVE, never a pass");
  assert.match(stopped.out, /INCONCLUSIVE — 1 capture\(s\) errored: FAILED +2: HTTP 400/);

  // And the limit: the third attempt that fails is the last.
  const worn = rig({ ids: ["fj-1"], fixtures: {} });
  worn.serve({ "fj-1": stabilityResults(worn, "fj-1", spec, { capturesOf: () => capture(), failed: { [flaky]: { error: "socket hang up", attempt: REPEAT_ATTEMPTS } } }) });
  await judgeStability(worn, spec);
  assert.equal(worn.stub.calls().filter((c) => c.argv[1] === "recapture").length, 0, `a repeat is captured ${REPEAT_ATTEMPTS} times in all`);
});

test("a canary with too few usable captures is INCONCLUSIVE and reduces coverage — it is never a pass", async () => {
  const spec = freshStabilityJob();
  const r = rig({ ids: ["fj-1"], fixtures: {} });
  r.serve({ "fj-1": stabilityResults(r, "fj-1", spec, { capturesOf: (id) => (id.startsWith(slugOf("image-missing-alt/good")) ? { ...capture(), transcript: [] } : capture()) }) });
  const run = await judgeStability(r, spec);
  assert.equal(run.result, 2, "INCONCLUSIVE exits 2, not 0");
  assert.match(run.out, /INCONCLUSIVE — only 0 usable capture\(s\) — could not judge/);
});

test("a job that FAILED is INCONCLUSIVE, not 'a canary was unstable' (1 means unstable here)", async () => {
  const spec = freshStabilityJob();
  const r = rig({ ids: ["fj-1"], waitCodes: { "fj-1": 1 }, fixtures: {} });
  const run = await quietly(() => runFleetClient({
    argv: ARGV, root: r.pending, kind: "stability-gate", hint: String, deps: r.deps, prepare: async () => spec,
    stopExit: (code) => (code === 75 || code === 124 ? code : 2), collect: repeatCollector((sets) => reportSets(sets)),
  }));
  assert.equal(run.result, 2);
});

// ---- the repeat analysis ------------------------------------------------------------------------------------------------------------------------------------

test("analyseRepeats: identical captures are stable, a varying field is named with its variants, and fewer than two usable is 'nothing to compare'", () => {
  const same = analyseRepeats({ raw: [capture(), capture(), capture()], errors: [], times: 3, reuse: false, outDir: "/runs/x" });
  assert.equal(same.exit, 0);
  assert.match(same.stdout, /3\/3 usable .*fresh NVDA each time/);
  assert.match(same.stdout, /All compared fields are stable\./);
  assert.match(same.stdout, /sockets recovered: not reported/, "the transport counts are said to be missing, not zero");

  const varies = analyseRepeats({ raw: [capture(), capture("Aquarium schedule", "Departures from Elsewhere")], errors: ["3: socket hang up"], times: 3, reuse: true, outDir: "/runs/x" });
  assert.equal(varies.exit, 1);
  assert.match(varies.stdout, /VARIES +transcript +counts 2,2 across runs/);
  assert.match(varies.stdout, /FAILED +3: socket hang up/);
  assert.match(varies.stdout, /reused NVDA each time/);

  const none = analyseRepeats({ raw: [capture()], errors: ["2: boom"], times: 2, reuse: false, outDir: "/runs/x" });
  assert.equal(none.tooFew, true);
  assert.equal(none.exit, 1);
  assert.match(none.stderr, /Only 1 usable capture\(s\); nothing to compare\./);
  assert.match(none.stderr, /2: boom/);
});

test("repeatBody leaves out a probe nobody asked for, and names the task the probe-forms needs", () => {
  assert.deepEqual(repeatBody({}), { steps: 10, probeTables: false, reuseScreenReader: false });
  assert.deepEqual(repeatBody({ probeForms: true, task: "Go.", probeFocus: true, probeNavigation: true, browser: "Chrome", reuse: true, probeTables: true, steps: 5 }),
    { steps: 5, probeTables: true, reuseScreenReader: true, browser: "Chrome", probeForms: true, probeFocus: true, probeNavigation: true, task: "Go." });
});

test("two repeat groups of one name are refused: a job holds one of each", () => {
  const target = { group: "a", url: "http://x/a", outDir: "/tmp/a", times: 2, body: {} };
  assert.throws(() => repeatJob([target, { ...target }]), /two repeat groups are named a/);
  assert.equal(repeatedCases({ group: "g", url: "u", body: { x: 1 }, times: 3 }).map((c) => c.id).join(), "g.1,g.2,g.3");
});

// ---- gate:probe-order — one group of three per page ---------------------------------------------------------------------------------------------------------

/** Results of a probe-order job: each page's three captures on a box, `failed` naming cases that did not come back. */
function probeOrderResults(r: ReturnType<typeof rig>, job: string, cases: ReturnType<typeof probeOrderCases>["cases"], failed: string[] = []) {
  const manifest = manifestFixture({
    job, boxes: [{ name: "w1" }, { name: "w2" }],
    captures: cases.map((c) => ({ case: c.id, group: String(c.group), url: c.url, box: [...new Set(cases.map((x) => x.group))].indexOf(c.group) % 2 === 0 ? "w1" : "w2", body: c.body, ...(failed.includes(c.id) ? { status: "failed" as const, error: "capture timed out" } : {}) })),
  });
  // B carries the mark of the browse-mode remedy having run, which the gate reads: agreement without it is agreement by luck.
  const remedied = { ...capture(), diagnostics: [{ event: "establishBrowseMode" }] };
  return writeResults(r.results(job), manifest, Object.fromEntries(cases.map((c) => [c.id, c.id.endsWith(".b") ? remedied : capture()])));
}

test("gate:probe-order sends each page as ONE group of three — A1, B (focus-first), A2 — in that order, with exactly those bodies", () => {
  const { cases, groups } = probeOrderCases(PAGES, BASE);
  assert.equal(Object.keys(groups).length, PAGES.length, "a group per page");
  for (const page of PAGES) {
    const group = slugOf(page.url ?? page.path);
    const three = cases.filter((c) => c.group === group);
    assert.deepEqual(three.map((c) => c.id), [`${group}.a1`, `${group}.b`, `${group}.a2`], "A1, B, A2, in that order");
    assert.equal(new Set(three.map((c) => c.url)).size, 1, "all three are the same page");
    assert.deepEqual(three.map((c) => (c.body as Record<string, unknown>).probeOrder), [undefined, "focus-first", undefined], "only B changes the order");
    for (const c of three) assert.deepEqual({ ...c.body, probeOrder: undefined }, { task: "Read the page and reach its controls.", probeFocus: true, probeForms: false, probeNavigation: false, probeOrder: undefined });
  }
  assert.ok(cases.some((c) => c.url === `${BASE}/image-missing-alt-behind-consent/good.html`), "a corpus page is on the page server");
  assert.ok(cases.some((c) => c.url === "https://www.nls.uk/join/"), "a live page is its own URL");
});

/** Run the probe-order gate's collector against a rig whose service holds `fixtures`. */
const judgeProbeOrder = (r: ReturnType<typeof rig>, spec: ReturnType<typeof probeOrderCases>) => quietly(() => runFleetClient({
  argv: ARGV, root: r.pending, kind: "gate-probe-order", hint: String, deps: r.deps, collect: probeOrderCollector(),
  prepare: async () => ({ ...spec, extra: { round: 1, base: BASE, settled: {} } }),
}));

test("gate:probe-order judges a page from its three records, and the verdict is the fleet's", async () => {
  const spec = probeOrderCases(PAGES, BASE);
  const r = rig({ ids: ["fj-1"], fixtures: {} });
  r.serve({ "fj-1": probeOrderResults(r, "fj-1", spec.cases) });
  const run = await judgeProbeOrder(r, spec);
  assert.equal(run.result, 0, `every page agrees across orders:\n${run.out}`);
  assert.match(run.out, /WHERE THE WORK LANDED/);
  assert.match(run.out, /SAME +image-missing-alt-behind-consent\/good/);
  assert.equal(r.stub.calls().filter((c) => c.argv[0] === "capture").length, 1, "all pages came back, so nothing is submitted again");
});

test("gate:probe-order submits a page whose captures failed AGAIN, whole, once — and a second failure is INCONCLUSIVE (exit 2)", async () => {
  const spec = probeOrderCases(PAGES, BASE);
  const lost = PAGES[2]!;
  const lostGroup = slugOf(lost.url ?? lost.path);
  const again = probeOrderCases([lost], BASE);

  // The page comes back on the second try.
  const ok = rig({ ids: ["fj-1", "fj-2"], fixtures: {} });
  ok.serve({ "fj-1": probeOrderResults(ok, "fj-1", spec.cases, [`${lostGroup}.b`]), "fj-2": probeOrderResults(ok, "fj-2", again.cases) });
  const recovered = await judgeProbeOrder(ok, spec);
  const resubmitted = ok.stub.submittedCases("fj-2");
  assert.deepEqual(resubmitted.cases.map((c) => c.id), [`${lostGroup}.a1`, `${lostGroup}.b`, `${lostGroup}.a2`], "the whole page, all three, in a new job");
  assert.deepEqual(Object.keys(resubmitted.groups), [lostGroup]);
  assert.equal(recovered.result, 0, `with the page back every page is compared:\n${recovered.out}`);

  // It fails again: no third submit, and the page is not compared.
  const no = rig({ ids: ["fj-1", "fj-2", "fj-3"], fixtures: {} });
  no.serve({ "fj-1": probeOrderResults(no, "fj-1", spec.cases, [`${lostGroup}.b`]), "fj-2": probeOrderResults(no, "fj-2", again.cases, [`${lostGroup}.a2`]) });
  const stuck = await judgeProbeOrder(no, spec);
  assert.equal(no.stub.calls().filter((c) => c.argv[0] === "capture").length, 2, "the first submit and ONE more");
  assert.equal(stuck.result, 2, `INCONCLUSIVE:\n${stuck.out}`);
  assert.match(stuck.out, /INCONCLUSIVE .* on w\d: /);
});

// ---- capture:check — six cases, each with its own body ------------------------------------------------------------------------------------------------------

test("capture:check sends the six tutorial pages as six cases, each with its own body", () => {
  const cases = checkCases(BASE);
  assert.equal(cases.length, 6);
  assert.deepEqual(cases.map((c) => c.id), ["structure-good.html", "structure-bad.html", "disclosure-good.html", "disclosure-bad.html", "forms-validation-good.html", "forms-validation-bad.html"]);
  assert.deepEqual(cases.map((c) => (c.body as Record<string, unknown>).probeForms), [false, false, false, false, true, true], "probeForms on the two form pages only");
  for (const c of cases) assert.equal((c.body as Record<string, unknown>).steps, 40);
  assert.equal(cases[0]?.url, `${BASE}/structure-good.html`);
  assert.equal(new Set(cases.map((c) => c.group)).size, 1, "no group is asked for: the six spread over the boxes the job booked");
  assert.equal(cases.filter((c) => c.group !== undefined).length, 0);
});

test("capture:check captures a page whose identity is NOT confirmed again, on its box, up to four attempts in all", async () => {
  const cases = checkCases(BASE);
  const wrong = { ...capture("Cannot reach this site", "Try again") };
  const outcomeFor = (attempt: number) => {
    const seed = rig({ ids: [], fixtures: {} });
    const manifest = manifestFixture({
      job: `fj-${attempt}`, recaptureOf: attempt > 1 ? "fj-1" : null, boxes: [{ name: "w1" }],
      captures: (attempt === 1 ? cases : cases.filter((c) => c.id === "structure-good.html")).map((c) => ({ case: c.id, group: c.id, url: c.url, box: "w1", attempt, body: c.body })),
    });
    return writeResults(seed.results(`fj-${attempt}`), manifest, Object.fromEntries(cases.map((c) => [c.id, wrong])));
  };
  const r = rig({ ids: ["fj-1", "fj-2", "fj-3", "fj-4"], fixtures: { "fj-1": outcomeFor(1), "fj-2": outcomeFor(2), "fj-3": outcomeFor(3), "fj-4": outcomeFor(4) } });
  const run = await quietly(() => runFleetClient({
    argv: ARGV, root: r.pending, kind: "capture-check", hint: String, deps: r.deps, collect: checkCollector(),
    stopExit: (code) => (code === 75 || code === 124 ? code : 2),
    prepare: async () => ({ cases, groups: {}, extra: { runId: "run-1" } }),
  }));
  const recaptures = r.stub.calls().filter((c) => c.argv[1] === "recapture");
  assert.equal(recaptures.length, 3, "attempts 2, 3 and 4 are each a re-capture");
  assert.deepEqual(r.stub.recaptured("fj-2").cases.sort(), cases.map((c) => c.id).sort(), "the first re-capture asks for the pages whose identity was not confirmed");
  assert.equal(run.result, 1, "a page never read fails the check");
  assert.match(run.out, /attempt 1\/4: page identity NOT confirmed/);
  assert.match(run.out, /FAIL {2}page identity NOT confirmed after 4 attempts/);
  assert.match(run.out, /CAPTURE CHECK\(S\) FAILED/);
});

// ---- the one-box harnesses — one group, in the order the measurement needs ----------------------------------------------------------------------------------

test("verdict:stability is ONE group: good three times, then bad three times, with the same body", () => {
  const cases = occurrenceCases(BASE);
  assert.deepEqual(cases.map((c) => c.id), ["good.1", "good.2", "good.3", "bad.1", "bad.2", "bad.3"]);
  assert.equal(new Set(cases.map((c) => c.group)).size, 1, "one group, so one box");
  assert.deepEqual(cases.map((c) => c.url.split("/").at(-1)), ["good.html", "good.html", "good.html", "bad.html", "bad.html", "bad.html"]);
  assert.equal(new Set(cases.map((c) => JSON.stringify(c.body))).size, 1);
  assert.equal((cases[0]?.body as Record<string, unknown>).probeForms, true);
});

test("identity:rate is ONE group of rounds x 3, rotating A→B→C, so every capture has a different predecessor on the same box", () => {
  const cases = rotationCases(BASE, 2);
  assert.equal(cases.length, 6);
  assert.deepEqual(cases.map((c) => c.id.split(".")[0]), ["000", "001", "002", "003", "004", "005"], "the position is in the ID, so the order the report reads back is the order they ran");
  assert.deepEqual(cases.map((c) => c.url.split("/").at(-1)), ["structure-good.html", "disclosure-good.html", "forms-validation-good.html", "structure-good.html", "disclosure-good.html", "forms-validation-good.html"]);
  assert.equal(new Set(cases.map((c) => c.group)).size, 1);
});

test("identity:rate reads the rotation back in order and counts a wrong page only against its predecessor", async () => {
  const cases = rotationCases(BASE, 1);
  const seed = rig({ ids: [], fixtures: {} });
  const manifest = manifestFixture({
    job: "fj-1", boxes: [{ name: "w1" }],
    captures: cases.map((c) => ({ case: c.id, group: "identity-rotation", url: c.url, box: "w1", body: c.body })),
  });
  const reused = (phrases: string[]) => ({ ...capture(...phrases), diagnostics: [{ event: "browserReused" }, { event: "documentReady", title: "t" }] });
  // The second capture reads the FIRST page's content: a stale buffer.
  const dir = writeResults(seed.results("fj-1"), manifest, {
    [cases[0]!.id]: reused(["banner landmark, City Library"]),
    [cases[1]!.id]: reused(["banner landmark, City Library"]),
    [cases[2]!.id]: reused(["Newsletter, heading, level 1"]),
  });
  const r = rig({ ids: ["fj-1"], fixtures: { "fj-1": dir } });
  const run = await quietly(() => runFleetClient({
    argv: ARGV, root: r.pending, kind: "identity-rate", hint: String, deps: r.deps, collect: rotationCollector(),
    stopExit: (code) => (code === 75 || code === 124 ? code : 3),
    prepare: async () => ({ cases, groups: { "identity-rotation": {} } }),
  }));
  assert.equal(run.result, 1, "a wrong page exits 1");
  assert.match(run.out, /disclosure-good\.html +reused +wrong-page .*\(read structure-good\.html\)/);
  assert.match(run.out, /WRONG-PAGE RATE: 1\/3/);
});

test("eval:capture writes each fixture from the record, in the place `npm run eval` reads, and exits 1 when one failed", async () => {
  const set = "tutorials";
  const cases = fixtureCases(["menu-good", "menu-bad"], BASE, 150, set);
  assert.deepEqual(cases.map((c) => [c.id, c.group, (c.body as Record<string, unknown>).probeForms]), [["menu-good", set, true], ["menu-bad", set, true]], "one group, with probeForms on");
  const seed = rig({ ids: [], fixtures: {} });
  const manifest = manifestFixture({
    job: "fj-1", boxes: [{ name: "w1" }],
    captures: cases.map((c) => ({ case: c.id, group: set, url: c.url, box: "w1", body: c.body, ...(c.id === "menu-bad" ? { status: "failed" as const, error: "the worker lost it" } : {}) })),
  });
  const dir = writeResults(seed.results("fj-1"), manifest, { "menu-good": capture("a", "b") });
  const outDir = join(seed.root, "fixtures", set);
  const r = rig({ ids: ["fj-1"], fixtures: { "fj-1": dir } });
  const run = await quietly(() => runFleetClient({
    argv: ARGV, root: r.pending, kind: "capture-fixtures", hint: String, deps: r.deps, collect: fixtureCollector(),
    prepare: async () => ({ cases, groups: { [set]: {} }, extra: { set, outDir } }),
  }));
  assert.equal(run.result, 1);
  assert.ok(existsSync(join(outDir, "menu-good.json")), "the fixture that came back is written");
  assert.equal(existsSync(join(outDir, "menu-bad.json")), false, "and the one that did not is not");
  assert.equal(JSON.parse(readFileSync(join(outDir, "menu-good.json"), "utf8")).transcript.length, 2);
  assert.match(run.out, /FAILED +menu-bad: the worker lost it/);
  assert.match(run.out, /1\/2 recaptured from tutorials on w1/);
});

test("bench:capture times each sample from the manifest and says how many failed", async () => {
  const cases = repeatedCases({ group: "bench", url: `${BASE}/p.html`, body: { task: "Benchmark the capture cost" }, times: 3 });
  const seed = rig({ ids: [], fixtures: {} });
  const manifest = manifestFixture({ job: "fj-1", boxes: [{ name: "w1" }], captures: cases.map((c, i) => ({ case: c.id, group: "bench", url: c.url, box: "w1", body: c.body, ...(i === 2 ? { status: "failed" as const, error: "boom" } : {}) })) });
  manifest.captures.forEach((entry: { startedAt: string | null; finishedAt: string | null }, i) => {
    if (i === 1) return; // the service recorded no timing for this one: it is no timing sample
    entry.startedAt = "2026-10-25T00:00:00.000Z"; entry.finishedAt = `2026-10-25T00:00:${10 + i}.000Z`;
  });
  const dir = writeResults(seed.results("fj-1"), manifest, { "bench.1": { ...capture("a"), diagnostics: [{ event: "nvdaStart", reused: true, atMs: 100 }] }, "bench.2": capture("a") });
  const r = rig({ ids: ["fj-1"], fixtures: { "fj-1": dir } });
  const run = await quietly(() => runFleetClient({
    argv: ARGV, root: r.pending, kind: "bench-capture", hint: String, deps: r.deps, collect: benchCollector(),
    prepare: async () => ({ cases, groups: { bench: {} }, extra: { count: 3 } }),
  }));
  assert.equal(run.result, 0);
  assert.match(run.out, /capture 1\/3: 10\.0s, 1 phrases/);
  assert.match(run.out, /capture 2\/3: FAILED the service recorded no start or end time/, "a sample with no timing is not a 0 s capture");
  assert.match(run.out, /capture 3\/3: FAILED boom/, "and a failure keeps its own number");
  assert.match(run.out, /2 of 3 sample\(s\) failed/);
  assert.match(run.out, /NVDA reused on 1\/1 captures/);
});

// ---- a box is named, never addressed ------------------------------------------------------------------------------------------------------------------------

test("a one-box harness takes a box NAME and refuses an address, naming the form that works — before `fleet` runs", async () => {
  assert.deepEqual(singleBox(["--label=A11-263"], {}), ["--label=A11-263", "--boxes=1"], "one box, whichever is free, when none is named");
  assert.deepEqual(singleBox(["--box=a11y-worker-14", "--label=A11-263"], {}), ["--label=A11-263", "--boxes=a11y-worker-14"]);
  assert.deepEqual(singleBox(["--label=A11-263"], {}, "a11y-worker-15"), ["--label=A11-263", "--boxes=a11y-worker-15"], "the positional where it was an address");
  assert.deepEqual(singleBox(["--label=A11-263"], { A11Y_FLEET_BOXES: "ready" }), ["--label=A11-263"], "the job catalogue's boxes are not overridden");
  for (const address of ["http://192.0.2.10:8765", "192.0.2.10", "192.0.2.10:8765", "worker.example:8765"]) {
    assert.throws(() => singleBox([], {}, address), /a box is named, never addressed.*--box=<box name>/, address);
  }
  assert.throws(() => singleBox(["--box=14"], {}), /one box's name/, "a bare number is a count of boxes, not a name");

  const r = rig({ ids: ["fj-1"], fixtures: {} });
  const refused = await quietly(() => runFleetClient({ argv: ["--label=A11-263", "--wait=1h"], root: r.pending, kind: "x", hint: String, deps: r.deps, oneBox: { positional: "http://192.0.2.10:8765" }, prepare: async () => ({ cases: [] }), collect: async () => ({ recapture: [], exit: 0 }) }));
  assert.equal(refused.result, 2);
  assert.equal(r.stub.calls().length, 0, "refused before `fleet` ran");
  assert.match(r.err.join(""), /a box is named, never addressed/);
});

test("a worker address on a gate is refused, naming the new form, unless the job catalogue sets A11Y_FLEET_BOXES — and then it is ignored with a line", async () => {
  const r = rig({ ids: [], fixtures: {} });
  const refused = await quietly(() => runFleetClient({ argv: ["--worker=http://192.0.2.10:8765", "--label=A11-263"], env: {}, root: r.pending, kind: "x", hint: String, deps: r.deps, prepare: async () => ({ cases: [] }), collect: async () => ({ recapture: [], exit: 0 }) }));
  assert.equal(refused.result, 2);
  assert.match(r.err.join(""), /a worker address is not taken any more.*--boxes=/);
  assert.equal(r.stub.calls().length, 0);

  const ignoring = rig({ ids: ["fj-1"], fixtures: {} });
  mkdirSync(ignoring.pending, { recursive: true });
  await quietly(() => runFleetClient({
    argv: ["--worker=http://192.0.2.10:8765", "--label=A11-263"], env: { A11Y_FLEET_BOXES: "2" }, root: ignoring.pending, kind: "x", hint: String, deps: ignoring.deps,
    prepare: async () => ({ cases: [{ id: "a", url: "http://x/a", body: {} }] }), collect: async () => ({ recapture: [], exit: 0 }),
  }));
  assert.match(ignoring.err.join(""), /ignoring the worker address\(es\) given/);
  assert.equal(ignoring.stub.calls().filter((c) => c.argv[0] === "capture").length, 1, "and the job is submitted");
});

test("with no wait a gate prints the job ID and exits 75: a pipeline that forgot to say how long to wait stops, and judges nothing", async () => {
  const r = rig({ ids: ["fj-1"], fixtures: {} });
  const run = await quietly(() => runFleetClient({
    argv: ["--boxes=2", "--label=A11-263"], env: {}, root: r.pending, kind: "stability-gate", hint: (id) => `collect ${id}`, deps: r.deps,
    prepare: async () => freshStabilityJob(), collect: repeatCollector((sets) => reportSets(sets)),
  }));
  assert.equal(run.result, 75);
  assert.equal(r.stub.calls().filter((c) => c.argv[1] === "wait").length, 0, "no wait was run");
  assert.match(r.out.join(""), /^fj-1\n/);
  assert.match(r.err.join(""), /waitingOn: \[\{ "fleetJob": "fj-1" \}\]/);
});

// ---- the shell around the flow ------------------------------------------------------------------------------------------------------------------------------

test("stopExitWith keeps the run's own 75 and 124 and maps every other stop to the client's 'could not answer'", () => {
  const stop = stopExitWith(2);
  assert.deepEqual([75, 124, 1, 3, 2].map(stop), [75, 124, 2, 2, 2]);
  assert.equal(stopExitWith(3)(1), 3);
});

test("a leased page server is put back when the job cannot be built, and a release that fails is said, not thrown", async () => {
  let released = 0;
  const lease = { started: true, release: async () => { released += 1; } };
  await assert.rejects(holdingPages(lease, () => { throw new Error("no job"); }), /no job/);
  assert.equal(released, 1, "released at once when the job could not be built");

  const prepared = await holdingPages(lease, () => ({ cases: [{ id: "a", url: "http://x/a", body: {} }] }));
  assert.equal(prepared.startedPageServer, true);
  await prepared.release?.();
  assert.equal(released, 2, "and again when the run ends");

  const broken = await holdingPages({ release: async () => { throw new Error("EPERM"); } }, () => ({ cases: [] }));
  assert.equal(broken.startedPageServer, false, "a lease this process did not start is reported as such");
  const quiet = await quietly(() => broken.release?.());
  assert.match(quiet.out, /page server release failed: EPERM/);
});

// ---- what the review of this step found ---------------------------------------------------------------------------------------------------------------------

test("a failure that is not a refusal in words (`fleet` missing, the service down) exits with the client's 'could not answer', never with the code that is a verdict", async () => {
  const root = tempDir("fleet-harnesses-nofleet-");
  const err: string[] = [];
  const deps = { run: realFleet({ ...process.env, FLEET: join(root, "no-such-fleet") }), out: () => {}, err: (t: string) => void err.push(t) };
  const run = await quietly(() => runFleetClient({
    argv: ARGV, root: join(root, "pending"), kind: "x", hint: String, deps, stopExit: stopExitWith(3),
    prepare: async () => ({ cases: [{ id: "a", url: "http://x/a", body: {} }] }), collect: async () => ({ recapture: [], exit: 0 }),
  }));
  assert.equal(run.result, 3, "identity:rate's 3, 'measured nothing', and not its 1, 'a wrong page was read'");
  assert.match(err.join(""), /fleet capture submit did not return a job ID/);
  const plain = await quietly(() => runFleetClient({
    argv: ARGV, root: join(root, "pending2"), kind: "x", hint: String, deps,
    prepare: async () => ({ cases: [{ id: "a", url: "http://x/a", body: {} }] }), collect: async () => ({ recapture: [], exit: 0 }),
  }));
  assert.equal(plain.result, 1, "a client with no code of its own for it exits 1");
});

test("a page submitted again from a --collect that carries no label is booked under the label the job was submitted with", async () => {
  const { cases, groups } = probeOrderCases(PAGES, BASE);
  const lost = PAGES[2]!;
  const lostGroup = slugOf(lost.url ?? lost.path);
  const r = rig({ ids: ["fj-1", "fj-2"], fixtures: {} });
  r.serve({ "fj-1": probeOrderResults(r, "fj-1", cases, [`${lostGroup}.b`]) });
  const spec = { root: r.pending, kind: "gate-probe-order", hint: String, deps: r.deps, collect: probeOrderCollector() };
  // Submitted with a label and no wait: the job ID is printed and the run stops (75).
  const first = await quietly(() => runFleetClient({ ...spec, argv: ["--boxes=2", "--label=A11-263"], prepare: async () => ({ cases, groups, extra: { round: 1, base: BASE, settled: {} } }) }));
  assert.equal(first.result, 75);
  // Collected with no label of its own, as the printed hint says: the page is submitted again, under the original label.
  const second = await quietly(() => runFleetClient({ ...spec, argv: ["--collect=fj-1"], prepare: async () => { throw new Error("a collect submits nothing of its own"); } }));
  const submits = r.stub.calls().filter((c) => c.argv[0] === "capture");
  assert.equal(submits.length, 2, `the page was submitted again:\n${second.out}`);
  assert.deepEqual(submits[1]!.argv.slice(submits[1]!.argv.indexOf("--label"), submits[1]!.argv.indexOf("--label") + 2), ["--label", "A11-263"]);
  assert.equal(second.result, 75, "and, with no wait, that job is printed for the next collect");
});

test("a box NAMED on the command line beats the catalogue's boxes, and an address is ignored with a line when the catalogue sets them", () => {
  assert.deepEqual(singleBox(["--box=http://192.0.2.10:8765", "--label=A11-263"], { A11Y_FLEET_BOXES: "ready" }), ["--label=A11-263"], "an address does not select a box");
  assert.deepEqual(singleBox([], { A11Y_FLEET_BOXES: "ready" }, "192.0.2.10:8765"), []);
});

test("a named box is booked even when the environment names others, and an ignored address is said", async () => {
  const r = rig({ ids: ["fj-1"], fixtures: {} });
  const named = await quietly(() => runFleetClient({
    argv: ["--box=a11y-worker-14", "--label=A11-263"], env: { A11Y_FLEET_BOXES: "ready" }, root: r.pending, kind: "x", hint: String, deps: r.deps, oneBox: {},
    prepare: async () => ({ cases: [{ id: "a", url: "http://x/a", body: {} }] }), collect: async () => ({ recapture: [], exit: 0 }),
  }));
  assert.equal(named.result, 75);
  const argv = r.stub.calls()[0]!.argv;
  assert.equal(argv[argv.indexOf("--boxes") + 1], "a11y-worker-14", "the person's box, not the catalogue's");

  const ignored = rig({ ids: ["fj-1"], fixtures: {} });
  await quietly(() => runFleetClient({
    argv: ["--label=A11-263"], env: { A11Y_FLEET_BOXES: "2" }, root: ignored.pending, kind: "x", hint: String, deps: ignored.deps, oneBox: { positional: "http://192.0.2.10:8765" },
    prepare: async () => ({ cases: [{ id: "a", url: "http://x/a", body: {} }] }), collect: async () => ({ recapture: [], exit: 0 }),
  }));
  assert.match(ignored.err.join(""), /ignoring the box address given \(http:\/\/192\.0\.2\.10:8765\)/);
  const args = ignored.stub.calls()[0]!.argv;
  assert.equal(args[args.indexOf("--boxes") + 1], "2", "and the catalogue's boxes stand");
});

test("capture:check is in-process unless a FLEET input is named: A11Y_WORKER(S) in the environment never selected worker mode", () => {
  assert.equal(fleetModeRequested([], { A11Y_WORKERS: "http://a:8765", A11Y_WORKER: "http://a:8765" }), false);
  assert.equal(fleetModeRequested([], {}), false);
  for (const argv of [["--label=A11-263"], ["--boxes=1"], ["--wait=1h"], ["--collect"], ["--collect=fj-1"], ["--worker=http://a:8765"]]) assert.equal(fleetModeRequested(argv, {}), true, argv.join(" "));
  for (const name of ["A11Y_FLEET_BOXES", "A11Y_FLEET_LABEL", "A11Y_FLEET_WAIT"]) assert.equal(fleetModeRequested([], { [name]: "x" }), true, name);
});
