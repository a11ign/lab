/**
 * WHO DECIDES EACH SUBTYPE is declared once, in `rule-ownership.json` at this repository's root, and the
 * claims made about it are pinned against the declaration rather than retyped.
 *
 * Moved from the core's `asserting-subtypes.test.ts` and `subtype-ownership.test.ts` (ADR 0045 cut 1), which read
 * the file through the core's `packages/lab/` path. The ACT mapping is read from the published
 * `@a11ign/judge/act-rules`, the declaration from here, and neither from another repository's source tree.
 *
 * What did NOT move, and why. Two assertions read the core's own files: that `CLAUDE.md`'s prose states the
 * asserting count (it reads the core's `CLAUDE.md`), and that `criterion-coverage.ts` no longer lists subtype
 * owners (it reads that source text, which a published export of the VALUES cannot show: the check is on the
 * comments and prose around them). Both stay in the core's two tests until the row that deletes the core's
 * copies decides where they read the declaration from.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACT_RULES } from "@a11ign/judge/act-rules";
import { LAB_ROOT } from "./lab-sources.ts";

type Owner = { decidedBy?: string };

function ownership(): Record<string, Owner> {
  const parsed = JSON.parse(readFileSync(join(LAB_ROOT, "rule-ownership.json"), "utf8")) as
    { subtypes?: Record<string, Owner> };
  return parsed.subtypes ?? (parsed as unknown as Record<string, Owner>);
}

const objects = (): Owner[] => Object.values(ownership()).filter((v) => typeof v === "object" && v !== null);

test("the four subtypes that may ASSERT are exactly these, and no others have joined", () => {
  const rulesOwned = Object.entries(ownership()).filter(([, v]) => v.decidedBy === "rules").map(([k]) => k);
  const assertingCriteria = new Set(
    ACT_RULES.flatMap((r) => r.accessibilityRequirements)
      .filter((req) => req.mapping === "conformance")
      .map((req) => req.criterion),
  );
  // The population controls: a declaration or a mapping read as empty would make the deepEqual below the only
  // thing standing between this test and passing on nothing, and it names four subtypes, not "some".
  assert.ok(rulesOwned.length > 0, "no subtype is rules-owned: the declaration was read as empty");
  assert.ok(assertingCriteria.size > 0, "no criterion maps to `conformance`: the ACT rules were read as empty");

  const asserting = rulesOwned.filter((k) => assertingCriteria.has(k.split(":")[0])).sort();
  assert.deepEqual(asserting, [
    "1.1.1:filename-alt",
    "1.1.1:missing-alt",
    "4.1.2:state-change-silent",
    "4.1.2:unnamed-control",
  ], "the set of subtypes that assert a conformance failure changed. That is the strongest claim this "
    + "tool makes: say so in the core's CLAUDE.md table and in the audit before changing it.");
});

test("every subtype declares an owner, and only from the vocabulary that exists", () => {
  // A typo'd `decidedBy` would silently make a subtype non-rules-owned, which is the direction that
  // matters: the rules are the only layer allowed to ASSERT.
  const KNOWN = new Set(["rules", "overlap", "unavailable"]);
  const bad = Object.entries(ownership())
    .filter(([, v]) => typeof v === "object" && v !== null)
    .filter(([, v]) => !KNOWN.has(String(v.decidedBy)))
    .map(([k, v]) => `${k}=${v.decidedBy}`);
  assert.deepEqual(bad, [], `unknown decidedBy value; the vocabulary is ${[...KNOWN].join(", ")}`);
});

test("the counts the prose DOES state are true", () => {
  const entries = objects();
  const byOwner = (owner: string) => entries.filter((v) => v.decidedBy === owner).length;
  assert.ok(byOwner("rules") > 0, "the rules must own something, or nothing can be asserted at all");
  // Not pinned to an exact number: the point is that `unavailable` EXISTS and is visible, because
  // "nobody decides this" is the claim the old prose obscured by calling it head-owned.
  assert.ok(byOwner("unavailable") > 0,
    "at least one subtype is decided by nobody, and saying so is the honesty this file is for");
  assert.equal(entries.length, byOwner("rules") + byOwner("overlap") + byOwner("unavailable"),
    "every subtype is accounted for by exactly one owner");
});
