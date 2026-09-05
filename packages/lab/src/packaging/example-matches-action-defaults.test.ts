import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/**
 * `examples/workflow.yml` is the five lines a stranger copies. It must not contradict `action.yml`.
 *
 * It did: the example set `probe-forms: "false"` while the action defaults it TRUE, and explained the
 * choice with the CLI's rationale rather than the action's. The split is deliberate and follows WHO OWNS
 * THE PAGE (ADR 0024) — a workflow runs against your own app, where submitting is intended and 3.3.1 and
 * 4.1.3 are otherwise structurally unreachable, while the CLI can be aimed at any URL. So the copied
 * example silently made two criteria unassessable in a user's first ten minutes, and the comment beside
 * it argued for doing so.
 *
 * DERIVED FROM `action.yml`, never restated here: this file reads the action's own declared default and
 * compares. A test carrying its own copy of "true" would be a third place the default is written down,
 * which is the defect it exists to catch.
 *
 * Deliberately narrow — it checks the inputs the example actually SETS, not every input the action has.
 * An example is allowed to omit an input (that is what a default is for) and allowed to differ where
 * differing is the point being demonstrated; what it may not do is set a value that contradicts the
 * default while presenting itself as ordinary usage. If a future example needs to differ deliberately,
 * add it to `DELIBERATE` with the reason rather than deleting the check.
 */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Inputs the example may set differently from the action's default, each with a reason. */
const DELIBERATE: Record<string, string> = {
  // `fail-on: never` is the example's whole teaching point — report without failing the build until you
  // know what the tool says about your site. The action defaults to `never` anyway, so this is belt and
  // braces rather than a divergence, and it is listed so a future default change is a deliberate call.
  "fail-on": "the example teaches starting non-blocking; it happens to match the default today",
};

test("examples/workflow.yml does not contradict action.yml's declared defaults", () => {
  const action = parse(readFileSync(`${REPO}action.yml`, "utf8")) as {
    inputs: Record<string, { default?: unknown }>;
  };
  const example = parse(readFileSync(`${REPO}examples/workflow.yml`, "utf8")) as {
    jobs: Record<string, { steps: { uses?: string; with?: Record<string, unknown> }[] }>;
  };

  const withBlocks = Object.values(example.jobs)
    .flatMap((job) => job.steps)
    .filter((step) => String(step.uses ?? "").includes("a11y-witness"))
    .map((step) => step.with ?? {});
  // Vacuity guard: a renamed action reference, or a restructured example, would leave nothing to compare
  // and this test would pass having read no inputs at all.
  assert.ok(withBlocks.length > 0,
    "found no a11y-witness step in examples/workflow.yml — the example was restructured and this test is "
    + "checking nothing");

  const contradictions: string[] = [];
  for (const inputs of withBlocks) {
    assert.ok(Object.keys(inputs).length > 0, "the example's a11y-witness step sets no inputs at all");
    for (const [name, value] of Object.entries(inputs)) {
      if (name in DELIBERATE) continue;
      const declared = action.inputs?.[name]?.default;
      if (declared === undefined) continue; // no default to contradict
      if (String(value) !== String(declared)) {
        contradictions.push(`${name}: example says ${JSON.stringify(String(value))}, `
          + `action.yml defaults to ${JSON.stringify(String(declared))}`);
      }
    }
  }
  assert.deepEqual(contradictions, [],
    "examples/workflow.yml sets an input to the OPPOSITE of the action's own default, so a copied "
    + "workflow behaves differently from the documented behaviour: " + contradictions.join("; ")
    + ". Either match the default, or add the input to DELIBERATE with the reason it differs.");
});
