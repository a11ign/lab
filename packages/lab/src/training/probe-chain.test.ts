// A PROBE FLAG CROSSES FIVE HOPS, AND EACH ONE NAMES ITS FIELDS BY HAND.
//
// Two of them have now silently dropped a flag, a day apart, and the failures are indistinguishable from
// outside: the field the probe writes is simply absent, which looks exactly like a page that had nothing to
// report. Neither threw, neither logged, and every other check stayed green.
//
//   pair()                      case-matrix.mjs        builds the case
//   generate-…-dataset.mjs      the MANIFEST           dropped probeFocus  (2026-08-21)
//   capture-screenreader-dataset.mjs  the request      host-side options
//   server.mjs captureOptions   the REQUEST BOUNDARY   dropped probeNavigation (2026-08-22)
//   capture-core.mjs            the capture itself     reads opts.probe*
//
// Yesterday's `manifest-probes.test.ts` covers the first three. It could not see the last two, because they
// live in the worker package — so the guard written in response to the first defect could not catch the
// second. This walks all five from the case definitions themselves, so a flag no hop forwards fails here
// rather than in a capture nobody can explain.
//
// Deliberately source-level for the two worker hops: `capture-core.mjs` imports guidepup, which throws at
// module load where no screen reader exists, so no test can import it at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CASES, pair } from "./case-matrix.mjs";
import { pair as acceptancePair } from "./acceptance-matrix.mjs";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Every probe flag any case actually asks for. Derived, never listed — a list is the defect. */
const PROBE_FLAGS = [...new Set(
  CASES.flatMap((testCase: Record<string, unknown>) =>
    Object.keys(testCase).filter((key) => key.startsWith("probe"))),
)].sort();

test("some case asks for each probe flag, or this suite proves nothing", () => {
  assert.ok(PROBE_FLAGS.length >= 3, `expected several probe flags, found ${PROBE_FLAGS.join(", ")}`);
  for (const flag of PROBE_FLAGS) {
    // TRUTHY, not `=== true`. A probe option may be a NAME rather than a switch — `probeOrder` is
    // `"focus-first"`, validated against a fixed set at the request boundary — and an equality check
    // against `true` would report such an option as declared by nobody while a case declared it.
    assert.ok(CASES.some((c: Record<string, unknown>) => Boolean(c[flag as string])),
      `${flag} is declared by no case, so nothing downstream can be shown to honour it`);
  }
});

/**
 * Every `probe*` option the WORKER accepts, read from its request boundary.
 *
 * `PROBE_FLAGS` is derived from the cases, which makes this suite circular in one direction: an option no
 * case uses is never checked, so no case can start using it without being silently dropped. Measured
 * 2026-08-30 — `probeOrder` had been supported by `capture-core.mjs` and `server.mjs` since the
 * determinism work and was unreachable from a case for its whole life, because the host runner enumerates
 * by name. It is the ONLY mechanism that lets a focus case carry form evidence without activating a
 * control before the tab ring is walked, and the 24 free vetoes on the three focus heads are the cost.
 *
 * So this list runs the other way: the worker defines what is supported, and everything supported must be
 * REACHABLE. A capability nothing can ask for is the same defect as a flag nothing forwards.
 */
const WORKER_PROBE_OPTIONS = [...new Set(
  [...read("packages/nvda-worker/src/server.mjs")
    .slice(read("packages/nvda-worker/src/server.mjs").indexOf("function captureOptions("))
    .matchAll(/^\s{4}(probe[A-Za-z]+):/gm)].map((m) => m[1]),
)].sort();

/**
 * Probe options the worker accepts that a CASE deliberately may not ask for, each with the reason.
 *
 * Declared rather than omitted, which is the difference between "nobody needs this" and "somebody forgot"
 * — the same call `INTERACTION_CHANNELS` had to make when `tabStops` was classified `unclaimed` instead of
 * being left out. An undeclared absence looks identical to the `probeOrder` defect this test was widened
 * to catch, and that one cost 24 free vetoes.
 */
