// @ts-check
// DOES THE MANIFEST STILL DESCRIBE THE CASES THE CODE DEFINES? -- one answer, for every reader that computes a
// verdict on the case set or acts on it (#958).
//
// Every such reader reads `runs/screenreader-dataset/manifest.json`, not `CASES`, and the manifest is only
// as current as the last `training:generate`. The drift has THREE directions:
//
//   deleted   a manifest case no longer in `CASES`
//   changed   a field that differs between the two (`pages` excepted: it is manifest-only)
//   added     a `CASES` entry the manifest does not list
//
// Only the export checked all three. `check-signals` checked `deleted` alone, so on 2026-09-11 it PASSED over
// a manifest missing #869's five new 1.3.5 cases -- they were never examined -- and failed the moment the
// manifest was regenerated (`orchestrator`, #957). The capture and `evidence-check` checked none. A check
// applied at one call site when the behaviour reaches several is this repository's most-recorded shape, so
// the check lives here and each reader calls it; none keeps its own partial copy.
//
// PASS THE WHOLE MANIFEST, never a `--only` selection of it: the `added` direction compares against all of
// `CASES`, so a filtered list would read as every unselected case missing.
import { CASES } from "./case-matrix.mjs";

/** Key-sorted JSON, so two definitions that differ only in key order compare equal. @param {unknown} value @returns {string} */
function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort()
      .map((/** @type {string} */ k) => JSON.stringify(k) + ":" + canonicalJson(/** @type {Record<string, unknown>} */ (value)[k])).join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

/**
 * The drift between a manifest and the cases the code defines, all three directions.
 *
 * A manifest that shares NO id with `CASES` is not a stale corpus -- it is a different case set: a test
 * fixture, or an archived corpus exported deliberately via DATASET_ROOT. `fixture: true` says so, and nothing
 * is compared: "every id is missing" is not the drift this guards against. The real corpus shares every id.
 *
 * @param {{ cases: readonly { id: string }[] }} manifest the WHOLE manifest
 * @param {readonly { id: string }[]} [cases] what the code defines; `CASES` unless a test passes its own
 * @returns {{ fixture: boolean, drifted: string[] }}
 */
export function manifestDrift(manifest, cases = CASES) {
  const defined = new Map(cases.map((testCase) => [testCase.id, testCase]));
  if (!manifest.cases.some((entry) => defined.has(entry.id))) return { fixture: true, drifted: [] };
  /** @type {string[]} */
  const drifted = [];
  for (const entry of manifest.cases) {
    const testCase = defined.get(entry.id);
    if (!testCase) { drifted.push(`${entry.id}: in the manifest, not in CASES`); continue; }
    for (const field of Object.keys(entry)) {
      if (field === "pages") continue;
      const was = canonicalJson(/** @type {Record<string, unknown>} */ (entry)[field]);
      const now = canonicalJson(/** @type {Record<string, unknown>} */ (testCase)[field]);
      if (was !== now) drifted.push(`${entry.id}.${field}: manifest=${was} CASES=${now}`);
    }
  }
  const listed = new Set(manifest.cases.map((entry) => entry.id));
  for (const id of defined.keys()) {
    if (!listed.has(id)) drifted.push(`${id}: in CASES, not in the manifest`);
  }
  return { fixture: false, drifted };
}

/** Enough entries to see the pattern; the count gives the scale. */
const NAMED = 8;

/**
 * Refuses a manifest that has drifted from `CASES`, naming what drifted and what that would cost THIS reader.
 * Which of the two is authoritative is genuinely ambiguous -- the manifest is what the captures were taken
 * under, `CASES` is what the code now means -- so this reports rather than picking, and the fix is the same
 * either way: regenerate, then recapture what changed.
 *
 * A fixture manifest is REPORTED through `log`, never skipped in silence: a guard that skips quietly is
 * indistinguishable from one that never ran.
 *
 * @param {{ cases: readonly { id: string }[] }} manifest the WHOLE manifest
 * @param {{ consequence: string, cases?: readonly { id: string }[], log?: (line: string) => void }} options
 *   `consequence` finishes "so ..." with what this reader would do wrong over a stale manifest
 */
export function assertManifestMatchesCases(manifest, { consequence, cases = CASES, log = console.log }) {
  const { fixture, drifted } = manifestDrift(manifest, cases);
  if (fixture) {
    log(`Manifest shares no case id with CASES (${manifest.cases.length} entries); not comparing definitions.`);
    return;
  }
  if (!drifted.length) return;
  throw new Error(`The manifest describes case definitions that no longer match CASES, so ${consequence}.\n  `
    + drifted.slice(0, NAMED).join("\n  ")
    + (drifted.length > NAMED ? `\n  ... and ${drifted.length - NAMED} more` : "")
    + "\nRegenerate it, on the box that owns the corpus:  npm run lab:job -- -e job=generate"
    + "\n  (locally, against a copy: npm run training:generate)"
    + "\n(Page files are rewritten byte-identically unless a page actually changed, so this does not "
    + "invalidate captures on its own.)");
}
