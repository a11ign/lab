import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cacheKey, hashPageDir } from "./capture-cache.mjs";
import { previouslyCaptured } from "./capture-resume.mjs";
import test from "node:test";

const ENV = {
  screenReader: "NVDA",
  screenReaderVersion: "2026.1.1",
  browser: "Microsoft Edge",
  browserVersion: "150.0.4078.105",
  captureProtocol: 2,
  provisionRevision: "unstamped",
};

test("resume recaptures a changed page even for a legacy capture without pageHash", () => {
  const root = mkdtempSync(resolve(tmpdir(), "a11y-resume-"));
  const pageRoot = resolve(root, "pages");
  const captureRoot = resolve(root, "captures");
  const pageDir = resolve(pageRoot, "case-1");
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(captureRoot, { recursive: true });
  writeFileSync(resolve(pageDir, "good.html"), "<h1>good</h1>");
  writeFileSync(resolve(pageDir, "bad.html"), "<h1>bad</h1>");
  const options = { task: "read", steps: 150, probeForms: false, probeTables: false, reuseScreenReader: true };
  const key = cacheKey({ caseId: "case-1", pageHash: hashPageDir(pageDir), options, environment: ENV });
  const capture = (variant: string) => ({
    screenReader: "NVDA",
    transcript: [variant],
    environment: ENV,
    provenance: { cacheKey: key, options },
  });
  writeFileSync(resolve(captureRoot, "case-1.good.json"), JSON.stringify(capture("good")));
  writeFileSync(resolve(captureRoot, "case-1.bad.json"), JSON.stringify(capture("bad")));
  const previous = { cases: { "case-1": { status: "captured" } } };
  const args = { cases: [{ id: "case-1" }], previous, captureRoot, pageRoot, resume: true, cache: false };
  assert.deepEqual(previouslyCaptured(args), new Set(["case-1"]));

  writeFileSync(resolve(pageDir, "bad.html"), "<h1>changed</h1>");
  assert.deepEqual(previouslyCaptured(args), new Set());
  rmSync(root, { recursive: true, force: true });
});

test("resume does not trust pre-cache captures with no provenance", () => {
  const root = mkdtempSync(resolve(tmpdir(), "a11y-resume-"));
  const pageRoot = resolve(root, "pages");
  const captureRoot = resolve(root, "captures");
  const pageDir = resolve(pageRoot, "case-1");
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(captureRoot, { recursive: true });
  writeFileSync(resolve(pageDir, "good.html"), "<h1>good</h1>");
  writeFileSync(resolve(pageDir, "bad.html"), "<h1>bad</h1>");
  for (const variant of ["good", "bad"]) {
    writeFileSync(resolve(captureRoot, `case-1.${variant}.json`), JSON.stringify({
      screenReader: "NVDA",
      transcript: [variant],
    }));
  }
  assert.deepEqual(previouslyCaptured({
    cases: [{ id: "case-1" }],
    previous: { cases: { "case-1": { status: "captured" } } },
    captureRoot,
    pageRoot,
    resume: true,
    cache: false,
  }), new Set());
  rmSync(root, { recursive: true, force: true });
});