const NOT_FOR_CASES: Record<string, string> = {
  probeElementsList: "opens a MODAL DIALOG on the guest desktop, and a modal blocks input while /health "
    + "stays green — the state that wedges a worker and once took QEMU down with it. It is a diagnostic "
    + "cross-check against NVDA's own Elements List totals, run deliberately against one box, never "
    + "1,462 times across a corpus run.",
};

test("every probe option the worker accepts is reachable from a case definition", () => {
  assert.ok(WORKER_PROBE_OPTIONS.length >= 4,
    `found ${WORKER_PROBE_OPTIONS.length} probe options at the boundary; the scan is broken, not the code clean`);
  const runner = read("packages/lab/src/training/capture-screenreader-dataset.mjs");
  const unreachable = WORKER_PROBE_OPTIONS
    .filter((option) => !runner.includes(`testCase.${option}`))
    .filter((option) => !(option in NOT_FOR_CASES));
  assert.deepEqual(unreachable, [],
    "the worker honours these and the host runner never sends them, so no case can ask for them. "
    + "Forward them, or add them to NOT_FOR_CASES with the reason");
});

test("the not-for-cases list names real options, and none has quietly become reachable", () => {
  // A stale exemption is a list that lies: it forgives nothing while making the gap look larger, and it
  // would hide a rename. The same guard `UNGUARDED` carries in cli-flags.test.ts.
  const runner = read("packages/lab/src/training/capture-screenreader-dataset.mjs");
  for (const [option, why] of Object.entries(NOT_FOR_CASES)) {
    assert.ok(WORKER_PROBE_OPTIONS.includes(option), `${option} is exempted and the worker does not accept it`);
    assert.ok(!runner.includes(`testCase.${option}`), `${option} IS forwarded now — delete its exemption`);
    assert.ok(why.length > 40, `${option}'s exemption must say why, not merely exist`);
  }
});

test("the host runner sends every probe flag", () => {
  const runner = read("packages/lab/src/training/capture-screenreader-dataset.mjs");
  for (const flag of PROBE_FLAGS) {
    assert.ok(runner.includes(`testCase.${flag}`),
      `${flag} never reaches the request: capture-screenreader-dataset.mjs does not read testCase.${flag}`);
  }
});

test("the WORKER accepts every probe flag at the request boundary", () => {
  // The hop that dropped `probeNavigation`. It is a whitelist on purpose — an unknown field must be ignored
  // rather than obeyed, which is what lets an older worker take a newer host's request and not do the new
  // thing. That deliberate choice is exactly why it needs a test: the safe default is silence.
  const server = read("packages/nvda-worker/src/server.mjs");
  for (const flag of PROBE_FLAGS) {
    assert.ok(new RegExp(`${flag}:\\s*parsed\\.${flag}`).test(server),
      `${flag} is dropped at the request boundary: server.mjs captureOptions does not read parsed.${flag}`);
  }
});

test("the capture itself reads every probe flag", () => {
  const core = read("packages/nvda-worker/src/capture-core.mjs");
  for (const flag of PROBE_FLAGS) {
    // `!!opts.X` for a switch, `opts.X === "name"` for a validated NAME. Both are reads; requiring the
    // boolean form only would refuse the shape `probeOrder` has deliberately had from the start.
    assert.ok(new RegExp(`${flag}:\\s*(!!opts\\.${flag}|opts\\.${flag}\\s*===)`).test(core),
      `${flag} reaches the guest and is never read: capture-core.mjs does not take opts.${flag}`);
    assert.ok(new RegExp(`\\b${flag}\\b`).test(core.slice(core.indexOf("async function navigateByStructure("))),
      `${flag} is read from opts but never used to gate a probe`);
  }
});

