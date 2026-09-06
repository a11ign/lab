/**
 * A brand-new case cannot have discriminated yet — you cannot validate a signal without capturing it, and
 * its first capture is what `check-signals` runs against. So a case may declare itself `provisional`
 * (`case-matrix.mjs`'s `pair()`), and `check-signals.mjs` reports its BLIND verdict separately rather than
 * failing the whole gate on it: adding a case used to be all-or-nothing, working first time or blocking
 * `check-signals` — the FIRST gate in every chain — until someone withdrew it. That happened with 15 newly
 * added 2.4.7 cases on 2026-09-06: two chain runs spent, and the withdrawal is a commit that has to be
 * reverted later just to try again.
 *
 * THE SECOND HALF IS THE IMPORTANT ONE, copied from `PENDING_CAPTURE` in `evidence-fields.test.ts`: an
 * exemption that outlives its reason is indistinguishable from a bug someone decided to live with. So this
 * file is what makes `provisional` self-retiring — it fails the moment a provisional case's OWN verdict
 * turns out to be OK, which is the only thing that makes the flag safe to grant at all — and it caps how
 * many cases may hold it at once, so the exemption cannot become a queue nobody works through.
 *
 * WHY ON THE CASE, NOT A SEPARATE LIST LIKE `PENDING_CAPTURE`. `PENDING_CAPTURE` is keyed on FIELD NAMES,
 * which have no first-class object to live on in this codebase — a separate list is the only place for
 * them. A case already IS a first-class object that `check-signals` iterates directly, and a separate
 * list keyed by case id would be a SECOND place a case's identity has to agree with the first, which is
 * exactly the "fact stated twice" shape this repo's own record says drifts. Discoverability is not lost:
 * `check-signals`'s own output names every provisional case and its reason on every run, which is a
 * currently-true review surface a static list is not — it can only ever describe an intention.
 *
 * WHY CONTAMINATED GETS NO GRACE. BLIND means "has not been proven yet", which is expected of a case that
 * has never been captured against. CONTAMINATED means the good page's capture ALREADY exists and the
 * signal ALREADY fires on it — that is wrong now, not merely unproven, and there is no amount of waiting
 * that resolves it. Provisional buys grace for the first, never the second.
 *
 * WHY NO EXPORT DECISION IS NEEDED HERE. `export-screenreader-dataset.mjs`'s `validatePair` already
 * refuses to emit a record for a BLIND signal ("bad signal was not observable in NVDA output") or a
 * CONTAMINATED one ("good control also contained the bad signal"), regardless of `provisional` — an
 * unvalidated label was already structurally excluded from training data before this file existed. A
 * provisional case only ever reaches the exported dataset once it has stopped being BLIND, at which point
 * it is no longer provisional either (the test below sees to that) and is indistinguishable from any other
 * case that discriminates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CASES, pair } from "./case-matrix.mjs";
import { checkCase, effectiveVerdict, signalVerdict } from "./check-signals.mjs";
import { datasetRoot, captureRoot as buildCaptureRoot } from "../dataset-paths.mjs";
import { labCorpusReadable, skipLine } from "./corpus-settled.mjs";
import { captureFilePath } from "../capture/evidence-diff.mjs";

/**
 * How many cases may be provisional AT ONCE.
 *
 * Not a time limit — this repo has no infrastructure that reads a date out of a comment, and a real one
 * would need to (parse a format, decide what "too old" means, keep working when nobody agreed on either).
 * A COUNT is enforceable today with nothing new: it is a property of `CASES` a test can read directly, and
 * it directly answers what a time limit is really trying to prevent — the exemption becoming a queue
 * nobody works through, rather than a landing strip for the case someone is actively finishing. Raise it
 * deliberately (a visible diff, same as any other ceiling in this repo) if a real batch needs more room;
 * do not raise it to make this test pass.
 */
const MAX_PROVISIONAL = 3;

const provisionalCases = () => (CASES as Array<Record<string, unknown>>).filter((c) => c.provisional);

