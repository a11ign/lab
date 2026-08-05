import { mkdirSync, writeFileSync } from "node:fs";
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
