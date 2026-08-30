import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A GATE THAT DECIDES A CANDIDATE MUST EXAMINE THE CANDIDATE — known-gaps §20.
 *
 * `candidate:gate` chained `npm run scorer:shortcuts`, whose `--model` defaults to the SHIPPED weights at
 * `packages/scorer/models/screenreader-scorer`. Measured on one corpus, one audit, both models:
 *
 *     shipped v15    142 positives  1 closable  -5.13  table_header_associated
 *     candidate v16  142 positives  0 closable   0.00  -
 *
 * So a promote was refused for a weight belonging to the model it was about to replace.
 *
 * This is the repo's most-recorded shape, inverted. The usual form is "a gate that does not exercise what
 * ships"; `npm run eval` had this exact one — it "resolved the SHIPPED artefact always, so a candidate's
 * judge quality was unknowable until after promotion". Second gate, same defect, which is why this is a
 * DISCOVERY test over the chain rather than one assertion about one script.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const scripts = (): Record<string, string> =>
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;

/** The npm scripts `candidate:gate` runs, in order. */
function chain(): string[] {
  const gate = scripts()["candidate:gate"];
  assert.ok(gate, "candidate:gate is missing; this test cannot be examining anything");
  return [...gate.matchAll(/npm run (?:--silent )?([\w:.-]+)/g)].map((m) => m[1]);
}

test("no stage of candidate:gate resolves the SHIPPED model directory", () => {
  const all = scripts();
  const offenders: string[] = [];
  for (const stage of chain()) {
    const body = all[stage] ?? "";
    // Naming the shipped path outright is the loud version of the defect.
    if (/packages\/scorer\/models/.test(body)) offenders.push(`${stage}: ${body}`);
  }
  assert.deepEqual(offenders, [], "these stages read the SHIPPED weights while gating a candidate:\n  "
    + offenders.join("\n  "));
});

test("the shortcuts stage names the candidate explicitly", () => {
  // The QUIET version, and the one that actually bit: `audit-scorer-shortcuts.py` DEFAULTS `--model` to
  // the shipped directory, so a stage that passes no `--model` reads the incumbent while looking
  // innocent. Absence of an argument is the defect, which is why this asserts presence.
  const gate = scripts()["candidate:gate"];
  assert.match(gate, /scorer:shortcuts[^&]*--model runs\/model-candidate/,
    "candidate:gate must pass `--model runs/model-candidate` to the shortcuts audit; without it the "
    + "script defaults to packages/scorer/models/screenreader-scorer and gates the model being replaced");
});

test("it does NOT silence the baseline comparison to get past itself", () => {
  // `scorer:shortcuts:candidate` exists and passes `--no-baseline`. Reaching for it here would fix the
  // model and lose the regression check — trading one blind spot for another, which is the failure mode
  // of every "make the gate pass" fix. The baseline must still apply to the candidate.
  //
  // RESOLVED THROUGH THE CHAIN, not matched in `candidate:gate`'s own text. The first version of this
  // looked for a literal `--no-baseline` beside `scorer:shortcuts`, which a swap to
  // `scorer:shortcuts:candidate` sails straight past — the flag then lives one script away. Mutation
  // showed that swap being caught only by the `--model` test above, so this one was examining nothing it
  // was written for: a guard that passes because the defect moved is not a guard.
  const all = scripts();
  const offenders = chain()
    .filter((stage) => /--no-baseline/.test(all[stage] ?? ""))
    .map((stage) => `${stage}: ${all[stage]}`);
  assert.deepEqual(offenders, [], "these stages of candidate:gate silence the veto-regression check:\n  "
    + offenders.join("\n  "));
});