/**
 * The BASE case id, stripping a `+also-`/`+with-` accompanying-defect suffix.
 *
 * CLAUDE.md documents the convention directly: "a trailing + means the FAMILY -- the base case and its
 * +also-/+with- variants". Marking one base case provisional flows through every accompanying-defect
 * variant `withAccompanyingDefects` builds from it (they are built by re-running the ALREADY-provisional
 * template through `pair()`, sharing its `badSignal` verbatim) -- correctly, since the same pattern is
 * exactly as unproven on every page it appears on. But it means a single author decision can occupy
 * several `CASES` entries, and the cap below is about how many INDEPENDENT signal claims are outstanding,
 * not how many rows an unrelated multiplication mechanism happens to produce from one of them.
 */
const baseId = (id: string) => id.split("+")[0];

test("provisional is forwarded by pair(), not silently dropped", () => {
  // `pair()`'s own header warns that a field named in the destructuring but not in the returned object is
  // silently dropped — it happened to `alsoFails`, then to `probeArrows`/`probeTyping`. Called directly
  // rather than found on a real case, so this holds even when nothing is currently provisional (the usual
  // and desired state).
  const built = pair({
    id: "provisional-forwarding-probe", criterion: "1.1.1", task: "t", source: "s", mutation: "m",
    badSignal: { type: "regex", pattern: "x" }, good: "<html></html>", bad: "<html></html>",
    provisional: "added for this test only, never a real case",
  });
  assert.equal(built.provisional, "added for this test only, never a real case");
});

test("a case with no provisional declared reads as null, never undefined or missing", () => {
  const built = pair({
    id: "provisional-default-probe", criterion: "1.1.1", task: "t", source: "s", mutation: "m",
    badSignal: { type: "regex", pattern: "x" }, good: "<html></html>", bad: "<html></html>",
  });
  assert.equal(built.provisional, null);
  assert.ok("provisional" in built, "the key must exist even when unset, or a consumer checking " +
    "`'provisional' in testCase` reads a real case and a fixture differently");
});

test("no more than a handful of BASE cases are provisional at once", () => {
  // Deduped by base id: an accompanying-defect variant inheriting `provisional` from its template is the
  // SAME outstanding claim, not a second one, and counting rows rather than claims would let one author
  // decision alone approach the cap in one commit.
  const bases = new Set(provisionalCases().map((c) => baseId(c.id as string)));
  assert.ok(bases.size <= MAX_PROVISIONAL,
    `${bases.size} base case(s) are provisional (cap ${MAX_PROVISIONAL}): ${[...bases].join(", ")}. `
    + "Finish or withdraw one before adding another — the exemption is a landing strip, not a queue.");
});

test("every provisional case states a real reason, not a bare flag", () => {
  for (const testCase of provisionalCases()) {
    const reason = testCase.provisional as string;
    assert.ok(reason.length >= 15,
      `${testCase.id}: provisional needs a REASON (what's unproven, and roughly when it was added), not `
      + `just a truthy value — got ${JSON.stringify(reason)}`);
  }
});

test("effectiveVerdict reports a provisional case's BLIND separately, and does not fail the gate", () => {
  const blind = { id: "x", verdict: "BLIND" };
  const folded = effectiveVerdict(blind, { provisional: "added 2026-09-06, pending its first real capture" });
  assert.equal(folded.verdict, "PROVISIONAL BLIND");

  // The gate-level proof: counted as PROVISIONAL BLIND rather than BLIND, `signalVerdict` must not fail.
  const counts = { OK: 30, BLIND: 0, CONTAMINATED: 0, "NO CAPTURES": 0, "STALE CAPTURES": 0,
    "PROVISIONAL BLIND": 1 };
  const { exitCode, summary } = signalVerdict(counts);
  assert.equal(exitCode, 0, "a provisional case's unproven BLIND must not fail check-signals");
  assert.match(summary, /provisional/i, "a pass riding on an unproven case must say so");
});

test("effectiveVerdict leaves a NON-provisional BLIND alone", () => {
  const blind = { id: "x", verdict: "BLIND" };
  assert.equal(effectiveVerdict(blind, { provisional: null }).verdict, "BLIND");
  assert.equal(effectiveVerdict(blind, {}).verdict, "BLIND");
});

