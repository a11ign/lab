/**
 * `check-signals` was answering two questions with one exit code, and one of them cannot be asked on a
 * working copy.
 *
 * BLIND and CONTAMINATED are logic defects — the signal misses the bad page, or fires on the good one. Any
 * machine holding evidence for that case can detect them, and catching them is what the gate is FOR.
 *
 * NO CAPTURES and STALE CAPTURES are not defects. They say this disk has no evidence matching the current
 * definitions, which on the lab means "go capture" and on a laptop usually means `runs/` is gitignored and
 * this copy is older than the case matrix. Indistinguishable from here.
 *
 * Measured 2026-08-23 at one commit: `0 blind, 0 contaminated, 242 uncaptured, 860 stale` locally;
 * `1303 discriminating, 0 of everything else` on the lab. The signal layer was provably fine and the gate
 * said FAIL — and the only way past it was `A11Y_SKIP_VERIFY=1`, which also disables lint, typecheck, tests
 * and rules:gate. A check that could not answer its own question was switching off four that could, nine
 * times in one day. That is the failure being fixed here, more than the wrong exit code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { signalVerdict, MIN_EXAMINED } from "./check-signals.mjs";

const counts = (over: Partial<Record<string, number>> = {}) => ({
  OK: 0, BLIND: 0, CONTAMINATED: 0, "NO CAPTURES": 0, "STALE CAPTURES": 0, ...over,
});

test("a real defect fails, however complete the corpus is", () => {
  for (const defect of ["BLIND", "CONTAMINATED"]) {
    const { exitCode, summary } = signalVerdict(counts({ OK: 1300, [defect]: 3 }));
    assert.equal(exitCode, 1, `${defect} must fail`);
    assert.match(summary, /do not discriminate/);
  }
});

test("a stale or uncaptured corpus does NOT fail, because this machine cannot tell what it means", () => {
  // The exact shape measured locally. Zero defects; 1102 cases simply not answerable here.
  const { exitCode, summary } = signalVerdict(counts({ OK: 201, "NO CAPTURES": 242, "STALE CAPTURES": 860 }));
  assert.equal(exitCode, 0);
  assert.match(summary, /201 case\(s\) with usable evidence discriminate/);
  assert.match(summary, /not about the signal layer/,
    "a pass with gaps must say what it did NOT check, or it reads as a clean bill of health");
});

test("uncaptured and stale are treated the SAME, which they were not", () => {
  // `NO CAPTURES` returned 0 and `STALE CAPTURES` returned 1, though both mean "no usable evidence here".
  // 242 uncaptured passed in silence while 860 stale failed.
  const uncaptured = signalVerdict(counts({ OK: 100, "NO CAPTURES": 50 }));
  const stale = signalVerdict(counts({ OK: 100, "STALE CAPTURES": 50 }));
  assert.equal(uncaptured.exitCode, stale.exitCode);
});

test("--require-complete restores the strictness where the corpus IS authoritative", () => {
  // release:gate and the lab job pass this. There, a hole in the corpus is the answer, not an unanswerable
  // question, and it must block a release or a corpus run.
  const { exitCode, summary } = signalVerdict(
    counts({ OK: 201, "STALE CAPTURES": 860 }), { requireComplete: true });
  assert.equal(exitCode, 1);
  assert.match(summary, /--require-complete/);

  // And a complete corpus still passes under it, or the strict mode would block every release.
  assert.equal(signalVerdict(counts({ OK: 1303 }), { requireComplete: true }).exitCode, 0);
});

test("too little evidence is INCONCLUSIVE (2), never a pass", () => {
  // The trap this floor exists for is `evidence:check`'s, recorded in CLAUDE.md: it reported "safe to ship"
  // having compared 2 of 48. An answer given on too little evidence is the failure — not the absence of one.
  const { exitCode, summary } = signalVerdict(counts({ OK: 3, "NO CAPTURES": 1300 }));
  assert.equal(exitCode, 2);
  assert.match(summary, /INCONCLUSIVE/);
  assert.match(summary, /This is not a pass/);

  // A fresh clone with no corpus at all is the same answer, not a green one.
  assert.equal(signalVerdict(counts({ "NO CAPTURES": 1303 })).exitCode, 2);
});

test("a defect outranks an inconclusive count", () => {
  // Few cases examined AND one of them broken: the defect is a definite finding and must not be softened
  // into "we could not tell". Absent and failed must never look alike — this file's founding rule.
  const { exitCode } = signalVerdict(counts({ OK: 1, BLIND: 1, "NO CAPTURES": 1300 }));
  assert.equal(exitCode, 1);
});

test("the floor is a real number the summary quotes", () => {
  assert.ok(MIN_EXAMINED >= 10, "a floor below ~10 cannot exercise the variety of signal types");
  assert.match(signalVerdict(counts({ OK: MIN_EXAMINED - 1 })).summary, new RegExp(String(MIN_EXAMINED)));
  assert.equal(signalVerdict(counts({ OK: MIN_EXAMINED })).exitCode, 0, "exactly at the floor is enough");
});
