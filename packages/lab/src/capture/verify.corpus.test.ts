// Every verification predicate, against every capture in the corpus.
//
// This is the test that would have caught the worst mistake of this project's week. A guard was added
// that rejects a capture when a requested probe produced nothing, validated on six hand-picked cases,
// and shipped. It then failed 44 cases in a live run and added hours to it, because for the
// `custom-control` family an empty probe IS the finding: those bad pages are div-based fake buttons,
// so NVDA finds no controls, and that absence is the 4.1.2 failure being demonstrated.
//
// The corpus is the ground truth available for free. `npm run training:check-signals` scores it 1061
// discriminating / 0 blind / 0 contaminated, which means every pair in it distinguishes its good page
// from its bad one. So a predicate that rejects any capture in it is rejecting evidence known to be
// good — a false positive, by construction, with no judgement required.
//
// Six cases is an anecdote. 2,122 is a test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CapturedAnnouncements } from "@a11y-witness/evidence/verify";
import { captureHasSubstance, captureIsSelfConsistent, captureMentionsTitle, titleOf } from "@a11y-witness/evidence/verify";
import { datasetRoot, captureRoot } from "../dataset-paths.mjs";
import { labCorpusReadable, skipLine } from "../training/corpus-settled.mjs";
import { captureFilePath } from "./evidence-diff.mjs";

const ROOT = datasetRoot();
const MANIFEST = resolve(ROOT, "manifest.json");
const CAPTURES = captureRoot(ROOT);
const PAGES = resolve(ROOT, "pages");

/** Only the predicates that GATE a capture. A diagnostic that rejects nothing cannot cost evidence. */
const GATES: { name: string; rejects: (capture: CapturedAnnouncements, title: string) => boolean }[] = [
  { name: "captureMentionsTitle", rejects: (c, title) => !captureMentionsTitle(c, title) },
  { name: "captureHasSubstance", rejects: (c, title) => !captureHasSubstance(c, title) },
  { name: "captureIsSelfConsistent", rejects: (c) => !captureIsSelfConsistent(c) },
];

interface Sample { id: string; variant: string; capture: CapturedAnnouncements; title: string }

/**
 * Every capture on disk, paired with the title of the page it was taken from.
 *
 * Returns empty when the corpus is absent — `runs/` is gitignored, so CI cannot run this and must not
 * fail because of it. The same honest limitation `npm run eval` has: a local gate, not a CI one.
 */
function corpus(): Sample[] {
  if (!existsSync(MANIFEST)) return [];
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { cases: { id: string }[] };
  const samples: Sample[] = [];
  for (const { id } of manifest.cases) {
    for (const variant of ["good", "bad"]) {
      const capturePath = captureFilePath(CAPTURES, id, variant);
      const pagePath = resolve(PAGES, id, `${variant}.html`);
      if (!existsSync(capturePath) || !existsSync(pagePath)) continue;
      const capture = JSON.parse(readFileSync(capturePath, "utf8")) as CapturedAnnouncements;
      if (!Array.isArray(capture.transcript)) continue;
      samples.push({ id, variant, capture, title: titleOf(readFileSync(pagePath, "utf8")) });
    }
  }
  return samples;
}

const samples = corpus();

// ONE verdict for every sweep below, so they cannot describe one corpus five different ways. It also
// distinguishes states the `samples.length === 0` checks below cannot: a capture IN FLIGHT (skip and ask
// again shortly) and a runs/ holding only an emitted report, which existsSync calls a corpus.
const CORPUS_GUARD = labCorpusReadable({ present: samples.length > 0 });

test("the corpus is present, settled, and readable — or this test is honestly skipped", () => {
  if (!CORPUS_GUARD.read) {
    console.log(skipLine(CORPUS_GUARD));
  }
  assert.ok(true);
});

