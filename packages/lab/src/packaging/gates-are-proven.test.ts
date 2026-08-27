/**
 * Every GATE must have been SHOWN to fail on the fault it exists to catch.
 *
 * ## Why this test exists
 *
 * Nine defects in one session (2026-08-27) were the same shape, and none of them was a product defect —
 * every one was a CHECK that could not report itself:
 *
 *   - the real-pages pipeline captured 39 of 89 pages, because `capture-real-pages` defaults to one role
 *   - `corpus:urls` counted a page it never saw, because a 403 returns the URL you asked for
 *   - `rules:real-pages --update` rewrote a baseline from partial coverage and erased a known finding
 *   - `lab:reset` discarded a tracked file and reported "Nothing was deleted"
 *   - `-e remove=` could never work on more than one file, because a folded scalar does not split
 *   - a report that found a dirty tree exited 0, so it could not gate anything
 *   - the corpus audits ran AFTER `promote`, so they refused with the weights already shipped
 *   - `check-signals` showed the focus cases evidence their signal is not decided from
 *   - the container-exit strip removed ONE exit, and containers nest
 *
 * Each was found by something else failing, never by the guard announcing it. The common property is that
 * **none had ever been observed to fire.** That is the condition the SRE Workbook names directly, about
 * the same class of thing:
 *
 * > "It's very likely that your alerting rules will not fire for months or years after you configure them,
 * > and you need to have confidence that when the metric passes a certain threshold, the correct engineers
 * > will be alerted with notifications that make sense."
 *   — *The Site Reliability Workbook*, ch4, "Testing Alerting Logic"
 *
 * Its prescription is a THREE-TIER test — does the signal move, does the rule fire, does the notification
 * reach someone — and its fallback when synthetic testing is impossible is "a running system that exports
 * well-known metrics". A gate here is an alerting rule: it watches for a condition, and when the condition
 * appears it must stop the pipeline with a message somebody can act on.
 *
 * ## What this test enforces, and what it deliberately does not
 *
 * It does NOT run the gates — most need a fleet, a corpus or a Python venv, so a test that tried would
 * skip in CI and prove nothing, which is the failure it exists to prevent.
 *
 * It enforces the BOOKKEEPING that makes the gap visible: every gate is either registered with the test
 * that mutation-proved it, or declared unproven WITH A REASON. `PROVEN_AT_LEAST` may only rise. That is
 * the same shape as `cli-flags.test.ts` (every argv-reading module guarded or exempted) and
 * `commands-documented.test.ts` (every script documented or declared INTERNAL) — the two patterns this
 * repo already trusts to stop a category rotting.
 *
 * **An unproven gate is not a broken gate.** It is one nobody has watched fail, which is exactly what
 * every entry in the list above was on the morning it cost a run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS } from "../../scripts/everything-pipeline.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPTS = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;

/**
 * A gate, the fault it catches, and the test that has WATCHED IT FAIL.
 *
 * `provenBy` names a test that mutation-checks the guard: it breaks the thing the gate protects and
 * asserts the gate refuses. A test that only exercises the happy path does not belong here — that is the
 * `refreshBrowseBuffer` defect, where three green runs vouched for a remedy that never executed.
 *
 * `unproven` is the honest alternative and takes a REASON. Reasons decay: "needs a fleet" was true of
 * `rules:coverage` until the eval fixtures turned out to be real captures sitting on disk.
 */
type GateProof =
  | { catches: string; provenBy: string }
  | { catches: string; unproven: string };

