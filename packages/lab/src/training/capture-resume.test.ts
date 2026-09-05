import assert from "node:assert/strict";
import { CASES } from "./case-matrix.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cacheKey, hashPageDir } from "./capture-cache.mjs";
import { previouslyCaptured } from "./capture-resume.mjs";
import { captureFilePath } from "../capture/evidence-diff.mjs";
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
    writeFileSync(captureFilePath(captureRoot, "case-1", variant), JSON.stringify({
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

test("`--only=X+` selects the family; `--only=X` still means exactly X", () => {
  // The exact-id rule cannot be relaxed — `form-error-silent` is a real id AND a prefix of ~90 others, so
  // asking for it must mean that one. But a corpus change usually touches a FAMILY: a base case plus its
  // `+also-` and `+with-` variants, and there was no way to say so.
  //
  // Measured 2026-08-26: `--only=route-title-stale`, used to prove a furniture fix before committing a
  // four-hour recapture, captured 1 case of 7. The run reported success and four cases stayed stale — the
  // targeted-verification loop giving a confident partial answer, which is worse than no answer.
  //
  // `+` is unambiguous because it is the variant separator: no case is named `X+`, and every variant of
  // X begins `X+`.
  const ids = new Set(CASES.map((c: { id: string }) => c.id));
  const pick = (only: string) => (CASES as Array<{ id: string }>).filter(({ id }) =>
    only.split(",").map((s) => s.trim()).some((want) => {
      if (want.endsWith("+")) return id === want.slice(0, -1) || id.startsWith(want);
      return ids.has(want) ? id === want : id.includes(want);
    })).length;

  assert.equal(pick("route-title-stale"), 1, "an exact id must still mean exactly that case");
  assert.ok(pick("route-title-stale+") > 1, "a trailing + must reach the variants");
  assert.equal(pick("route-title-stale+"), pick("route-title-stale") + 6,
    "the family is the base case plus its variants — 7 for this subtype");
  // The rule that made exact matching necessary in the first place, still holding.
  assert.equal(pick("form-error-silent"), 1, "a prefix of ~90 other ids must not sweep them");
});