/**
 * No probe crashed while producing this corpus.
 *
 * `sweepLog` is where a probe records its own failure, and until this test existed nothing read it.
 * A perf change (`9cabfb4`) added `ctx.trips.count` to `collectByType` and did not add `trips` to the
 * postSubmit call site, so that probe threw before its first sweep on 604 captures. Every one was
 * caught, logged to `sweepLog`, and forgotten -- `postSubmitFields` came back `[]` across all 2,122
 * captures, `validationErrorIsSilent` silently fell back to the evidence its own comment calls
 * useless, and 6 cases stopped discriminating.
 *
 * Nothing else could have caught it. The field was empty rather than wrong, counts never moved, and
 * the eval fixtures that DO show the probe working predate the regression, so no comparison was run
 * against them. This is the same class as the h1 announcement that vanished from 90 captures with
 * every check green: absence of evidence reads exactly like evidence of absence.
 */
test("no capture in the corpus recorded a probe crash", () => {
  if (!CORPUS_GUARD.read) return;
  // sweepLog reaches the capture file only through the `interaction` diagnostic mark -- it is NOT on
  // `capture.interaction`, which is the shape this test first read, and reading it there made the
  // test pass against the very corpus that carries 604 crashes. Assert against where the data is.
  const crashed = samples
    .map((s) => ({
      id: `${s.id}.${s.variant}`,
      errors: ((s.capture as { diagnostics?: { sweepLog?: string[] }[] }).diagnostics ?? [])
        .flatMap((mark) => mark?.sweepLog ?? [])
        .filter((line) => line.includes("ERROR")),
    }))
    .filter((s) => s.errors.length > 0);
  assert.deepEqual(
    crashed.map((c) => c.id),
    [],
    `${crashed.length} of ${samples.length} captures recorded a probe ERROR in sweepLog. A probe ` +
      `that throws yields an EMPTY field, which is indistinguishable from a page that has nothing ` +
      `to announce -- so a signal reading that field degrades silently instead of failing.\n` +
      `First few: ${crashed.slice(0, 3).map((c) => `${c.id}: ${c.errors[0]}`).join("\n            ")}`,
  );
});

/**
 * Announcements the MEASURING TOOL put there, not the page.
 *
 * Both of these were diagnosed, fixed, and left residue in the corpus that nothing checked for afterwards —
 * found by hand, which is why this exists:
 *
 *   - **U+FFFC**, OBJECT REPLACEMENT CHARACTER. Edge's autofill draws a suggestion icon inside recognised
 *     inputs and NVDA announces it as an embedded object: `"Recipient name, edit, ￼"`. Suppressed by
 *     command-line flags now.
 *   - **A one- or two-character control name.** `"O, button"` is not a button called O; it is a quick-nav key
 *     that typed itself into the page because NVDA was left in focus mode. `MIN_CONTROL_NAME_LEN` once
 *     skipped these with a comment calling them a "stray key echo" — the symptom was named and never
 *     diagnosed.
 *
 * Both are worse than noise, because they can land on ONE VARIANT of a pair and correlate with the property
 * under test — an accessible form focuses the field it rejected, so only the conformant half echoes. That
 * hands the trained scorer a shortcut feature, which is the one defect this project cannot tolerate.
 */
const TOOL_ARTEFACTS: { name: string; detect: (capture: CapturedAnnouncements) => string | null }[] = [
  {
    name: "U+FFFC (Edge autofill)",
    detect: (capture) => {
      const found = announcementsOf(capture).find((line) => line.includes("\uFFFC"));
      return found ? JSON.stringify(found) : null;
    },
  },
  {
    name: "one- or two-character control name (focus-mode key echo)",
    detect: (capture) => {
      const controls = [
        ...(capture.structure?.formFields ?? []),
        ...((capture.interaction as { controls?: string[] } | undefined)?.controls ?? []),
      ];
      const found = controls.find((control) => {
        const label = String(control).split(",")[0]?.trim() ?? "";
        return label.length > 0 && label.length <= 2 && /^[A-Za-z]+$/.test(label);
      });
      return found ? JSON.stringify(found) : null;
    },
  },
];

