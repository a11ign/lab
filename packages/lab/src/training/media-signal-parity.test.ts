// TWO COPIES OF ONE PREDICATE, AND NOTHING PINNED THEM EQUAL.
//
// `autoplayUncontrollable` (signal-predicates.mjs, the dataset signal) and `addAutoplayingAudio`
// (rules.ts, the shipped rule) both read `capture.media` and ask the same question: does an element
// autoplay with neither `muted` nor `controls`. Duplicated deliberately, on the same basis
// `contextChanged`/`contextChangedOn` and `focusRevealUndismissable`/`focusPanelUndismissable` already
// are — `packages/lab`'s corpus generator runs under plain node, and depending on a build to reach
// `packages/judge` is how a stale `dist` scored the wrong rules earlier the same day (see
// `name-normalisation.test.ts`, which is the pattern this file copies).
//
// **Neither of those two cited precedents is pinned by a test.** Checked before writing this one:
// `grep -rln "contextChanged" --include="*.test.ts" packages/` finds no test comparing
// `contextChanged` (rules.ts) against `contextChangedOn` (signal-predicates.mjs), and the same is true
// of `focusRevealUndismissable`/`focusPanelUndismissable`. So the precedent this predicate was justified
// against is itself unguarded — recorded as its own backlog row rather than fixed silently here, since
// fixing it would be a second, larger unit than #9.
//
// This file is the third tier for the ONE duplication #9 introduced: delete a copy (not possible, the
// package boundary is real), derive one from the other (not possible, `packages/lab` cannot depend on a
// TypeScript build), so pin them equal with a test — imported from the TypeScript SOURCE by relative
// path, never `@a11y-witness/judge/rules`, which resolves to `dist` and would defeat the point of a test
// that exists to catch drift between two files.
import { test } from "node:test";
import assert from "node:assert/strict";

import { signalMatches } from "./signal-predicates.mjs";
import { ruleFindings } from "../../../judge/src/rules.js";

type MediaElement = { tag: string; autoplay: boolean; muted: boolean; controls: boolean; loop: boolean };

/** The minimal capture shape `ruleFindings` needs to not throw on an unrelated rule's unconditional read. */
function captureWithMedia(media: MediaElement[]): Record<string, unknown> {
  return { transcript: [], structure: {}, interaction: {}, media };
}

function ruleFired(media: MediaElement[]): boolean {
  return ruleFindings(captureWithMedia(media) as never).some((f) => f.wcag?.startsWith("1.4.2"));
}

function signalFired(media: MediaElement[]): boolean {
  return signalMatches(captureWithMedia(media), { type: "autoplay-uncontrollable" });
}

const AUDIO = (overrides: Partial<MediaElement>): MediaElement =>
  ({ tag: "audio", autoplay: true, muted: false, controls: false, loop: false, ...overrides });

const CASES: { name: string; media: MediaElement[] }[] = [
  { name: "autoplay, unmuted, no controls -- the failing case", media: [AUDIO({})] },
  { name: "autoplay, unmuted, WITH controls -- the criterion's own remedy", media: [AUDIO({ controls: true })] },
  { name: "autoplay but muted -- nothing to control", media: [AUDIO({ muted: true })] },
  { name: "not autoplay at all", media: [AUDIO({ autoplay: false })] },
  { name: "no media elements on the page", media: [] },
  { name: "one clean element and one failing element, mixed", media: [AUDIO({ controls: true }), AUDIO({})] },
];

test("the dataset signal and the shipped rule agree about every media/autoplay shape", () => {
  for (const { name, media } of CASES) {
    const rule = ruleFired(media);
    const signal = signalFired(media);
    assert.equal(signal, rule,
      `${name}: signal says ${signal}, rule says ${rule} -- a case built from this predicate can be `
      + "labelled a failure the shipped judge will never report, or vice versa");
  }
});
