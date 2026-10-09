import { test } from "node:test";
import assert from "node:assert/strict";
import { gateVerdict, exitCodeFor, renderVerdict, crashVerdict } from "./verdict.ts";

/**
 * determinism-plan D6. The rule is not "print the population" — `evidence-check` printed its coverage and
 * still passed on 2 of 48, because its guard tested `compared === 0` rather than `compared < expected`. The
 * rule is that the VERDICT IS DERIVED from coverage, so the bad state cannot be constructed at all.
 */
test("the 2-of-48 defect is unconstructible, not merely caught", () => {
  const v = gateVerdict({ examined: 2, of: 48, source: "a stratified sample" });
  assert.equal(v.verdict, "INCONCLUSIVE");
  assert.equal(exitCodeFor(v), 2);
  assert.match(renderVerdict(v), /only 2 of 48/);
});

test("coverage is checked BEFORE cleanliness, which is the whole ordering", () => {
  // Reversing those two lines reproduces the original defect exactly: a short run with no failures reads as
  // PASS. This is the mutation the implementation must not survive.
  const short = gateVerdict({ examined: 47, of: 48, source: "the corpus", failures: 0 });
  assert.equal(short.verdict, "INCONCLUSIVE", "no failures is not the same as nothing to fail");
});

test("a real failure outranks incomplete coverage, because a found defect is a found defect", () => {
  const v = gateVerdict({ examined: 10, of: 48, source: "the corpus", failures: 3 });
  assert.equal(v.verdict, "FAIL");
  assert.equal(exitCodeFor(v), 1);
});

test("failures are not a subset of what was examined — one artefact can have several problems", () => {
  // `release:provenance` reads ONE artefact and found two problems with it, and the first wording rendered
  // that as "FAIL — 2 of 1 examined failed". Failures COUNT problems; examined counts units looked at.
  const v = gateVerdict({ examined: 1, of: 1, source: "the shipped weights", failures: 2 });
  assert.equal(v.verdict, "FAIL");
  assert.doesNotMatch(renderVerdict(v), /2 of 1/);
  assert.match(renderVerdict(v), /2 problem\(s\) across 1 of 1/);
});

test("PASS requires full coverage AND no failures", () => {
  const v = gateVerdict({ examined: 48, of: 48, source: "a stratified sample" });
  assert.equal(v.verdict, "PASS");
  assert.equal(exitCodeFor(v), 0);
});

test("every verdict names its SOURCE, because a count means nothing without what it counted over", () => {
  // `worker:code` said "nothing to compare" of the local pool while inventory.yml held five stale workers;
  // `evidence:check` compared this disk's captures and was read as a verdict on a code change. Both were
  // correct counts over a population the reader had not been told about.
  for (const v of [gateVerdict({ examined: 0, of: 5, source: "inventory.yml" }),
    gateVerdict({ examined: 5, of: 5, source: "inventory.yml" })]) {
    assert.match(renderVerdict(v), /inventory\.yml/);
  }
});

/**
 * a11ign/a11ign#3977. A harness that threw read nothing, and Node exits 1 for an uncaught throw -- the code for "a real
 * failure". `gate:stability` crashed on a page server that never came up and was posted as an UNSTABLE canary.
 */
test("a crashed harness is INCONCLUSIVE (exit 2), never a FAIL (exit 1), and says no verdict was read", () => {
  const v = crashVerdict("gate:stability", new Error("page server did not serve form-unlabelled/good.html on :5050"));
  assert.equal(v.verdict, "INCONCLUSIVE");
  assert.equal(exitCodeFor(v), 2);
  assert.notEqual(exitCodeFor(v), 1, "1 is what an uncaught throw already exits with; sharing it is the defect");
  assert.match(renderVerdict(v), /NO VERDICT: gate:stability crashed/);
  assert.match(renderVerdict(v), /form-unlabelled\/good\.html/, "the cause travels with it");
  assert.equal(v.failures, 0, "a crash found no failing page");
});

test("a thrown non-Error is still a readable crash verdict", () => {
  assert.match(crashVerdict("gate:stability", "boom").why, /: boom$/);
});
