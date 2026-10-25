/**
 * `@a11ign/judge`'s OPTIONAL `@anthropic-ai/sdk` PEER MUST COVER THE SDK THIS REPOSITORY TESTS, AND MUST NOT CAP IT BY HAND — #3265, A11-252.
 *
 * The peer range is what a consumer's package manager resolves, so it is the claim "the judge works with these
 * versions". The root `package.json` is the version this repository actually runs the judge against. On a `0.x`
 * version a caret is one minor wide, so `^0.106.0` excludes `0.129.0`: the moment Dependabot moved the root
 * (#3261) the repo would test a version the judge tells consumers NOT to install, and Dependabot cannot move the
 * peer because `@a11ign/judge` is a workspace member. **The defect is the missing tie, not one number.**
 *
 * TWO CHECKS, AND NEITHER NAMES A VERSION THAT AN ORDINARY UPDATE MOVES:
 *
 *   - the peer COVERS the SDK the root tests (`problems`). A bump that stays inside the range passes.
 *   - the peer has NO HAND-WRITTEN UPPER BOUND below the next semver major (`ceilingProblems`). The ceiling was the
 *     snapshot: a number somebody wrote after checking one release and that every later SDK minor failed against
 *     ("fails here until somebody has widened the peer", a11ign#5709). Compatibility is now shown by a11ign's own suite running on
 *     the bumped SDK: a break turns its `gate` red, and A11-255 makes that a ticket.
 *
 * A ceiling the a11ign tree at THIS `CORE_REF` still carries is tolerated by name in `LEGACY_CEILINGS`, only while `ci.yml` names that commit, so this
 * file passes against that tree as it is and against the widened `>=0.106.0` alike. When `CORE_REF` moves the tolerance ends with it: a new ceiling
 * fails, and so does the old one.
 *
 * ## WHAT THE PEER'S RANGE WAS SHOWN AGAINST
 *
 * `askAnthropic` (`packages/judge/src/judge.ts`) uses `messages.stream`, `finalMessage()`, `thinking: { type:
 * "adaptive" }` and `content` blocks whose `type` is `"text"`. That snippet was compiled with `tsc --strict`
 * against the published type declarations of EVERY SDK release from 0.106.0 to 0.129.0 (30 versions, none skipped)
 * and compiled in each; a mutated copy (`"adaptive"` -> `"bogus"`) failed to compile, so the compile was not
 * vacuous. That is why the peer was `>=0.106.0 <0.132.0` and not `^0.106.0 || ^0.129.0`. 0.106.0 stays the floor because
 * nothing older was measured; the upper bound is gone (see above), because a measured ceiling is a snapshot of one day. A TYPE check, not a call to
 * the API: runtime behaviour at each version was not exercised.
 *
 * #3473 (2026-10-04) extended the measurement to 0.130.0 and 0.131.0 with the same snippet and `tsc --strict`: the
 * 0.129.0 control still compiled and the `"bogus"` mutant failed in all three, so the bound moved from `<0.130.0`
 * to `<0.132.0`.
 *
 * ## READING THE RANGE
 *
 * `satisfies` (`isolation-gate.mjs`) reads one `^`/`~`/`>=` operator and returns `null` for a compound range, and
 * `null` here is a FAILURE (an unreadable range cannot be checked, so it cannot be certified). The compound
 * `>=a <b` is read below by asking `satisfies` the two halves it can answer, so there is still one reader of a
 * version bound. `||` is not read: a peer written with it fails, and the failure says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { satisfies } from "../../../guards/src/isolation-gate.ts";

const SDK = "@anthropic-ai/sdk";
const readJson = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));

/** The version a root specifier tests: its own floor (`^0.129.0` -> `0.129.0`), or `null` when it is not `[^~]x.y.z`. */
function testedVersion(specifier: string): string | null {
  const bare = specifier.replace(/^[\^~]/, "");
  return /^\d+\.\d+\.\d+$/.test(bare) ? bare : null;
}

/** Does `version` satisfy every comparator of `range`? `null` when any comparator is one this cannot read. */
function inRange(version: string, range: string): boolean | null {
  const verdicts = range.trim().split(/\s+/).map((comparator) =>
    comparator.startsWith("<") && !comparator.startsWith("<=")
      ? invert(satisfies(version, `>=${comparator.slice(1)}`))
      : satisfies(version, comparator));
  if (verdicts.includes(null)) return null;
  return verdicts.every(Boolean);
}

