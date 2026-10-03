/**
 * `@a11ign/judge`'s OPTIONAL `@anthropic-ai/sdk` PEER MUST COVER THE SDK THIS REPOSITORY TESTS — #3265.
 *
 * The peer range is what a consumer's package manager resolves, so it is the claim "the judge works with these
 * versions". The root `package.json` is the version this repository actually runs the judge against. On a `0.x`
 * version a caret is one minor wide, so `^0.106.0` excludes `0.129.0`: the moment Dependabot moved the root
 * (#3261) the repo would test a version the judge tells consumers NOT to install, and Dependabot cannot move the
 * peer because `@a11ign/judge` is a workspace member. **The defect is the missing tie, not one number**, so the
 * next SDK bump fails here until somebody has checked it against `askAnthropic` and widened the peer.
 *
 * ## WHAT THE PEER'S RANGE WAS SHOWN AGAINST
 *
 * `askAnthropic` (`packages/judge/src/judge.ts`) uses `messages.stream`, `finalMessage()`, `thinking: { type:
 * "adaptive" }` and `content` blocks whose `type` is `"text"`. That snippet was compiled with `tsc --strict`
 * against the published type declarations of EVERY SDK release from 0.106.0 to 0.129.0 (30 versions, none skipped)
 * and compiled in each; a mutated copy (`"adaptive"` -> `"bogus"`) failed to compile, so the compile was not
 * vacuous. That is why the peer is `>=0.106.0 <0.130.0` and not `^0.106.0 || ^0.129.0`: nothing in it is a
 * version nobody checked. 0.106.0 stays the floor because nothing older was measured. A TYPE check, not a call to
 * the API: runtime behaviour at each version was not exercised.
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
import { satisfies } from "../../../guards/src/isolation-gate.mjs";

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
  assert.equal(problems(">=0.106.0 <0.130.0", "^0.130.0").length, 1, "the next bump reopens it until the peer is re-checked");
  assert.equal(problems(">=0.106.0 <0.130.0", "^0.105.0").length, 1, "below the floor");
});

test("a root version inside the peer passes, so the guard is not merely always-failing", () => {
  assert.deepEqual(problems(">=0.106.0 <0.130.0", "^0.129.0"), []);
  assert.deepEqual(problems(">=0.106.0 <0.130.0", "^0.106.0"), []);
  assert.deepEqual(problems("^0.106.0", "^0.106.0"), []);
});

test("an UNREADABLE range or specifier is a failure, never a pass", () => {
  assert.match(problems("^0.106.0 || ^0.129.0", "^0.129.0")[0], /not a range this guard can read/);
  assert.match(problems(">=0.106.0 <0.130.0", "workspace:*")[0], /no tested version can be read/);
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
});
