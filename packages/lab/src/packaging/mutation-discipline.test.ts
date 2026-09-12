/**
 * #1165: THE SECTION THAT RECORDS A PROBE WHOSE OWN HEALTH IS INVISIBLE IN ITS OWN OUTPUT.
 *
 * Nine instances on 2026-09-12 between two agents, each an instrument that did not run rendering
 * identically to one that ran and passed. **This is not the vacuity shape** — a guard that cannot fail is
 * #1123 and the `local/uncontrolled-emptiness` rule. It is one level earlier: the failure mode and the
 * success value are the same glyph.
 *
 * NO GUARD IS POSSIBLE AND THE ROW SAYS SO. A machine cannot tell a mutation that applied from one that
 * did not without being told what the mutation was, which is the same regress. So the deliverable is a
 * written record, and what this file holds is that the record keeps the parts a reader needs:
 *
 *   1. the PROPERTY, not only the anecdotes -- anecdotes age out and a property transfers
 *   2. what each probe PRINTED, which is the transferable half: it is what the next person is looking at
 *   3. the checks as COMMANDS -- a rule with nothing to run is one nobody re-checks
 *
 * ASSERTED ON FLATTENED TEXT throughout. The page wraps at 110 characters, so a load-bearing phrase
 * spanning a wrap is likely rather than incidental, and the failure is a silent non-match that reads
 * exactly like the prose being absent. That cost three separate discoveries on 2026-09-12 alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LESSONS = fileURLToPath(new URL("../../../../docs/operational-lessons.md", import.meta.url));
const flat = () => readFileSync(LESSONS, "utf8").replace(/\s+/g, " ");

test("#1165: the section states the PROPERTY, so it transfers past the nine anecdotes", () => {
  const text = flat();

  assert.match(text, /the failure mode and the success value are the same glyph/i,
    "the property itself, and the phrase the row's open-check greps for -- without it the section is a "
    + "list of nine things that happened to two agents on one afternoon");
  assert.match(text, /probe whose own health is invisible in its own output/i,
    "and the name, so a tenth instance can be recognised as one rather than filed as new");
  assert.match(text, /not the vacuity shape|#1123/,
    "and what it is NOT: a guard that cannot fail is a different family with a different remedy, and "
    + "collapsing the two is how the rule for one gets pointed at the other");
});

test("#1165: every instance records what the probe PRINTED, not only what was wrong with it", () => {
  const text = flat();

  // The printed value is the transferable half: it is what the next person will be looking at when they
  // are about to make the same mistake. A table of causes teaches nothing at the moment of the error.
  for (const printed of ["`0 red`", "`19/0`", "no output at all", "`[]`", "`fail 0`"]) {
    assert.ok(text.includes(printed),
      `the section must record the OUTPUT ${printed}, since a reader recognises this defect by what they `
      + "are looking at, never by its cause");
  }
  assert.match(text, /uniform answer across a varied set/i,
    "and the one tell that works without knowing the cause");
});

test("#1165: the remedy is the general sentence, not only the mutation-specific one", () => {
  const text = flat();

  assert.match(text, /assert the anchor matched before you read the count/i,
    "the mutation case, which is where this was first noticed");
  assert.match(text, /assert the tool ANSWERED before you read its answer/i,
    "and the general one, without which instance 8 -- a parse error read through `grep -c` -- is not "
    + "covered at all, because it was not a mutation");
  assert.match(text, /do not COUNT a tool's output when the tool can also refuse/i,
    "and the operational form, which is the only one of the three you can apply while typing a command");
});

test("#1165: the checks are COMMANDS, and each names which instances it catches", () => {
  const text = flat();

  for (const check of ["print the mutated line back", "count the arguments the shell actually built",
    "assert the anchor matched", "read the tool's own message, never a count of it"]) {
    assert.ok(text.includes(check), `the check "${check}" must be stated as something to DO`);
  }
  assert.match(text, /catches 8 and 9/,
    "and each must say what it catches -- a list of four good habits with no mapping to the failures is "
    + "advice, and this repository has measured what advice is worth");
});

test("#1165: it says why NO GUARD, and gives the ratio rather than only the conclusion", () => {
  const text = flat();

  assert.match(text, /cannot tell a mutation that applied from one that did not/i,
    "the reason a guard is impossible, stated so the next person does not spend an afternoon proving it");
  assert.match(text, /five of the nine were caught by the person holding the probe/i,
    "and the measured split, which is the actual argument");
  assert.match(text, /caught by review or by a pre-declared expectation/i,
    "because the conclusion -- that care caught the cheap ones and review caught the expensive ones -- is "
    + "the opposite of the instinct this list produces, and only the ratio supports it");
});

test("#1165 MUTATION: softening the property must go red, and the count is not the property", () => {
  const text = flat();

  // KEEP THE TEXT, CHANGE THE MEANING. Deleting the section is the mutation a weak guard agrees with;
  // this one leaves the section in place and removes only the sentence that makes it transferable.
  const softened = text.replace(/the failure mode and the success value are the same glyph/i, "it is subtle");
  assert.notEqual(softened, text, "the mutation must LAND, or this test proves nothing -- #1165's own subject");
  assert.doesNotMatch(softened, /the failure mode and the success value are the same glyph/i,
    "a section that lists nine incidents without the property is nine anecdotes, and the next instance "
    + "will not look like any of them");

  // And the number of instances is deliberately NOT asserted: a tenth is expected, and a test pinning
  // `nine` would refuse the next honest addition while proving nothing about whether the record is useful.
  assert.doesNotMatch(text, /exactly nine instances and no more/i);
});