const invert = (verdict: boolean | null) => (verdict === null ? null : !verdict);

/**
 * The ceiling the a11ign tree at THIS `CORE_REF` still carries in the judge's peer. It is tolerated only while `ci.yml` names that commit: when `CORE_REF`
 * moves, the tolerance ends with it, and a peer that still has a ceiling fails, so the widened peer (`>=0.106.0`, a11ign's A11-252 change) has to be in the
 * a11ign being laid first. Do not add a ceiling here: a new one is what `ceilingProblems` exists to refuse.
 */
const LEGACY_CEILINGS: readonly string[] = ["<0.132.0"];
const LEGACY_CEILINGS_CORE_REF = "87d89fdec2c26b9fb3d2e8dd99160ec8c52f9dc1";

/** The ceilings tolerated when the core is laid at `coreRef`. */
const toleratedCeilings = (coreRef: string | undefined): readonly string[] => (coreRef === LEGACY_CEILINGS_CORE_REF ? LEGACY_CEILINGS : []);

const majorOf = (version: string) => Number(version.split(".")[0]);

/** The lowest version a peer admits: its `>=` comparator, else its `^`/`~` one. */
const floorOf = (peer: string): string => peer.match(/>=\s*(\d+\.\d+\.\d+)/)?.[1] ?? peer.match(/[\^~](\d+\.\d+\.\d+)/)?.[1] ?? "0.0.0";

/**
 * Does the comparator stop at the next semver major or later? `<N.0.0` with N above the floor's major does, and so does `^N.x.y` with N >= 1 (a caret on `0.x` is
 * one minor wide). `<x.y.z`, `<=x.y.z`, `~x.y.z` and an exact `x.y.z` stop sooner.
 */
function reachesNextMajor(operator: string, version: string, floor: string): boolean {
  if (operator === "<") return /^\d+\.0\.0$/.test(version) && majorOf(version) > majorOf(floor);
  return operator === "^" && majorOf(version) >= 1;
}

/** What is wrong with a peer range that caps the SDK below the next semver major, or `[]`. `tolerated` comparators are skipped. */
function ceilingProblems(peer: string, tolerated: readonly string[] = []): string[] {
  const floor = floorOf(peer);
  return peer.trim().split(/\s+/).filter((comparator) => !tolerated.includes(comparator)).flatMap((comparator) => {
    const bound = comparator.match(/^(<=?|[\^~=]?)(\d+\.\d+\.\d+)$/);
    if (!bound || reachesNextMajor(bound[1], bound[2], floor)) return [];
    return [`the peer "${peer}" caps ${SDK} by hand at "${comparator}", below the next semver major. A cap is a snapshot that every later release fails against; `
      + "compatibility is shown by a11ign's suite running on the bumped SDK, so the peer is a floor (`>=x.y.z`)"];
  });
}

/** What is wrong with a (peer range, root specifier) pair, or `[]` when the peer covers the tested version. */
function problems(peer: string | undefined, rootSpecifier: string | undefined): string[] {
  if (peer === undefined) return [`judge declares no ${SDK} peer`];
  if (rootSpecifier === undefined) return [`the root declares no ${SDK}, so there is no tested version to compare`];
  const tested = testedVersion(rootSpecifier);
  if (tested === null) return [`the root's ${SDK} specifier "${rootSpecifier}" is not [^~]x.y.z, so no tested version can be read`];
  const covered = inRange(tested, peer);
  if (covered === null) return [`the peer "${peer}" is not a range this guard can read (comparators ^ ~ >= < joined by spaces; || is not read)`];
  return covered ? [] : [`the root tests ${SDK}@${tested}, which the peer "${peer}" excludes`];
}

test("POSITIVE CONTROL: a root version outside the peer fails, so a green run below is not vacuous", () => {
  assert.equal(problems("^0.106.0", "^0.129.0").length, 1, "the pair #3261 would have produced");
  assert.equal(problems(">=0.106.0 <0.132.0", "^0.132.0").length, 1, "a capped peer excludes the next bump");
  assert.equal(problems(">=0.106.0 <0.132.0", "^0.105.0").length, 1, "below the floor");
});

