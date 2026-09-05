/**
 * `rules:gate` must refuse a rule that has gone DEAF and a rule that accuses a conformant page.
 *
 * ## The two failures it exists to catch, and why one of them nearly shipped
 *
 * **MISSING EVIDENCE** — a record labelled for a rule-decided subtype that the rules did not catch. This
 * is the failure that matters most, because the obvious way to fix a noisy rule is to narrow it, and a
 * narrowed rule looks identical to a fixed one from the real-page side. CLAUDE.md records the day it
 * happened: a `2.4.3` rewrite took the rule from firing on 71% of conformant real pages to 6% — and
 * caught **0 of the 4 corpus records it owns**. NVDA wraps a field's label and role onto separate
 * transcript lines, so requiring both on one line found nothing. *"The real-page number looked excellent
 * for the worst possible reason, and it would have shipped."* `rules:gate` refused it.
 *
 * **FALSE POSITIVE** — a rule firing on a record the corpus declares conformant. 1,183 conformant records
 * with 0 false positives is the claim that lets the rules layer ASSERT rather than refer, so a single one
 * is a release blocker.
 *
 * ## Why this needs no corpus
 *
 * `tally`, `verdictOf` and `falsePositiveFailures` are pure over a list of records, and `ruleFindings`
 * is pure over one. Three hand-built records reach all three verdicts. The register's premise for this
 * gate — "needs runs/" — is false for the DECISION, which makes it eight for eight; see
 * `docs/proving-a-gate.md`.
 *
 * What genuinely needs the corpus is the SCALE of the claim: 1,183 conformant records is evidence a
 * fixture cannot supply. That half stays declared unproven rather than implied covered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tally, verdictOf, falsePositiveFailures } from "../../scripts/score-rules.js";

/** A subtype the rules OWN, so a record labelled with it is theirs to catch. */
// `4.1.2:unnamed-control` since 2026-09-05. This was `3.3.2:unnamed-form-field`, which no longer
// exists: its 133 records were re-declared because W3C does not require a label to be ASSOCIATED for
// 3.3.2 -- that is 1.3.1 -- and every one of their bad pages carried visible label text, so the subtype
// had ZERO genuine failures. The EVIDENCE is unchanged, which is why the fixtures below still work: a
// form field announced as its role alone. Only the criterion it is filed under moved.
const OWNED = "4.1.2:unnamed-control";

/** A form field announced as its ROLE alone — the failure `4.1.2` is about: a role with no name. */
const UNNAMED_FIELD = {
  transcript: ["heading, level 1, Delivery details", "form, edit", "edit"],
  structure: { formFields: ["edit"], headings: ["heading, level 1, Delivery details"] },
  interaction: {},
};

/** The same page with the field labelled. Conformant, and the rules must stay silent on it. */
const NAMED_FIELD = {
  transcript: ["heading, level 1, Delivery details", "Full name", "edit"],
  structure: { formFields: ["Full name, edit"], headings: ["heading, level 1, Delivery details"] },
  interaction: {},
};

/**
 * A record shaped as far as the gate reads it.
 *
 * `label: "clean"` is what marks a conformant record, NOT an empty subtype list — a distinction the first
 * version of this test got wrong, and the false-positive assertion then examined nothing while passing
 * the other four. Worth stating because "no labels" and "labelled clean" look interchangeable and are not:
 * the second is a claim by the corpus that the page is conformant, which is what makes a rule firing on
 * it an accusation.
 */
function record(id: string, subtypes: string[], input: object) {
  return {
    provenance: { caseId: id, variant: subtypes.length ? "bad" : "good" },
    target: { subtypes, label: subtypes.length ? "fails" : "clean" },
    input,
  };
}

test("a rule-owned record whose evidence carries the failure reads EXACT", () => {
  const coverage = tally([record("planted-caught", [OWNED], UNNAMED_FIELD)] as never);
  const entry = coverage.get(OWNED)!;
  assert.equal(entry.dueByRule, 1, "a record labelled for a rule-owned subtype is the rules' to decide");
  assert.equal(entry.caughtByRule, 1, "the rules must catch it — the evidence carries an unnamed field");
  assert.match(verdictOf(OWNED, entry), /EXACT/);
});

test("a rule-owned record whose evidence does NOT carry it reads MISSING EVIDENCE", () => {
  // THE DEAF-RULE CASE. Labelled for the failure, evidence shows a properly named field, so the rules
  // cannot catch it — which is what a narrowed rule looks like from the corpus side, and is exactly the
  // 2.4.3 rewrite that would otherwise have shipped.
  const coverage = tally([record("planted-deaf", [OWNED], NAMED_FIELD)] as never);
  const entry = coverage.get(OWNED)!;
  assert.equal(entry.dueByRule, 1);
  assert.equal(entry.caughtByRule, 0);
  assert.match(verdictOf(OWNED, entry), /MISSING EVIDENCE/,
    "a rule that stopped catching what it owns must be named, not averaged away");
  assert.deepEqual(entry.missed, ["planted-deaf.bad"],
    "and the record must be named — a count is where an investigation stops");
});

test("a rule firing on a CONFORMANT record is a false positive and is reported", () => {
  // A conformant record carries no subtypes. Any finding on it is an accusation against a page the corpus
  // declares clean, and this is the claim that lets the rules layer ASSERT rather than refer.
  const failures = falsePositiveFailures([record("planted-fp", [], UNNAMED_FIELD)] as never);
  assert.ok(failures.length > 0, "a rule firing on a conformant record must fail the gate");
  assert.ok(failures.some((f) => f.includes("planted-fp")),
    `the failure must name the record: got ${JSON.stringify(failures)}`);
});

test("a conformant record the rules stay silent on produces no failure", () => {
  // The control. Without it every assertion above is satisfied by a gate that fails on everything, which
  // would be safe, useless, and bypassed with A11Y_SKIP_VERIFY the first time it blocked a push.
  assert.deepEqual(falsePositiveFailures([record("planted-clean", [], NAMED_FIELD)] as never), []);
});

test("a record the rules do NOT own is not counted against them", () => {
  // The distinction `credit()` exists for: a record is the rules' to decide when it carries a rule-owned
  // subtype, not when the subtype under examination happens to be the owned one. Without this, every
  // model-owned subtype would read as a ragged boundary.
  const modelOwned = "1.3.1:fake-heading";
  const coverage = tally([record("planted-model", [modelOwned], NAMED_FIELD)] as never);
  const entry = coverage.get(modelOwned)!;
  assert.equal(entry.dueByRule, 0, "the rules do not own this subtype, so they owe nothing on this record");
  assert.doesNotMatch(verdictOf(modelOwned, entry), /MISSING EVIDENCE/,
    "a model-owned subtype must never read as a rule failure");
});
