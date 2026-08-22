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

import { CASES } from "./case-matrix.mjs";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Every probe flag any case actually asks for. Derived, never listed — a list is the defect. */
const PROBE_FLAGS = [...new Set(
  CASES.flatMap((testCase: Record<string, unknown>) =>
    Object.keys(testCase).filter((key) => key.startsWith("probe"))),
)].sort();

test("some case asks for each probe flag, or this suite proves nothing", () => {
  assert.ok(PROBE_FLAGS.length >= 3, `expected several probe flags, found ${PROBE_FLAGS.join(", ")}`);
  for (const flag of PROBE_FLAGS) {
    assert.ok(CASES.some((c: Record<string, unknown>) => c[flag as string] === true),
      `${flag} is declared by no case, so nothing downstream can be shown to honour it`);
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
    assert.ok(new RegExp(`${flag}:\\s*!!opts\\.${flag}`).test(core),
      `${flag} reaches the guest and is never read: capture-core.mjs does not take opts.${flag}`);
    assert.ok(new RegExp(`\\b${flag}\\b`).test(core.slice(core.indexOf("async function navigateByStructure("))),
      `${flag} is read from opts but never used to gate a probe`);
  }
});