test("evidence:check forwards every probe flag, and gates on all of them", () => {
  // A SIXTH place a probe flag must be listed, and the one where forgetting is most expensive: this tool
  // captures a case fresh and diffs it against the baseline, so a flag it drops produces a capture missing
  // evidence the baseline HAS — reported as CHANGED, which is the answer that costs a full recapture.
  //
  // Its own `optionsUnchanged` guard exists to stop exactly that ("a comparison must not be between two
  // things that differ for a reason unrelated to the change under test") and named the two flags that
  // existed when it was written, so it was blind to the two added since.
  const source = readFileSync(resolve(process.cwd(), "packages/lab/scripts/evidence-check.mjs"), "utf8");
  assert.match(source, /key\.startsWith\("probe"\)/,
    "the capture request must forward probe flags by prefix, not by name");
  assert.match(source, /k\.startsWith\("probe"\)/,
    "and the comparability guard must consider every probe flag, not the two it was born with");
  for (const flag of PROBE_FLAGS) {
    assert.ok(!new RegExp(`${flag}: !!testCase\\.${flag}`).test(source),
      `${flag} is still enumerated by name in evidence-check; that is how the last two were dropped`);
  }
});

test("pair() forwards a probe flag it has never heard of", () => {
  // THE HOP THAT WAS MISSED. "Which probe a case wants" was six hand-written hops; the manifest hop was
  // fixed to forward `probe*` by PREFIX and `pair()` was not. So `probeArrows` and `probeTyping` were
  // declared on their cases, plumbed through every hop AFTER this one, passed this suite, and were
  // dropped here — silently, because a dropped flag and an unasked probe produce the same absent field.
  //
  // Asserted with a name that does not exist anywhere in the codebase, because a test naming a real flag
  // would pass the moment somebody adds that flag by hand, which is the failure mode it exists to stop.
  const generated = pair({
    id: "probe-forwarding-fixture",
    criterion: "4.1.2",
    task: "t",
    source: "s",
    mutation: "m",
    badSignal: { type: "regex", pattern: "x" },
    good: "<p>g</p>",
    bad: "<p>b</p>",
    probeNeverHeardOf: true,
  } as never) as unknown as Record<string, unknown>;
  assert.equal(generated.probeNeverHeardOf, true,
    "a probe flag the case declares must reach the generated case, or the probe silently never runs");
});

test("the ACCEPTANCE pair() forwards a probe flag it has never heard of, too", () => {
  // THE SAME HOP, ON THE OTHER PIPELINE, AND IT WAS UNGUARDED FOR THE WHOLE LIFE OF THIS FILE. The header
  // above names three corpus hops; the acceptance path has the same three, and this suite imported only
  // case-matrix. So the builder that was CORRECT got a guard and the builder that was dropping flags did
  // not — which is the shape this whole file exists to catch, applied to the file itself.
  //
  // Measured 2026-09-05: acceptance `pair()` enumerated `probeForms` and `probeTables`, so seven corpus
  // subtypes had no held-out coverage. Not because nobody wrote the cases — because a case needing
  // `probeFocus` or `probeNavigation` could not be expressed at all.
  const generated = acceptancePair({
    id: "acceptance-probe-forwarding-fixture",
    criterion: "4.1.2",
    subtype: "unnamed-control",
    task: "t",
    mutation: "m",
    badSignal: { type: "regex", pattern: "x" },
    good: "<p>g</p>",
    bad: "<p>b</p>",
    probeNeverHeardOf: true,
  } as never) as unknown as Record<string, unknown>;
  assert.equal(generated.probeNeverHeardOf, true,
    "a probe flag an acceptance case declares must reach the generated case, or the probe silently never "
    + "runs and the subtype cannot be measured at all");
});

test("pair() does NOT forward a non-probe key", () => {
  // The other direction, and it is not symmetry for its own sake: `pair()` takes fields that are about
  // the CASE rather than the capture, and leaking those into the capture request would put arbitrary
  // case metadata on the wire and into the cache key.
  const generated = pair({
    id: "probe-forwarding-fixture-2",
    criterion: "4.1.2",
    task: "t",
    source: "s",
    mutation: "m",
    badSignal: { type: "regex", pattern: "x" },
    good: "<p>g</p>",
    bad: "<p>b</p>",
    somethingElse: true,
  } as never) as unknown as Record<string, unknown>;
  assert.equal(generated.somethingElse, undefined,
    "only `probe*` keys ride through; everything else is case metadata and stays out of the request");
});
