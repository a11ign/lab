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
//   sameControlAnnounced + addSilentStateChanges (judge/rules.ts) <-> stateChangeIsSilent (lab/signal-predicates.mjs), #1496
//
// Neither judge-side function is exported -- both are called only through `ruleFindings`, so this drives
// the SHIPPED entry point rather than reaching into module internals; same for `signalMatches` on the lab
// side. Same import shape as `media-signal-parity.test.ts`: `../../../judge/src/rules.js` by RELATIVE
// PATH, resolving to TypeScript SOURCE, never `@a11ign/judge/rules` (which resolves to `dist` and
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

// --- Pair 3 (#1496): sameControlAnnounced + addSilentStateChanges / stateChangeIsSilent -- 4.1.2 state-change-silent ---
//
// The lab release gate at `3bf5b8a4` REFUSED at stage 8 because the lab copy lacked the rule's identity step (#812).
// On the GOOD page of all five `disclosure-focus-moves-to-collapsed-sibling` cases, focus moved to a different
// collapsed control: the rule added nothing, and the signal fired, which is CONTAMINATED. Both sides now ask identity
// before state. This pins that they AGREE on every shape in STATE_CASES, and NAMES the two shapes where they still
// differ, each with its reason, so neither side can change alone without this file saying so. The single shared
// copy is #1498.

type StateChange = { control: string; after: string; afterSource: string };

const focusRead = (control: string, after: string): StateChange => ({ control, after, afterSource: "focus" });

function ruleStateChangeSilent(change: StateChange): boolean {
  const findings = ruleFindings(captureWithInteraction({ stateChanges: [change] }) as never);
  return findings.some((f) => f.wcag?.startsWith("4.1.2"));
}

function signalStateChangeSilent(change: StateChange, control: string): boolean {
  return signalMatches(captureWithInteraction({ stateChanges: [change] }), { type: "state-change-silent", control });
}

const STATE_CASES: { name: string; change: StateChange; control: string }[] = [
  { name: "the release gate's GOOD page (recorded, #915): focus moved to a DIFFERENT collapsed control",
    change: focusRead("Show delivery options, button, collapsed", "Show opening hours, button, focused, collapsed"),
    control: "Show delivery options" },
  { name: "the SAME control, still collapsed after activation -- the failure",
    change: focusRead("Show delivery options, button, collapsed", "Show delivery options, button, focused, collapsed"),
    control: "Show delivery options" },
  { name: "+also-fake-heading-unnamed-graphic's second good-page entry (recorded, #915): collapsed -> expanded",
    change: focusRead("Reference notes archive, button, collapsed", "Reference notes archive, button, focused, expanded"),
    control: "Reference notes archive" },
  { name: "the same control, expanded -> expanded",
    change: focusRead("Show delivery options, button, expanded", "Show delivery options, button, focused, expanded"),
    control: "Show delivery options" },
  { name: "unnamed on both sides -- an empty name is not an identity",
    change: focusRead("button, collapsed", "button, focused, collapsed"), control: "button" },
  { name: "named before, unnamed after -- identity cannot be established",
    change: focusRead("Show delivery options, button, collapsed", "button, focused, collapsed"),
    control: "Show delivery options" },
  { name: "the same NAME under a different role ('button' -> 'menu button') -- identity is the name, not the role",
    change: focusRead("Platform, button, collapsed", "Platform, menu button, focused, collapsed"), control: "Platform" },
];

test("#1496: stateChangeIsSilent (signal) and addSilentStateChanges (rule) agree on every identity shape", () => {
  for (const { name, change, control } of STATE_CASES) {
    const rule = ruleStateChangeSilent(change);
    const signal = signalStateChangeSilent(change, control);
    assert.equal(signal, rule,
      `${name}: signal says ${signal}, rule says ${rule} -- a corpus case built from this predicate can be `
      + "labelled a failure the shipped judge will never report, or vice versa");
  }
});

const NAMED_DIVERGENCES: { name: string; change: StateChange; control: string; rule: boolean; signal: boolean;
  reason: string }[] = [
  { name: "a combo box that stays collapsed after Enter",
    change: focusRead("Passenger type, combo box, collapsed", "Passenger type, combo box, focused, collapsed"),
    control: "Passenger type", rule: false, signal: true,
    reason: "the rule's ENTER_ACTIVATES role gate -- Enter is not the key that opens a combo box, so staying collapsed "
      + "is correct behaviour. The lab copy has no role gate. Not #1496's step; aligning it is #1498's single copy." },
  { name: "the same control with NO state word after activation",
    change: focusRead("Show delivery options, button, collapsed", "Show delivery options, button, focused"),
    control: "Show delivery options", rule: false, signal: true,
    reason: "the lab copy counts an `after` with no state word as a failure ('nothing was conveyed either way', its "
      + "own comment); the rule requires an expandable state on BOTH sides before comparing. Not #1496's step; #1498." },
];

test("#1496: the two shapes where signal and rule still differ are NAMED, with reasons -- changing either side must update this",
  () => {
    for (const { name, change, control, rule, signal, reason } of NAMED_DIVERGENCES) {
      assert.equal(ruleStateChangeSilent(change), rule, `${name}: the RULE's answer moved. Known reason: ${reason}`);
      assert.equal(signalStateChangeSilent(change, control), signal,
        `${name}: the SIGNAL's answer moved. Known reason: ${reason}`);
    }
  });