const GATE_PROOFS: Record<string, GateProof> = {
  "rules:coverage": {
    catches: "a rule that HAS fired on real evidence is reported as never validated, because 'real' "
      + "meant one directory and the eval fixtures were invisible to it",
    provenBy: "packages/lab/src/training/rule-coverage-populations.test.ts",
  },
  "rules:real-pages": {
    catches: "a baseline written from partial coverage silently erases the pages it was not shown — "
      + "measured, 85 -> 81, taking events.bl.uk's known 2.4.3 with it",
    provenBy: "packages/lab/src/training/real-page-baseline-coverage.test.ts",
  },
  "training:check-signals:complete": {
    catches: "a corpus signal that fires on both variants, or on neither, so a case discriminates nothing",
    unproven: "needs runs/ — the corpus is gitignored, so a proof would skip in CI and vouch for nothing. "
      + "`verify.corpus.test.ts` covers the adjacent claim (no gating predicate rejects real evidence) and "
      + "skips honestly when the corpus is absent",
  },
  "rules:gate": {
    catches: "a rule that scores well by having gone DEAF — quieter is only good if it still fires on the "
      + "corpus records it owns",
    unproven: "needs runs/; the same honest-skip problem as check-signals",
  },
  "scorer:verify": {
    catches: "an executable-on-load weight format (.pt, .pkl, .ckpt) in the shipped model directory",
    unproven: "no test plants a poisoned artefact and asserts refusal. This is the cheapest of the "
      + "unproven ones to close and it guards the only artefact this project publishes",
  },
  "scorer:migration": {
    catches: "a release while a feature-schema migration is open, so the weights and the featurizer "
      + "disagree about what the inputs mean",
    unproven: "no test opens a synthetic migration and asserts the gate refuses",
  },
  "scorer:shortcuts": {
    catches: "a head that gained a FREE veto — a feature constant at zero across a subtype's positives, "
      + "which no accuracy number can see because the held-out split has the same structure (ADR 0015)",
    unproven: "needs trained weights and the exported corpus",
  },
  "scorer:shortcuts:candidate": {
    catches: "the same, against the candidate rather than the shipped weights",
    unproven: "needs a trained candidate under runs/model-candidate. The weights are fitted heads, "
      + "so no fixture can supply one without reproducing a train",
  },
  "gate:isolation": {
    catches: "a train/test split that puts a near-duplicate of a training page in the held-out set",
    unproven: "needs the exported corpus and a train/test split large enough for the isolation "
      + "check to have something to separate",
  },
  "corpus:grants-audit": {
    catches: "a multi-defect page LABELLED for a defect whose evidence was never captured, so the head "
      + "learns to predict the label from something else",
    unproven: "needs the exported corpus; it did fire for real on 2026-08-27 (57 of 58) and that is an "
      + "observation, not a test",
  },
  "corpus:applicability-audit": {
    catches: "a precondition that silences a record labelled positive — strictly worse than the false "
      + "positive it removes, and invisible in any score",
    unproven: "needs the exported corpus; a synthetic labelled record could be hand-built to "
      + "trip it, which makes this among the cheapest of the unproven ones to close",
  },
  "training:evaluate-acceptance:candidate": {
    catches: "weights promoted without held-out acceptance having been run AGAINST THEM",
    unproven: "needs a trained candidate and the acceptance set",
  },
  "training:evaluate-acceptance:shipped": {
    catches: "the same, for the shipped weights at release time",
    unproven: "needs the acceptance set — and no fixture can supply it, because the artefact is produced by a "
      + "capture or a train rather than declared",
  },
  "promote:gated": {
    catches: "promotion on a failed candidate gate, or into a dirty tree",
    unproven: "needs a candidate; `releasability.test.ts` pins the DECISION rule it applies, which is the "
      + "half that can be tested offline",
  },
  "release:gate": {
    catches: "a release with any of the above unmet — it is the composite",
    unproven: "composite; proving it means proving its stages",
  },
  "eval:gate": {
    catches: "judge quality regressing against the 34 labelled fixtures",
    unproven: "needs the Python venv, so it cannot run in CI — the same limitation `npm run eval` has",
  },
};

/** Gates whose refusal has been WATCHED. May only rise. */
const PROVEN_AT_LEAST = 2;

function gatesInUse(): string[] {
  const chain = STEPS.filter((step: { gate?: boolean }) => step.gate)
    .map((step: { script: string }) => step.script);
  // `release:gate` is a shell chain of npm scripts; read it rather than restating it, or the two drift
  // and this test starts vouching for a list nobody runs.
  const release = [...String(SCRIPTS["release:gate"]).matchAll(/npm run ([a-z0-9:_-]+)/g)].map((m) => m[1]);
  return [...new Set([...chain, ...release])];
}

test("every gate that can stop the pipeline is registered", () => {
  const missing = gatesInUse().filter((gate) => !GATE_PROOFS[gate]);
  assert.deepEqual(missing, [],
    `gate(s) with no entry in GATE_PROOFS: ${missing.join(", ")}. A gate nobody has watched fail is the `
    + "defect this file exists to make visible — register it with the test that mutation-proves it, or "
    + "declare it unproven WITH A REASON.");
});

test("a registered proof names a test that exists and actually references the gate", () => {
  for (const [gate, proof] of Object.entries(GATE_PROOFS)) {
    if (!("provenBy" in proof)) continue;
    const path = join(REPO, proof.provenBy);
    assert.ok(existsSync(path), `${gate}: provenBy names ${proof.provenBy}, which does not exist`);
    // AND MENTIONS IT. A proof file that has nothing to say about the gate is this repo's "unverified
    // containment list written in test form" — `everything-chain.test.ts` makes the same demand of
    // `COVERED_BY` and explains why.
    const body = readFileSync(path, "utf8");
    const subject = gate.split(":").pop() ?? gate;
    assert.ok(body.includes(gate) || body.includes(subject),
      `${gate}: ${proof.provenBy} never mentions it, so it cannot be proving anything about it`);
  }
});

test("the number of gates whose refusal has been WATCHED never falls", () => {
  const proven = Object.values(GATE_PROOFS).filter((p) => "provenBy" in p).length;
  assert.ok(proven >= PROVEN_AT_LEAST,
    `${proven} of ${Object.keys(GATE_PROOFS).length} gates are proven, down from ${PROVEN_AT_LEAST}. `
    + "Removing a proof un-watches a gate that had been watched.");
});

test("every unproven gate gives a REASON, and the reason is not a shrug", () => {
  for (const [gate, proof] of Object.entries(GATE_PROOFS)) {
    if (!("unproven" in proof)) continue;
    // Length is a crude proxy and it is the right one here: the failure mode is "TODO" and "hard", which
    // read as decisions and are not. A reason long enough to name what is missing can be argued with.
    assert.ok(proof.unproven.length >= 40,
      `${gate}: "${proof.unproven}" is not a reason. Say what is needed and why it cannot be synthesised.`);
    assert.ok(proof.catches.length >= 20, `${gate}: must say what fault it catches, in the fault's terms`);
  }
});
