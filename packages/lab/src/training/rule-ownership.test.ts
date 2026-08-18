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

import { readRuleOwnership, ruleDecided } from "./rule-ownership.js";

const withDeclaration = (contents: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), "rule-ownership-")), "rule-ownership.json");
  writeFileSync(path, JSON.stringify(contents));
  return path;
};

test("the real declaration parses, and every entry is one of the two states", () => {
  const ownership = readRuleOwnership();
  assert.ok(ownership.size > 0, "an empty declaration would silently exempt nothing");
  for (const [subtype, entry] of ownership) {
    assert.match(subtype, /^\d+\.\d+\.\d+:[a-z0-9-]+$/, `${subtype} is not a corpus subtype key`);
    assert.ok(["rules", "overlap"].includes(entry.decidedBy));
  }
});

test("an overlap is NOT rule-decided — the head owns the records the rules do not reach", () => {
  // 2.4.4:regex is the live case: the rules cover 19 of 100 by a six-phrase vocabulary. Treating it as
  // rule-decided would suppress the scorer on the other 81 and exempt its head from blocking release.
  const path = withDeclaration({
    subtypes: {
      "4.1.2:regex": { decidedBy: "rules", reportsAs: "4.1.2" },
      "2.4.4:regex": { decidedBy: "overlap", reportsAs: "2.4.4" },
    },
  });
  assert.deepEqual(ruleDecided(readRuleOwnership(path)), ["4.1.2:regex"]);
});

test("the criterion a rule REPORTS may differ from the subtype's own, and is carried", () => {
  // The fact the whole design turns on: an unnamed form field is 3.3.2 in the corpus and a 4.1.2
  // finding from the rules. It lived in a Python comment the TypeScript side could not see, so that
  // side invented `4.1.2:unnamed-form-field` — a key matching no record.
  const ownership = readRuleOwnership();
  const crossReporting = [...ownership].filter(([key, e]) => !key.startsWith(`${e.reportsAs}:`));
  assert.deepEqual(crossReporting.map(([key]) => key), ["3.3.2:unnamed-form-field"]);
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
  assert.throws(() => readRuleOwnership(path), /expected "rules" or "overlap"/);
});

test("a reportsAs that is not a criterion number is rejected", () => {
  const path = withDeclaration({ subtypes: { "4.1.2:regex": { decidedBy: "rules", reportsAs: "4.1.2 Name, Role, Value" } } });
  assert.throws(() => readRuleOwnership(path), /expected a WCAG criterion number/);
});

test("a file with no subtypes object is a malformed declaration, not an empty one", () => {
  const path = withDeclaration({ note: ["all argument, no content"] });
  assert.throws(() => readRuleOwnership(path), /has no "subtypes" object/);
});
