import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHANNEL_LOCATION, channelsPresent } from "@a11y-witness/judge/internal";
import { datasetRoot, captureRoot } from "../dataset-paths.mjs";
import { labCorpusReadable, skipLine } from "../training/corpus-settled.mjs";

/**
 * EVERY CHANNEL A CAPTURE CARRIES MUST BE CLASSIFIED, and `tsc` cannot ask this.
 *
 * `CHANNEL_LOCATION` is `Record<EvidenceChannel, ...>` and therefore exhaustive — which catches a channel
 * added to the UNION and not classified, and is blind in the direction that actually happens: a channel
 * added to CAPTURES and mentioned in neither. Capture-protocol 11 added `structure.frames` and
 * `interaction.dialogEscape`, the whole suite stayed green, and the coverage layer could not see either.
 *
 * That is the `routeChange` defect from its other side. `routeChange` was in the union and missing from
 * `INTERACTION_CHANNELS`, so `criteriaAssessableFrom` answered `BLOCKED: 2.4.2 -> routeChange` on every
 * capture ever taken; the remedy was to derive the arrays from an exhaustive Record. This is the half that
 * remedy structurally cannot reach, and only the corpus can answer it.
 *
 * ON ITS FIRST REAL RUN IT FOUND `postSubmitNames`, which was nobody's new addition — it has been on
 * captures for as long as the field has existed, is compared by `evidence:check`, and is named in
 * capture-core's protocol note as something criteria read.
 *
 * EVERY capture is read, never a slice. The first version sampled `slice(0, 400)`, which is the first 400
 * filenames ALPHABETICALLY — and `iframe-unnamed` sorts past that, so the guard examined a corpus with no
 * frames in it and passed a mutation that removed the classification entirely. A guard must be shown to
 * fail before it is trusted, and this one was not, twice over: wrong verdict AND for a reason invisible
 * from the verdict. The full scan of 2,152 captures costs under a second, so the sample bought nothing.
 *
 * Needs `runs/`, so it SKIPS in CI and says what went unchecked — a test that skips vouches for nothing.
 */
const ROOT = captureRoot(datasetRoot());

interface Corpus {
  /** Every `structure.*`/`interaction.*` key any capture carries, whether or not it holds anything. */
  present: Set<string>;
  /** Those that hold real evidence on at least one capture — the only ones detection can be asked about. */
  nonEmpty: Set<string>;
  /** What `channelsPresent` actually found across the whole corpus. */
  detected: Set<string>;
  scanned: number;
}

/** Every `structure.*`/`interaction.*` entry on one capture, as `[key, value]`. */
function* channelEntries(cap: Record<string, unknown>): Generator<[string, unknown]> {
  for (const group of ["structure", "interaction"] as const) {
    yield* Object.entries((cap[group] as Record<string, unknown>) ?? {});
  }
}

/**
 * Does this value carry evidence, as opposed to merely existing?
 *
 * An empty array is a channel that was asked and found nothing — or was never asked, which is the whole
 * subject of `observed` and is `corpus:distribution`'s question rather than this test's. Either way there
 * is nothing here for `channelsPresent` to detect, so it must not be held to detecting it.
 */
const holdsEvidence = (value: unknown): boolean =>
  (Array.isArray(value) ? value.length > 0 : value != null && typeof value === "object");

function readCorpus(): Corpus {
  const present = new Set<string>();
  const nonEmpty = new Set<string>();
  const detected = new Set<string>();
  let scanned = 0;
  if (!existsSync(ROOT)) return { present, nonEmpty, detected, scanned };
  for (const name of readdirSync(ROOT)) {
    if (!name.endsWith(".json")) continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(readFileSync(resolve(ROOT, name), "utf8")); } catch { continue; }
    // A capture file may BE the capture or carry one. Reading the wrapper as the capture is a recorded
    // defect — `capture:explain` reported 0 of 20 tab stops that way and called it a page finding.
    const cap = ((parsed as { capture?: Record<string, unknown> }).capture ?? parsed);
    scanned += 1;
    for (const [key, value] of channelEntries(cap)) {
      present.add(key);
      if (holdsEvidence(value)) nonEmpty.add(key);
    }
    for (const channel of channelsPresent(cap as never)) detected.add(channel);
  }
  return { present, nonEmpty, detected, scanned };
}

const CORPUS = readCorpus();
// ASK WHETHER THE CORPUS IS MOVING, not only whether it is there. A green result from a corpus a
// capture is rewriting is as untrustworthy as a red one, and it is the green one that gets believed.
// `labCorpusReadable` also counts CAPTURES rather than trusting the directory to exist -- the suite
// writes one report into runs/, and existsSync calls that a corpus.
const GUARD = labCorpusReadable({ present: CORPUS.scanned > 0 });
const SKIP = !GUARD.read && skipLine(GUARD);

test("every channel the captures carry is classified in CHANNEL_LOCATION", { skip: SKIP }, () => {
  const known = new Set(Object.keys(CHANNEL_LOCATION));
  const unclassified = [...CORPUS.present].filter((c) => !known.has(c)).sort();
  assert.deepEqual(unclassified, [],
    `over ${CORPUS.scanned} captures: these are on disk and the coverage layer has never heard of them, so `
    + "no criterion can declare them and no capture can be found to be missing them: "
    + unclassified.join(", "));
});

test("a classified channel is DETECTED on a capture that carries it, not merely listed", { skip: SKIP }, () => {
  // The half that is usually missed. Adding a field to a list makes coverage LOOK real while the reader
  // still returns nothing for it — worse than the omission, because the omission is visible in a diff.
  // `routeChange` was listed and unreadable for exactly this reason, and `evidence:check` had the same
  // shape twice. So this asserts on the READER, over real captures.
  //
  // Compared against channels non-empty SOMEWHERE: a key that is `[]` on every capture is legitimately
  // undetectable, and whether that is a probe that stopped filling it is `corpus:distribution`'s question.
  const known = new Set(Object.keys(CHANNEL_LOCATION));
  const listedButUnread = [...CORPUS.nonEmpty]
    .filter((c) => known.has(c) && !CORPUS.detected.has(c)).sort();
  assert.deepEqual(listedButUnread, [],
    "these are classified and carry real evidence, and `channelsPresent` still reports them absent — "
    + `coverage that looks real and examines nothing: ${listedButUnread.join(", ")}`);
});
