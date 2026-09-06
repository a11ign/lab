/**
 * The declaration is the single source of truth for who decides what, so its READER has to refuse the
 * shapes that would quietly hand back a wrong answer.
 *
 * Every one of these mutations was run against the gate before this file existed and each fails it:
 * a key no record has, a `reportsAs` pointing at the wrong criterion, an undeclared overlap, and a
 * declared overlap the rules no longer touch. What the gate cannot check is the reader itself — an
 * unreadable or malformed file returning an empty map would report every head as the model's, which is
 * a wrong answer wearing a clean one's clothes. That is what these tests are for.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readRuleOwnership } from "./rule-ownership.js";

const withDeclaration = (contents: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), "rule-ownership-")), "rule-ownership.json");
  writeFileSync(path, JSON.stringify(contents));
  return path;
};

test("the real declaration parses, and every entry is one of the three states", () => {
  const ownership = readRuleOwnership();
  assert.ok(ownership.size > 0, "an empty declaration would silently exempt nothing");
  for (const [subtype, entry] of ownership) {
    assert.match(subtype, /^\d+\.\d+\.\d+:[a-z0-9-]+$/, `${subtype} is not a corpus subtype key`);
    assert.ok(["rules", "overlap", "unavailable"].includes(entry.decidedBy), `${subtype}: ${entry.decidedBy}`);
  }
});

test("`unavailable` is a state of its own — not rules, and not silently model-owned", () => {
  // The third state says NEITHER layer decides it, because the evidence cannot express the failure.
  // Collapsing it into "absent from this file" would make the subtype read as the model's, which is how
  // a criterion comes to look fully covered while one of its failure modes goes unchecked.
  const path = withDeclaration({
    subtypes: { "4.1.2:missing-role": { decidedBy: "unavailable", reportsAs: "4.1.2" } },
  });
  assert.equal(readRuleOwnership(path).get("4.1.2:missing-role")?.decidedBy, "unavailable");
});

test("an overlap is kept distinct from a rule-decided subtype", () => {
  // 2.4.4:regex is the live case: the rules cover 19 of 100 by a six-phrase vocabulary. Collapsing the
  // two states would suppress the scorer on the other 81 and exempt its head from blocking release.
  const path = withDeclaration({
    subtypes: {
      "4.1.2:regex": { decidedBy: "rules", reportsAs: "4.1.2" },
      "2.4.4:regex": { decidedBy: "overlap", reportsAs: "2.4.4" },
    },
  });
  const ownership = readRuleOwnership(path);
  assert.equal(ownership.get("4.1.2:regex")?.decidedBy, "rules");
  assert.equal(ownership.get("2.4.4:regex")?.decidedBy, "overlap");
});

test("a rule-decided subtype reports its OWN criterion, or the head it should replace cannot go", () => {
  // This asserted the opposite until 2026-08-23: exactly one entry cross-reported, and that was treated as
  // a fact of the design. It was a defect, and ADR 0017 records what it cost.
  //
  // `train-screenreader-model.py` substitutes a rule for a head only when the rule reports the head's own
  // criterion — correctly, because a rule answering a DIFFERENT criterion leaves the head as the only thing
  // that can produce a finding for this one. So a cross-reporting entry declares "the rules decide this" and
  // simultaneously guarantees the head stays. `3.3.2:unnamed-form-field` sat in that state: decided 115/115
  // by rules that reported only 4.1.2, so the head remained, and it produced EIGHT false accusations on
  // conformant form pages before anyone looked.
  //
  // The fix was to make the rule report 3.3.2 as well, which it should always have done — an unnamed input
  // has no accessible name AND no label. A future cross-reporting entry is the same trap, so it fails here.
  const ownership = readRuleOwnership();
  const crossReporting = [...ownership]
    .filter(([, e]) => e.decidedBy === "rules")
    .filter(([key, e]) => !key.startsWith(`${e.reportsAs}:`));
  assert.deepEqual(crossReporting.map(([key]) => key), [],
    "a rule-decided subtype whose rule reports a different criterion cannot substitute for its head, so the "
    + "head stays: load-bearing in production and answering a criterion nothing else covers. Either make the "
    + "rule report this criterion too, or mark the subtype model-decided and mean it.");
});

test("a missing file throws rather than reading as an empty boundary", () => {
  assert.throws(
    () => readRuleOwnership(join(tmpdir(), "no-such-rule-ownership.json")),
    /cannot read .*neither the rule gate nor the trainer knows the boundary/s,
  );
});

test("a bare family name is rejected — `regex` is three different subtypes", () => {
  const path = withDeclaration({ subtypes: { regex: { decidedBy: "rules", reportsAs: "4.1.2" } } });
  assert.throws(() => readRuleOwnership(path), /not a corpus subtype key/);
});

test("a state that is neither rules nor overlap is rejected, not treated as model-owned", () => {
  const path = withDeclaration({ subtypes: { "4.1.2:regex": { decidedBy: "model", reportsAs: "4.1.2" } } });
  assert.throws(() => readRuleOwnership(path), /expected one of rules, overlap, unavailable/);
});

test("a reportsAs that is not a criterion number is rejected", () => {
  const path = withDeclaration({ subtypes: { "4.1.2:regex": { decidedBy: "rules", reportsAs: "4.1.2 Name, Role, Value" } } });
  assert.throws(() => readRuleOwnership(path), /expected a WCAG criterion number/);
});

test("a file with no subtypes object is a malformed declaration, not an empty one", () => {
  const path = withDeclaration({ note: ["all argument, no content"] });
  assert.throws(() => readRuleOwnership(path), /has no "subtypes" object/);
});

test("modelHead: false is accepted when it carries a why", () => {
  const path = withDeclaration({
    subtypes: {
      "1.4.2:autoplay-uncontrollable": {
        decidedBy: "rules", reportsAs: "1.4.2", modelHead: false, why: "no corpus case yet",
      },
    },
  });
  const entry = readRuleOwnership(path).get("1.4.2:autoplay-uncontrollable");
  assert.equal(entry?.modelHead, false);
  assert.equal(entry?.why, "no corpus case yet");
});

test("modelHead: false with no why is rejected -- two entries need opposite reasons, neither is optional", () => {
  const path = withDeclaration({
    subtypes: {
      "2.4.7:focus-removed-on-receipt": { decidedBy: "rules", reportsAs: "2.4.7", modelHead: false },
    },
  });
  assert.throws(() => readRuleOwnership(path), /modelHead: false with no "why"/);
});

test("modelHead: true is rejected -- absence is the only spelling of \"a head is fitted\"", () => {
  const path = withDeclaration({
    subtypes: {
      "4.1.2:regex": { decidedBy: "rules", reportsAs: "4.1.2", modelHead: true, why: "not applicable" },
    },
  });
  assert.throws(() => readRuleOwnership(path), /the only value this ever takes is `false`/);
});

test("an entry with no modelHead field at all is unaffected -- the ordinary, overwhelmingly common case", () => {
  const path = withDeclaration({ subtypes: { "4.1.2:regex": { decidedBy: "rules", reportsAs: "4.1.2" } } });
  const entry = readRuleOwnership(path).get("4.1.2:regex");
  assert.equal(entry?.modelHead, undefined);
});
