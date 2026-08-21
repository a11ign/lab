import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { relative, resolve } from "node:path";
import { ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";

const ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-acceptance");
const PAGE_ROOT = resolve(ROOT, "pages");

function writeCasePages(testCase) {
  const caseRoot = resolve(PAGE_ROOT, testCase.id);
  mkdirSync(caseRoot, { recursive: true });
  const pages = {};
  for (const variant of ["good", "bad"]) {
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
  const cases = ACCEPTANCE_CASES.map((testCase) => ({
    id: testCase.id,
    family: testCase.family,
    criterion: testCase.criterion,
    subtype: testCase.subtype,
    task: testCase.task,
    probeForms: testCase.probeForms,
    probeTables: testCase.probeTables,
    source: testCase.source,
    mutation: testCase.mutation,
    badSignal: testCase.badSignal,
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
