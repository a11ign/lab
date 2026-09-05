// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { relative, resolve } from "node:path";
import { CASES } from "./case-matrix.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * takes no flags: it regenerates every page from the case definitions.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags([], { entry: import.meta.url, command: "npm run training:generate" });

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const PAGE_ROOT = resolve(ROOT, "pages");

/**
 * @param {{id: string, good: string, bad: string}} testCase
 * @returns {Record<string, string>}
 */
function writeCasePages(testCase) {
  const caseRoot = resolve(PAGE_ROOT, testCase.id);
  mkdirSync(caseRoot, { recursive: true });
  /** @type {Record<string, string>} */
  const files = {};
  for (const variant of /** @type {const} */ (["good", "bad"])) {
    const filename = variant + ".html";
    const absolutePath = resolve(caseRoot, filename);
    writeFileSync(absolutePath, testCase[variant], "utf8");
    files[variant] = relative(ROOT, absolutePath);
  }
  return files;
}

function buildManifest() {
  const generatedCases = CASES.map((/** @type {any} */ testCase) => {
    const files = writeCasePages(testCase);
    return {
      id: testCase.id,
      family: testCase.family,
      criterion: testCase.criterion,
      // Criteria the case ALSO breaks. The THIRD hand-enumerated field list in this chain — the case
      // definition, `pair()`, and here — and a field must be added to every one of them or it vanishes
      // without a word. It vanished twice while three case definitions declared it.
      alsoFails: testCase.alsoFails ?? [],
      subtype: testCase.subtype,
      // Read by `check-signals.mjs`, which runs from the MANIFEST rather than `CASES` — the same reason
      // every other field here is hand-copied and the same trap: an entry missing from this list arrives
      // as `undefined` downstream regardless of what the case declares. Kept `null` rather than omitted
      // when unset, so a stale manifest predating this field reads as "not provisional" rather than as a
      // dropped one — `provisional-cases.test.ts` checks the round trip.
      provisional: testCase.provisional ?? null,
      task: testCase.task,
      // Every `probe*` flag, forwarded by NAME rather than enumerated, because enumerating them is how this
      // exact defect happened three times in one feature. `probeFocus` was added to `pair()` and to the
      // capture runner and MISSED here -- and since the runner reads the MANIFEST, not `CASES`, the flag
      // arrived as `undefined`, the focus probe never ran, and both captures came back with an empty
      // `focusOrder` and no diagnostic at all. A case can ask for a probe and be silently ignored.
      //
      // `case-matrix.mjs`'s `pair()` already carries a scar comment about the same thing happening to
      // `alsoFails`: "the count read 0 while three case definitions carried it". Third instance, same shape,
      // so this hop stops enumerating and `manifest-probes.test.ts` asserts the round trip for all of them.
      ...Object.fromEntries(
        Object.entries(testCase).filter(([key]) => key.startsWith("probe")),
      ),
      source: testCase.source,
      mutation: testCase.mutation,
      badSignal: testCase.badSignal,
      pages: files,
    };
  });
  return {
    schema: "a11y-witness/screen-reader-dataset-manifest",
    version: 1,
    generatedAt: new Date().toISOString(),
    captureBoundary: "NVDA announcements and NVDA-derived navigation/interaction output only",
    cases: generatedCases,
  };
}

function main() {
  mkdirSync(PAGE_ROOT, { recursive: true });
  const manifest = buildManifest();
  const manifestPath = resolve(ROOT, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("Generated " + manifest.cases.length + " controlled page pairs.");
  console.log("Manifest: " + manifestPath);
  console.log("Pages: " + PAGE_ROOT);
}

// Only when RUN, never on import. CLAUDE.md makes `node -e "import('./this.mjs')"` the only real check
// that an .mjs file still loads -- neither lint nor tsc can see a ReferenceError at import -- and unguarded
// that mandated check EXECUTES this script. A verification you cannot safely run is not a verification.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
