// THE PRECEDENT EVERYBODY CITES WAS ITSELF UNPINNED.
//
// `media-signal-parity.test.ts` pinned `autoplayUncontrollable`/`addAutoplayingAudio` equal, on the
// deliberate-duplication basis stated there: `packages/lab`'s corpus generator runs under plain node, and
// depending on a `packages/judge` build to reach it is how a stale `dist` scored the wrong rules once
// already (`name-normalisation.test.ts`'s own incident). That basis was justified by citing TWO older
// duplications across the same boundary -- and neither was pinned. This file is the third tier
// (CLAUDE.md's remedy order: delete a copy, else derive one, else pin them equal with a test) for both:
//
//   contextChanged (judge/rules.ts)          <-> contextChangedOn (lab/signal-predicates.mjs)
//   focusRevealUndismissable (judge/rules.ts) <-> focusPanelUndismissable (lab/signal-predicates.mjs)
//
// Neither judge-side function is exported -- both are called only through `ruleFindings`, so this drives
// the SHIPPED entry point rather than reaching into module internals; same for `signalMatches` on the lab
// side. Same import shape as `media-signal-parity.test.ts`: `../../../judge/src/rules.js` by RELATIVE
// PATH, resolving to TypeScript SOURCE, never `@a11y-witness/judge/rules` (which resolves to `dist` and
// would defeat the point of a test that exists to catch drift between two files).
//
// DO NOT CHANGE EITHER IMPLEMENTATION HERE. This pins them equal; it does not unify them -- the package
// boundary is deliberate and ADR-backed (see this file's own citation above).
import { test } from "node:test";
import assert from "node:assert/strict";

import { signalMatches } from "./signal-predicates.mjs";
import { ruleFindings } from "../../../judge/src/rules.js";

/** The minimal capture shape `ruleFindings` needs to not throw on an unrelated rule's unconditional read. */
function captureWithInteraction(interaction: Record<string, unknown>): Record<string, unknown> {
  return { transcript: [], structure: {}, interaction, media: [] };
}

// --- Pair 1: contextChanged / contextChangedOn -- drives 3.2.1 On Focus / 3.2.2 On Input ---
//
// Both criteria call the SAME predicate on two different channels (`focusContext`, `typedFeedback`); the
// predicate does not know or care which. So parity is proven once, through one channel position
// (`focusContext` / 3.2.1) -- testing the other position would re-test the call site, not the predicate.

type Channel = { titleBefore?: string | null; titleAfter?: string | null; error?: string } | undefined;

function ruleContextChanged(channel: Channel): boolean {
  const findings = ruleFindings(captureWithInteraction({ focusContext: channel }) as never);
  return findings.some((f) => f.wcag?.startsWith("3.2.1"));
}

function signalContextChanged(channel: Channel): boolean {
  return signalMatches(captureWithInteraction({ focusContext: channel }), { type: "focus-context-change" });
}

const CONTEXT_CASES: { name: string; channel: Channel }[] = [
  { name: "titles differ -- a real context change", channel: { titleBefore: "Search", titleAfter: "No results" } },
  { name: "titles are identical -- no change", channel: { titleBefore: "Search", titleAfter: "Search" } },
  { name: "channel absent entirely -- the probe was never asked", channel: undefined },
  { name: "channel carries an error -- not a stable measurement", channel: { titleBefore: "A", titleAfter: "B", error: "timeout" } },
  { name: "titleBefore is the null sentinel -- nothing was focused/typed", channel: { titleBefore: null, titleAfter: "B" } },
  { name: "titleAfter is the null sentinel", channel: { titleBefore: "A", titleAfter: null } },
  { name: "both empty strings -- a real non-change, not an absence", channel: { titleBefore: "", titleAfter: "" } },
  { name: "empty to non-empty -- still a real change", channel: { titleBefore: "", titleAfter: "B" } },
];

test("contextChanged (rule) and contextChangedOn (signal) agree on every title-diff shape", () => {
  for (const { name, channel } of CONTEXT_CASES) {
    const rule = ruleContextChanged(channel);
    const signal = signalContextChanged(channel);
    assert.equal(signal, rule,
      `${name}: signal says ${signal}, rule says ${rule} -- a corpus case built from this predicate can be `
      + "labelled a failure the shipped judge will never report, or vice versa");
  }
});

// --- Pair 2: focusRevealUndismissable / focusPanelUndismissable -- drives 1.4.13 Content on Hover or Focus ---

type Reveal = { revealed?: boolean | null; focusHeld?: boolean; dismissed?: boolean | null } | undefined;

function ruleFocusUndismissable(reveal: Reveal): boolean {
  const findings = ruleFindings(captureWithInteraction({ focusReveal: reveal }) as never);
  return findings.some((f) => f.wcag?.startsWith("1.4.13"));
}

function signalFocusUndismissable(reveal: Reveal): boolean {
  return signalMatches(captureWithInteraction({ focusReveal: reveal }), { type: "focus-panel-undismissable" });
}

const REVEAL_CASES: { name: string; reveal: Reveal }[] = [
  { name: "revealed, focus held, not dismissed -- the failing case", reveal: { revealed: true, focusHeld: true, dismissed: false } },
  { name: "revealed and dismissed -- the remedy demonstrated", reveal: { revealed: true, focusHeld: true, dismissed: true } },
  { name: "revealed but focus moved away -- mechanism not demonstrated by this evidence", reveal: { revealed: true, focusHeld: false, dismissed: false } },
  { name: "content never revealed at all", reveal: { revealed: false, focusHeld: true, dismissed: false } },
  { name: "revealed is the null sentinel -- census could not answer", reveal: { revealed: null, focusHeld: true, dismissed: false } },
  { name: "dismissed is the null sentinel -- census could not answer", reveal: { revealed: true, focusHeld: true, dismissed: null } },
  { name: "focusReveal absent entirely -- the probe never ran", reveal: undefined },
];

test("focusRevealUndismissable (rule) and focusPanelUndismissable (signal) agree on every census shape", () => {
  for (const { name, reveal } of REVEAL_CASES) {
    const rule = ruleFocusUndismissable(reveal);
    const signal = signalFocusUndismissable(reveal);
    assert.equal(signal, rule,
      `${name}: signal says ${signal}, rule says ${rule} -- a corpus case built from this predicate can be `
      + "labelled a failure the shipped judge will never report, or vice versa");
  }
});