test("effectiveVerdict never touches CONTAMINATED — provisional buys it no grace", () => {
  const contaminated = { id: "x", verdict: "CONTAMINATED" };
  const folded = effectiveVerdict(contaminated, { provisional: "added 2026-09-06, pending capture" });
  assert.equal(folded.verdict, "CONTAMINATED",
    "a signal firing on the GOOD page is wrong NOW, not merely unproven — provisional must not soften it");

  // And the gate-level proof: still a real defect, still fails, whatever provisional says.
  const counts = { OK: 30, BLIND: 0, CONTAMINATED: 1, "NO CAPTURES": 0, "STALE CAPTURES": 0,
    "PROVISIONAL BLIND": 0 };
  assert.equal(signalVerdict(counts).exitCode, 1);
});

/**
 * THE SELF-RETIREMENT PROOF, mirroring `evidence-fields.test.ts`'s `PENDING_CAPTURE` guard exactly: this
 * fails the moment a provisional case's OWN verdict, computed against real captures, is no longer BLIND —
 * because a case that discriminates and is STILL marked provisional is an exemption nobody came back to
 * remove, indistinguishable from a bug someone decided to live with.
 *
 * Needs the corpus on disk. Skips HONESTLY when `runs/` is absent — the same rule every other
 * corpus-dependent test in this package follows, because a check that reports success having examined
 * nothing is how "verified" comes to mean "unexamined".
 */
test("a provisional case whose signal now discriminates must have the flag removed", () => {
  const provisional = provisionalCases();
  if (!provisional.length) return; // nothing to check, and that is a fine state for this test to see

  const captureRoot = buildCaptureRoot(datasetRoot());
  // Settled as well as present: a capture in flight is writing exactly the good/bad pairs this compares,
  // so a pair that looks incomplete may simply not have been written yet.
  const corpus = labCorpusReadable({ present: existsSync(captureRoot) });
  if (!corpus.read) {
    console.log(skipLine(corpus));
    return;
  }

  const stillProvisional: string[] = [];
  const checked: string[] = [];
  for (const testCase of provisional) {
    const good = captureFilePath(captureRoot, testCase.id as string, "good");
    const bad = captureFilePath(captureRoot, testCase.id as string, "bad");
    if (!existsSync(good) || !existsSync(bad)) continue; // not captured here yet -- a different question
    const verdict = checkCase(testCase as never).verdict;
    checked.push(`${testCase.id}: ${verdict}`);
    if (verdict === "OK") stillProvisional.push(testCase.id as string);
  }

  if (checked.length) console.log(`  checked: ${checked.join("; ")}`);
  assert.deepEqual(stillProvisional, [],
    `these provisional case(s) now discriminate and must have \`provisional\` removed from their pair() `
    + `call in case-matrix.mjs, or the flag hides a real capability gap the next time this fires for a `
    + `different reason: ${stillProvisional.join(", ")}`);
});

test("the JSON manifest, once generated, carries provisional through the round trip", () => {
  // check-signals.mjs runs from the MANIFEST, not from CASES directly — the same trap
  // manifest-probes.test.ts exists for. Proven against the real file when one exists, skipped honestly
  // otherwise, because a stale manifest predating this field is a fact about the copy, not about the code.
  const manifestPath = resolve(datasetRoot(), "manifest.json");
  const manifestCorpus = labCorpusReadable({ present: existsSync(manifestPath) });
  if (!manifestCorpus.read) {
    console.log(skipLine(manifestCorpus));
    return;
  }
  if (!existsSync(manifestPath)) {
    console.log(`  SKIPPED: no manifest at ${manifestPath} — run \`npm run training:generate\` to cover this`);
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { cases: Array<Record<string, unknown>> };
  const byId = new Map(manifest.cases.map((c) => [c.id as string, c]));
  const dropped: string[] = [];
  for (const testCase of provisionalCases()) {
    const entry = byId.get(testCase.id as string);
    if (!entry) continue; // added since the last generate; not this test's question
    if (entry.provisional !== testCase.provisional) dropped.push(testCase.id as string);
  }
  assert.deepEqual(dropped, [],
    `these case(s) declare provisional but the manifest does not carry it -- generate-screenreader-` +
    `dataset.mjs's hand-copied field list dropped it, the same shape that once dropped alsoFails and ` +
    `probeFocus: ${dropped.join(", ")}`);
});
