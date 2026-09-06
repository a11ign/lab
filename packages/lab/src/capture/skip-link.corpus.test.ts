/**
 * The SIGNAL and the RULE must agree about what an inert skip link looks like, on every capture on disk.
 *
 * `skipLinkIsInert` (`case-matrix.mjs`, plain node) and `addInertSkipLink` (`rules.ts`, compiled) are the
 * same decision in two places that cannot import each other. CLAUDE.md's remedies for a fact stated twice
 * are: delete a copy, derive one from the other, pin them equal with a test. The first two are unavailable
 * across that boundary, so this is the third — the shape `keyboard-trap.corpus.test.ts` already takes.
 *
 * ## What it pins, and the blind spot that made it worth writing
 *
 * "The skip link did nothing" is stated against the ORDINARY tab order, and it takes TWO positions:
 *
 *   works    activating it →  "Search the archive, edit"        past the block, in the content
 *   inert    activating it →  "News and updates, link"          index 1 — where Tab went anyway
 *   hidden   activating it →  "Skip to main content, link"      index 0 — the link ITSELF
 *
 * Only index 1 was covered until 2026-08-28. Index 0 is strictly worse — the link put you back before you
 * started — and `skip-link-target-hidden` produces it: its target keeps `tabindex="-1"`, so somebody knew
 * the pattern, and is `hidden`, so it is in neither the rendering nor the accessibility tree.
 *
 * ## A third mechanism was REFUTED, and that is recorded rather than repeated
 *
 * `skip-link-target-not-focusable` pointed at an id that exists with no `tabindex`, on the belief that the
 * browser scrolls without moving focus. Captured: `nextFocusAfter` was byte-identical to the conformant
 * variant, because Chromium moves the sequential-focus starting point anyway. The page is conformant and
 * the case was deleted. A canary that expresses a fault that is not there teaches the model that a
 * conformant page is a failing one.
 *
 * Needs `runs/`, so it SKIPS HONESTLY where the corpus is absent rather than passing quietly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ruleFindings } from "@a11y-witness/judge/rules";
// The plain-node corpus module. `case-matrix.mjs` carries `// @ts-check`, so its exports are typed.
import { signalMatches } from "../training/case-matrix.mjs";
import { datasetRoot, captureRoot } from "../dataset-paths.mjs";
import { labCorpusReadable, skipLine } from "../training/corpus-settled.mjs";

const ROOT = captureRoot(datasetRoot());
const SIGNAL = { type: "skip-link-inert" };

/** Every capture carrying a route probe — the only ones either side has an opinion about. */
function capturesWithRoute(): { name: string; capture: Record<string, unknown> }[] {
  if (!existsSync(ROOT)) return [];
  const out: { name: string; capture: Record<string, unknown> }[] = [];
  for (const name of readdirSync(ROOT)) {
    if (!name.endsWith(".json")) continue;
    let capture: Record<string, unknown>;
    try {
      capture = JSON.parse(readFileSync(resolve(ROOT, name), "utf8"));
    } catch {
      continue; // an unparseable capture is `verify.corpus.test.ts`'s business, not this one
    }
    if ((capture.interaction as { routeChange?: unknown } | undefined)?.routeChange) {
      out.push({ name, capture });
    }
  }
  return out;
}

const CAPTURES = capturesWithRoute();
// ASK WHETHER THE CORPUS IS MOVING, not only whether it is there. A green result from a corpus a
// capture is rewriting is as untrustworthy as a red one, and it is the green one that gets believed.
// `labCorpusReadable` also counts CAPTURES rather than trusting the directory to exist -- the suite
// writes one report into runs/, and existsSync calls that a corpus.
const GUARD = labCorpusReadable({ present: CAPTURES.length > 0 });
const SKIP = !GUARD.read && skipLine(GUARD);

test("the signal and the rule agree about every route capture on disk", { skip: SKIP }, () => {
  const disagreements: string[] = [];
  for (const { name, capture } of CAPTURES) {
    const signal = signalMatches(capture, SIGNAL);
    const rule = ruleFindings(capture as never).some((f) => f.wcag.startsWith("2.4.1"));
    if (signal !== rule) disagreements.push(`${name}: signal=${signal} rule=${rule}`);
  }
  assert.deepEqual(disagreements, [],
    "the corpus predicate and the shipped rule disagree about an inert skip link. They are one decision "
      + "written twice, and a corpus labelled by one while users are told by the other is the defect this "
      + "pins");
});

test("BOTH landing positions fire, and no conformant page does", { skip: SKIP }, () => {
  // The control this test is worthless without: two predicates that always answer `false` agree
  // perfectly. The corpus holds both shapes — index 1 (`skip-link-broken`) and index 0
  // (`skip-link-target-hidden`) — so requiring both is requiring the pin to have something to pin.
  const fired = CAPTURES
    .filter(({ capture }) => signalMatches(capture, SIGNAL))
    .map((c) => c.name);

  assert.ok(fired.some((n) => n.startsWith("skip-link-broken.bad")),
    "the index-1 shape must fire, or closing the blind spot broke what already worked");
  assert.ok(fired.some((n) => n.startsWith("skip-link-target-hidden.bad")),
    "the index-0 shape must fire, or the blind spot this case was added for is still there");
  assert.deepEqual(fired.filter((n) => n.includes(".good.")), [],
    "2.4.1 is conformance-mapped, so a fire on a conformant page is an ACCUSATION, not a hint");
});
