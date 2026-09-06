// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { relative, resolve } from "node:path";
// ALL of them, single- and multi-defect. Generating only the single-defect set is what made held-out
// acceptance blind to the case the trained heads actually fail on — see `alsoCarrying` for the measurement.
import { ALL_ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";
import { datasetRoot, refuseIfRunsReadonly } from "../dataset-paths.mjs";

/**
 * takes no flags: the held-out set is generated whole or not at all.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags([], { entry: import.meta.url, command: "npm run training:generate-acceptance" });

const ROOT = datasetRoot("screenreader-acceptance");
const PAGE_ROOT = resolve(ROOT, "pages");

/**
 * @param {{id: string, good: string, bad: string}} testCase
 * @returns {Record<string, string>}
 */
function writeCasePages(testCase) {
  const caseRoot = resolve(PAGE_ROOT, testCase.id);
  mkdirSync(caseRoot, { recursive: true });
  /** @type {Record<string, string>} */
  const pages = {};
  for (const variant of /** @type {const} */ (["good", "bad"])) {
    const path = resolve(caseRoot, variant + ".html");
    writeFileSync(path, testCase[variant], "utf8");
    pages[variant] = relative(ROOT, path);
  }
  return pages;
}

/**
 * Only when RUN, never on import.
 *
 * The boundary is HERE, at `const cases`, and not at the `mkdirSync` further down -- because the map calls
 * `writeCasePages`, which creates a directory and writes two HTML files PER CASE. So the first thing this
 * file used to do on import was write the entire acceptance page tree to disk.
 *
 * Worth stating because a brace-depth scan for dangerous calls at module scope reports this file clean: the
 * writes are one call deeper, inside a local function. Indirection is the blind spot of that check, and it
 * is why these were placed by reading each file rather than by a tool.
 */
function main() {
  refuseIfRunsReadonly(ROOT);
  const cases = ALL_ACCEPTANCE_CASES.map((testCase) => ({
    id: testCase.id,
    family: testCase.family,
    criterion: testCase.criterion,
    subtype: testCase.subtype,
    task: testCase.task,
    // BY PREFIX, exactly as generate-screenreader-dataset.mjs does it, and for the reason its comment
    // gives: "enumerating them is how this exact defect happened three times in one feature". This hop
    // enumerated two, so an acceptance case asking for `probeFocus` had the flag silently dropped between
    // the case and the manifest -- and the runner reads the MANIFEST, so the probe never ran and the
    // capture came back with no evidence, which is indistinguishable from a page that had none.
    ...Object.fromEntries(Object.entries(testCase).filter(([key]) => key.startsWith("probe"))),
    probeForms: testCase.probeForms,
    probeTables: testCase.probeTables,
    source: testCase.source,
    mutation: testCase.mutation,
    badSignal: testCase.badSignal,
    // The secondary criteria a multi-defect page genuinely fails, and the THIRD time this field has been
    // dropped by a hand-written hop. `pair()` carries the scar from the first: "a case declaring
    // `alsoFails` without this line is silently dropped -- which it was, and the count read 0 while three
    // case definitions carried it."
    //
    // Measured 2026-08-23, and this time it accused the SHIPPED model of a defect it did not have.
    // `acceptance-link-guidance+also-generic-heading` declares `alsoFails: ["2.4.6:regex"]` and its page
    // really does carry `<h2>Details</h2>`, a non-descriptive heading. The manifest dropped the field, the
    // exporter reads the MANIFEST rather than the case, so the record was labelled `criteria: ["2.4.4"]`
    // alone — and the model detecting a real 2.4.6 failure was scored a FALSE POSITIVE and reported as a
    // held-out acceptance failure against released weights.
    //
    // A label that omits a defect the page actually has does not measure the model; it measures the label.
    alsoFails: testCase.alsoFails,
    pages: writeCasePages(testCase),
  }));

  mkdirSync(PAGE_ROOT, { recursive: true });
  const manifest = {
    schema: "a11y-witness/screen-reader-acceptance-manifest",
    version: 1,
    generatedAt: new Date().toISOString(),
    captureBoundary: "NVDA announcements and NVDA-derived navigation/interaction output only",
    trainingExcluded: true,
    cases,
  };
  const manifestPath = resolve(ROOT, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("Generated " + cases.length + " acceptance pairs.");
  console.log("Manifest: " + manifestPath);
  console.log("Pages: " + PAGE_ROOT);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
