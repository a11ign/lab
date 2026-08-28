import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

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
const EXEMPT: Record<string, { category: "owed" | "not-a-gate"; why: string }> = {
  "audit-corpus-starvation.mjs": { category: "not-a-gate",
    why: "emits a work list, and `IMPOSSIBLE_BY_DEFINITION` items mean a shorter list is not a better "
      + "score. There is no pass/fail here to condition on coverage" },
  "audit-corpus-urls.mjs": { category: "not-a-gate",
    why: "audits whatever URLs the corpus declares; its population IS the corpus and cannot be short" },
  "audit-size-sensitivity.mjs": { category: "not-a-gate",
    why: "a measurement: it reports a curve across sample sizes rather than a verdict" },
  "audit-rule-coverage.ts": { category: "not-a-gate",
    why: "audits which criteria have never fired. Its population is every rule there is and cannot be "
      + "short — `fired 0x` is its finding, not a coverage gap" },
  "emit-unclosable-vetoes.mjs": { category: "not-a-gate",
    why: "emits data for another program to read; it has no verdict" },
  "emit-grants-map.mjs": { category: "not-a-gate",
    why: "emits the JS-side `grants` declarations for the Python audit, which REFUSES without it rather "
      + "than examining an empty set — that file's version of this same rule" },

  "score-rules.ts": { category: "owed",
    why: "already prints six populations and reports INCONCLUSIVE when the corpus cannot attribute a "
      + "problem, so migrating is mechanical — but it guards every rule, so do it with `rules:gate` green "
      + "before and after" },
  "evidence-check.mjs": { category: "owed",
    why: "the reason the shape exists: it passed on 2 of 48 because its guard covered `compared === 0` "
      + "rather than `compared < expected`. Fixed by hand since; migrating replaces that hand-rolled guard "
      + "with one that cannot be written too narrowly" },
  "check-real-page-findings.ts": { category: "owed",
    why: "its population is the 86 conformant real pages and it names them, but the verdict is not yet "
      + "derived from how many were actually scored" },
  "check-dataset-distribution.mjs": { category: "owed",
    why: "answers 'is any field empty on EVERY record', which is already a coverage question — likely the "
      + "easiest to move" },
  "check-shipped-provenance.mjs": { category: "owed",
    why: "examines one artefact, so coverage is 1 of 1 and the shape adds little beyond consistency; "
      + "lowest priority" },
  "stability-gate.mjs": { category: "owed",
    why: "says 'N/N canaries stable', so the population is stated; the verdict is not derived from it" },
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
    if (exempt) {
      assert.ok(exempt.why.length > 40, `${name}'s exemption needs a real reason, not a word`);
      return;
    }
    const source = readFileSync(resolve(ROOT, "packages/lab/scripts", name), "utf8");
    assert.match(source, /\bgateVerdict\(/,
      `${name} must build its verdict with gateVerdict(), or be listed in EXEMPT with a reason. A gate `
      + "that reports PASS without conditioning on what it examined is the 2-of-48 defect.");
  });
}

test("the exemption list is a WORK LIST, and every entry still exists", () => {
  const owed = Object.entries(EXEMPT).filter(([, e]) => e.category === "owed").map(([n]) => n);
  for (const name of Object.keys(EXEMPT)) {
    assert.ok(gates.includes(name), `${name} is exempted but no longer exists — delete its line`);
  }
  // Stated so the remaining work is visible in the test output rather than only in a plan nobody opens.
  assert.ok(owed.length > 0, "if nothing is owed, delete this assertion along with the last owed entry");
  process.stdout.write(`      ${owed.length} gate(s) still owed the verdict shape: ${owed.join(", ")}\n`);
});
