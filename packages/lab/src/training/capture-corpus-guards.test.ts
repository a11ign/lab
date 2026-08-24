import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { hashPageDir } from "./capture-cache.mjs";

// The repo root, resolved from THIS FILE rather than from the cwd. It was `process.cwd()`, which is the repo
// root for `npm test` and nothing else — and it broke outright when M8 moved this file into a package, because
// the programs it spawns are now four levels away rather than two.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CHECK_SIGNALS = resolve(ROOT, "packages/lab/src/training/check-signals.mjs");
const EXPORT = resolve(ROOT, "packages/lab/src/training/export-screenreader-dataset.mjs");

function createCorpus(stale: boolean) {
  const root = mkdtempSync(resolve(tmpdir(), "a11y-corpus-guard-"));
  const pageDir = resolve(root, "pages", "case-1");
  const captureDir = resolve(root, "captures");
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(captureDir, { recursive: true });
  writeFileSync(resolve(pageDir, "good.html"), "<main>good</main>\n");
  writeFileSync(resolve(pageDir, "bad.html"), "<main>bad</main>\n");
  const pageHash = stale ? "stale-page-hash" : hashPageDir(pageDir);
  for (const variant of ["good", "bad"]) {
    writeFileSync(resolve(captureDir, `case-1.${variant}.json`), JSON.stringify({
      screenReader: "NVDA",
      transcript: [variant],
      provenance: { pageHash },
    }));
  }
  writeFileSync(resolve(root, "manifest.json"), JSON.stringify({ cases: [{
    id: "case-1",
    criterion: "1.1.1",
    badSignal: { type: "regex", pattern: "^bad$", flags: "i" },
    source: "test fixture",
    mutation: "test mutation",
  }] }));
  return root;
}

function run(script: string, root: string, out?: string, extra: string[] = []) {
  const args = [script, ...extra];
  if (out) args.push(`--out=${out}`);
  try {
    return { status: 0, output: execFileSync(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, DATASET_ROOT: root },
      encoding: "utf8",
    }) };
  } catch (error) {
    // stderr too. It was stdout only, so a script that DIED reported an empty output and every assertion
    // on it read as "the export printed nothing" rather than naming the exception — which is this repo's
    // usual defect (a check that cannot tell two causes apart) inside its own test helper.
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: (failure.stdout ?? "") + (failure.stderr ?? "") };
  }
}

test("signal checks never accept stale capture evidence as a pass", () => {
  // This used to assert exit 1 flatly. `check-signals` now separates a DEFECT (a signal that does not
  // discriminate — always fatal) from a COVERAGE GAP (no evidence matching the current definitions), because
  // a working copy cannot tell a corpus needing capture from a `runs/` that is merely out of date. What must
  // not change is the property this test was written for: stale evidence is never silently accepted.
  //
  // A one-case corpus is below MIN_EXAMINED, so the honest answer here is 2 — INCONCLUSIVE, explicitly not
  // a pass — rather than 1. "We could not tell" and "we checked and it is fine" must never share an exit
  // code, which is the same rule that made 404 and 202 different answers in the worker.
  const root = createCorpus(true);
  try {
    const result = run(CHECK_SIGNALS, root);
    assert.notEqual(result.status, 0, "stale evidence must never exit 0");
    assert.equal(result.status, 2);
    assert.match(result.output, /STALE CAPTURES/);
    assert.match(result.output, /INCONCLUSIVE/);
    assert.match(result.output, /This is not a pass/);
    assert.match(result.output, /0 discriminating, 0 blind, 0 contaminated, 0 uncaptured, 1 stale/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--require-complete makes stale evidence a hard failure, for the paths that own the corpus", () => {
  // `release:gate` and the lab job pass this flag. There the corpus IS authoritative, so "no evidence for
  // that case" is an answer — go capture — and it must block a release rather than be reported.
  const root = createCorpus(true);
  try {
    const result = run(CHECK_SIGNALS, root, undefined, ["--require-complete"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /--require-complete/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("export accepts only a page-matching capture pair", () => {
  const current = createCorpus(false);
  const stale = createCorpus(true);
  try {
    const currentOut = resolve(current, "evidence.jsonl");
    const currentResult = run(EXPORT, current, currentOut);
    assert.equal(currentResult.status, 0, currentResult.output.slice(0, 900));
    assert.match(currentResult.output, /Exported 2 records/);
    assert.equal(readFileSync(currentOut, "utf8").trim().split("\n").length, 2);

    const staleOut = resolve(stale, "evidence.jsonl");
    const staleResult = run(EXPORT, stale, staleOut);
    assert.equal(staleResult.status, 0);
    assert.match(staleResult.output, /Exported 0 records/);
    assert.equal(readFileSync(staleOut, "utf8"), "");
  } finally {
    rmSync(current, { recursive: true, force: true });
    rmSync(stale, { recursive: true, force: true });
  }
});