test("a root version inside the peer passes, so the guard is not merely always-failing", () => {
  assert.deepEqual(problems(">=0.106.0 <0.132.0", "^0.129.0"), []);
  assert.deepEqual(problems(">=0.106.0 <0.132.0", "^0.131.0"), [], "the version #3473 moved the root to");
  assert.deepEqual(problems(">=0.106.0 <0.132.0", "^0.106.0"), []);
  assert.deepEqual(problems("^0.106.0", "^0.106.0"), []);
});

test("an SDK bump past the old ceiling passes against a peer that is a floor", () => {
  assert.deepEqual(problems(">=0.106.0", "^0.140.0"), [], "0.140.0 is past the ceiling the peer used to carry");
  assert.deepEqual(problems(">=0.106.0", "^0.106.0"), []);
  assert.equal(problems(">=0.106.0", "^0.105.0").length, 1, "an SDK below the floor fails");
});

test("a peer that caps the SDK below the next major fails, saying why, and a floor or a next-major cap passes", () => {
  assert.match(ceilingProblems(">=0.106.0 <0.132.0")[0], /caps @anthropic-ai\/sdk by hand at "<0\.132\.0".*snapshot/);
  assert.equal(ceilingProblems("^0.106.0").length, 1, "a caret on 0.x is one minor wide");
  assert.equal(ceilingProblems("~0.106.0").length, 1);
  assert.equal(ceilingProblems(">=0.106.0 <=0.140.0").length, 1);
  assert.deepEqual(ceilingProblems(">=0.106.0"), []);
  assert.deepEqual(ceilingProblems(">=0.106.0 <1.0.0"), [], "the next semver major of a 0.x floor");
  assert.deepEqual(ceilingProblems("^1.2.0"), [], "a caret on 1.x stops at the next major");
  assert.deepEqual(ceilingProblems(">=0.106.0 <0.132.0", toleratedCeilings(LEGACY_CEILINGS_CORE_REF)), [], "the one ceiling CORE_REF's a11ign still carries is tolerated");
  assert.equal(ceilingProblems(">=0.106.0 <0.132.0", toleratedCeilings("1111111111111111111111111111111111111111")).length, 1, "and not once CORE_REF is any other commit");
  assert.equal(ceilingProblems("0.133.0").length, 1, "an exact version is the tightest cap");
  assert.equal(ceilingProblems(">=0.106.0 0.133.0").length, 1);
  assert.equal(ceilingProblems(">=0.106.0 <0.140.0", toleratedCeilings(LEGACY_CEILINGS_CORE_REF)).length, 1, "and only that one: a new ceiling is refused");
});

test("an UNREADABLE range or specifier is a failure, never a pass", () => {
  assert.match(problems("^0.106.0 || ^0.129.0", "^0.129.0")[0], /not a range this guard can read/);
  assert.match(problems(">=0.106.0 <0.132.0", "workspace:*")[0], /no tested version can be read/);
  assert.match(problems(undefined, "^0.129.0")[0], /no .* peer/);
  assert.match(problems(">=0.106.0", undefined)[0], /no tested version/);
});

test("@a11ign/judge's published peer range covers the SDK version the root tests", () => {
  const judge = readJson("../../../judge/package.json");
  const root = readJson("../../../../package.json");
  const peer = judge.peerDependencies?.[SDK];
  const specifier = root.dependencies?.[SDK] ?? root.devDependencies?.[SDK];
  assert.equal(typeof peer, "string", "positive control for the next assertion: the peer exists to be read");
  assert.equal(typeof specifier, "string", "positive control for the next assertion: the root specifier exists to be read");
  assert.deepEqual(problems(peer, specifier), []);
  const coreRef = /^ {2}CORE_REF: (\S+)$/m.exec(readFileSync(fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url)), "utf8"))?.[1];
  assert.match(coreRef ?? "", /^[0-9a-f]{40}$/, "positive control for the next assertion: ci.yml names the commit the core is laid at");
  assert.deepEqual(ceilingProblems(peer, toleratedCeilings(coreRef)), [],
    "the judge's peer caps the SDK by hand. If CORE_REF just moved, the ceiling the previous commit carried is no longer tolerated: lay an a11ign whose peer is `>=0.106.0`.");
});