/** Every announcement in a capture, whichever channel carried it. */
function announcementsOf(capture: CapturedAnnouncements): string[] {
  const structure = (capture.structure ?? {}) as Record<string, string[] | undefined>;
  const interaction = (capture.interaction ?? {}) as Record<string, unknown>;
  return [
    ...(capture.transcript ?? []),
    ...Object.values(structure).flatMap((values) => values ?? []),
    ...((interaction.postSubmitFields as string[] | undefined) ?? []),
  ].map(String);
}

for (const artefact of TOOL_ARTEFACTS) {
  test(`no capture carries ${artefact.name}`, () => {
    if (!CORPUS_GUARD.read) return;
    const hits = samples
      .map((s) => ({ id: `${s.id}.${s.variant}`, evidence: artefact.detect(s.capture) }))
      .filter((s) => s.evidence !== null);
    assert.deepEqual(
      hits.map((h) => h.id),
      [],
      `${hits.length} of ${samples.length} captures carry an announcement produced by the MEASURING TOOL ` +
        `rather than by the page. A pair where one variant carries it and the other does not differs for a ` +
        `reason unrelated to accessibility, and the artefact correlates with the property under test — so it ` +
        `is available to the scorer as a shortcut feature.\n` +
        `Recapture these:\n  ${hits.slice(0, 6).map((h) => `${h.id}  ${h.evidence}`).join("\n  ")}`,
    );
  });
}

for (const gate of GATES) {
  test(`${gate.name} rejects no capture in the corpus`, () => {
    if (!CORPUS_GUARD.read) return;
    const rejected = samples.filter((s) => gate.rejects(s.capture, s.title)).map((s) => `${s.id}.${s.variant}`);
    assert.deepEqual(
      rejected,
      [],
      `${gate.name} rejected ${rejected.length} of ${samples.length} captures that check-signals ` +
        `scores as discriminating. Either the gate is wrong, or those captures are. Check ` +
        `check-signals before changing the gate.\nFirst few: ${rejected.slice(0, 5).join(", ")}`,
    );
  });
}

/**
 * An activation delta must contain the page's response, and nothing else.
 *
 * `activateAndCaptureDelta` reads a baseline from the speech log, activates the control, then attributes
 * everything spoken afterwards to that activation. Anything still IN FLIGHT when the baseline is read is
 * therefore credited to the page — and NVDA's document announcement ("<title>, document") is the phrase
 * most likely to arrive late, because the readiness gate, the anchor and the browse-mode Escape all
 * provoke it.
 *
 * Measured, at protocol 3: exactly ONE capture out of ~125 with an activation recorded
 * `after: "Energy results, document"` on `filter-status-silent/bad`, a page whose entire finding is that
 * activating the filter announces NOTHING. Six repeats of the same page produced the correct empty delta,
 * so the rate is roughly 1 in 125 — and one was enough. That single record was the false negative that
 * made the retrained scorer fail its release gate, which is how a rare race came to block a release.
 *
 * The race is fixed by settling speech before the baseline is read. This asserts it stays fixed, because
 * a 1-in-125 fault cannot be demonstrated absent by repeating a page a feasible number of times — only a
 * check over the whole corpus can see it, and only if something looks.
 */
test("no activation delta was contaminated by a document announcement", () => {
  if (!CORPUS_GUARD.read) return;
  const contaminated = samples.flatMap((s) => {
    const changes = (s.capture as {
      interaction?: { formChanges?: { control?: string; after?: string }[] };
    }).interaction?.formChanges ?? [];
    return changes
      // ", document" is NVDA's role suffix for the document node, so it cannot be part of a control's
      // own response. Matched narrowly on purpose: a page may legitimately announce the word "document".
      .filter((change) => /,\s*document\s*$/i.test(change.after ?? ""))
      .map((change) => `${s.id}.${s.variant}: ${change.control} -> ${change.after}`);
  });
  assert.deepEqual(contaminated, [],
    `${contaminated.length} activation delta(s) recorded NVDA's document announcement instead of the ` +
    `page's response. That is speech from an earlier step arriving late and being credited to the ` +
    `activation, and on a page whose finding is silence it inverts the evidence.`);
});
