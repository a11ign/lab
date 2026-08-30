import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * The functions a gate may build its verdict with.
 *
 * `fleetVerdict` is here because a gate that shards its work across the fleet aggregates one level up, and
 * it is coverage-derived for the same reason `gateVerdict` is — it IS `gateVerdict`, over the boxes'
 * results. Widening this list on that say-so alone would be the hole it exists to close, so the next test
 * PROVES the delegation rather than trusting this comment.
 */
const DERIVED_VERDICT = /\b(gateVerdict|fleetVerdict)\(/;

test("fleetVerdict is only allowed here because it DELEGATES — proved, not asserted in a comment", () => {
  const source = readFileSync(resolve(ROOT, "packages/lab/src/gates/fleet.mjs"), "utf8");
  assert.match(source, /export function fleetVerdict[\s\S]*?\breturn gateVerdict\(/,
    "fleetVerdict must build its result with gateVerdict(). If it ever computes a verdict itself, every "
    + "gate that uses it silently loses the coverage guarantee, and this list would still be waving them "
    + "through.");
});


/**
 * EVERY GATE SCRIPT EITHER DERIVES ITS VERDICT FROM COVERAGE, OR SAYS WHY NOT — determinism-plan D6.
 *
 * A DISCOVERY test, not a list, for the reason `cli-flags.test.ts` gives: a list records the scripts that
 * existed when somebody last looked. A twelfth gate joins the unguarded ones silently.
 *
 * The rule it enforces is narrow and was learned the expensive way: printing the population is not enough.
 * `evidence-check` printed its coverage and passed on 2 of 48 anyway, because its guard tested
 * `compared === 0` — its own comment "named the general rule and then covered only the extreme case".
 * `gateVerdict` makes the middle unconstructible.
 *
 * THE EXEMPTIONS CARRY REAL REASONS, and are a WORK LIST rather than a way of passing. Most of these gates
 * predate the shape and each needs its own migration; saying so is the honest state, and an exemption whose
 * reason is "not yet" is one somebody can pick up.
 */
const ROOT = resolve(import.meta.dirname, "../../../..");

/**
 * Why each script does not derive a verdict — as DATA, not prose to be parsed.
 *
 * The first version made `category` a regex over the reason text and rejected its own entry, because it
 * matched lowercase "audit" and the reason said "AUDIT". A check that infers a category from wording is the
 * same defect this whole item is about, one level up: carry the fact, do not re-derive it.
 *
 * `owed` is a WORK LIST. `not-a-gate` is a decision, and each says what makes it one.
 */
const EXEMPT: Record<string, { category: "owed" | "not-a-gate" | "deliberate"; why: string }> = {
  "audit-corpus-starvation.mjs": { category: "not-a-gate",
    why: "emits a work list, and `IMPOSSIBLE_BY_DEFINITION` items mean a shorter list is not a better "
      + "score. There is no pass/fail here to condition on coverage" },
  "audit-corpus-urls.mjs": { category: "not-a-gate",
    why: "audits whatever URLs the corpus declares; its population IS the corpus and cannot be short" },
  "audit-size-sensitivity.mjs": { category: "not-a-gate",
    why: "a measurement: it reports a curve across sample sizes rather than a verdict" },
  "audit-observation-ambiguity.mjs": { category: "not-a-gate",
    why: "reports what fraction of a channel's zeros are capture artefacts. A high number is a fact about "
      + "the capture path rather than a defect a commit introduced, and it DOES exit 2 on an empty corpus, "
      + "which is the coverage half this shape exists for" },
  "audit-rule-coverage.ts": { category: "not-a-gate",
    why: "audits which criteria have never fired. Its population is every rule there is and cannot be "
      + "short — `fired 0x` is its finding, not a coverage gap" },
  "emit-unclosable-vetoes.mjs": { category: "not-a-gate",
    why: "emits data for another program to read; it has no verdict" },
  "emit-grants-map.mjs": { category: "not-a-gate",
    why: "emits the JS-side `grants` declarations for the Python audit, which REFUSES without it rather "
      + "than examining an empty set — that file's version of this same rule" },

  "evidence-check.mjs": { category: "deliberate",
    why: "CONSIDERED AND DECIDED AGAINST, 2026-08-28. Its coverage rule is already correct — `compared === "
      + "0 || compared < attempted` — so migrating buys nothing behavioural, and it would FLIP a decision "
      + "someone made on purpose: this gate ranks INCONCLUSIVE above CHANGED (`inconclusive ? 2 : changed ? "
      + "1 : 0`), where `gateVerdict` ranks failures first. Its comment gives the reason — 'the sample is "
      + "STRATIFIED one case per family, so a skipped capture is a family about which this tool now has no "
      + "opinion... Full coverage or no verdict'. Adding a flag to `gateVerdict` to support both orderings "
      + "would be the conflation D6 exists to remove, wearing a shared function's clothes" },
};

function discoverGates(): string[] {
  const out = execFileSync("git", ["ls-files", "packages/lab/scripts"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n")
    .filter((f) => /\.(mjs|ts)$/.test(f) && !f.includes(".test."))
    .map((f) => f.split("/").pop()!)
    .filter((name) => /^(gate|check|audit|score|evidence|stability|emit)/.test(name))
    .sort();
}

const gates = discoverGates();

test("the gates are DISCOVERED, not trusted from a list", () => {
  // Guards the discovery. A rename would otherwise leave every assertion below iterating an empty array.
  assert.ok(gates.length >= 10, `discovered only ${gates.length}: ${gates.join(", ")}`);
  assert.ok(gates.includes("gate-probe-order.mjs"));
});

for (const name of gates) {
  const exempt = EXEMPT[name];
  test(exempt ? `${name} is exempt (${exempt.category})` : `${name} derives its verdict from coverage`, () => {
    const source = readFileSync(resolve(ROOT, "packages/lab/scripts", name), "utf8");
    if (exempt) {
      assert.ok(exempt.why.length > 40, `${name}'s exemption needs a real reason, not a word`);
      // BOTH DIRECTIONS. An exemption outliving its migration is a work list claiming work that is done —
      // `stability-gate.mjs` sat here for one commit after being migrated, and the test kept announcing it
      // as owed. A list only stays honest if being ON it wrongly fails too.
      assert.doesNotMatch(source, DERIVED_VERDICT,
        `${name} already derives its verdict — delete its EXEMPT entry`);
      return;
    }
    assert.match(source, DERIVED_VERDICT,
      `${name} must build its verdict with gateVerdict() or fleetVerdict(), or be listed in EXEMPT with a `
      + "reason. A gate that reports PASS without conditioning on what it examined is the 2-of-48 defect.");
  });
}

test("the exemption list is a WORK LIST, and every entry still exists", () => {
  const owed = Object.entries(EXEMPT).filter(([, e]) => e.category === "owed").map(([n]) => n);
  // `deliberate` is a DECISION, not a backlog item, and it must not be silently reclassified into one.
  // Every entry carries the reasoning so the next reader can disagree with it on the merits rather than
  // assume it was an oversight.
  for (const [name, e] of Object.entries(EXEMPT)) {
    if (e.category !== "deliberate") continue;
    assert.ok(e.why.length > 200, `${name} was decided against — the reason must be long enough to argue `
      + "with, or it will read as an excuse");
  }
  for (const name of Object.keys(EXEMPT)) {
    assert.ok(gates.includes(name), `${name} is exempted but no longer exists — delete its line`);
  }
  // The backlog is EMPTY as of 2026-08-28, and `owed` stays in the type rather than being deleted with the
  // last entry: a gate added tomorrow starts unmigrated, and the next person needs somewhere to say so that
  // is not a comment. What was deleted is the assertion demanding the list be non-empty — it existed to keep
  // the remaining work visible in test output, and it fired the moment the work was done, which is the
  // correct end for a work-list assertion rather than a defect in it.
  assert.equal(owed.length, 0,
    `${owed.length} gate(s) still owed the verdict shape: ${owed.join(", ")}`);
});
