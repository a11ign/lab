// The cache decides whether to trust evidence on disk, so its failure mode is silently reusing a
// capture that no longer describes the page. Every test here is one way that could happen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cacheDecision, cacheKey, environmentKey, hashPageDir, stampProvenance } from "./capture-cache.mjs";
import { captureFilePath } from "../capture/evidence-diff.mjs";

const ENV = {
  screenReader: "NVDA",
  screenReaderVersion: "2026.1.1",
  browser: "Microsoft Edge",
  browserVersion: "150.0.4078.105",
  captureProtocol: 1,
  provisionRevision: "abc1234-deadbeef",
  workerCode: "code0000",
};

function sandbox() {
  const root = mkdtempSync(resolve(tmpdir(), "a11y-cache-"));
  const pages = resolve(root, "pages", "case-1");
  const captures = resolve(root, "captures");
  mkdirSync(pages, { recursive: true });
  mkdirSync(captures, { recursive: true });
  writeFileSync(resolve(pages, "good.html"), "<h1>good</h1>");
  writeFileSync(resolve(pages, "bad.html"), "<h1>bad</h1>");
  return { root, pages, captures };
}

const keyFor = (pages: string, over: Record<string, unknown> = {}) => cacheKey({
  caseId: "case-1",
  pageHash: hashPageDir(pages),
  options: { steps: 150, probeForms: false, task: null, reuseScreenReader: true },
  environment: ENV,
  ...over,
});

function writePair(captures: string, key: string | undefined, over: Record<string, unknown> = {}) {
  for (const variant of ["good", "bad"]) {
    const capture = stampProvenance(
      { screenReader: "NVDA", transcript: ["a phrase"], capturedAt: "2026-07-29T00:00:00.000Z" },
      { key: key!, options: {}, environment: ENV },
    );
    if (key === undefined) delete (capture as { provenance?: unknown }).provenance;
    writeFileSync(captureFilePath(captures, "case-1", variant), JSON.stringify({ ...capture, ...over }));
  }
}

test("an unchanged case is reused", () => {
  const { pages, captures, root } = sandbox();
  const key = keyFor(pages);
  writePair(captures, key);
  const decision = cacheDecision({ captureRoot: captures, caseId: "case-1", key });
  assert.equal(decision.reuse, true);
  rmSync(root, { recursive: true, force: true });
});

test("new evidence records the page hash for resume validation", () => {
  const { pages, root } = sandbox();
  try {
    const pageHash = hashPageDir(pages);
    const capture = stampProvenance(
      { screenReader: "NVDA", transcript: ["a phrase"] },
      { key: "1234567890abcdef", pageHash, options: {}, environment: ENV },
    );
    assert.equal(capture.provenance?.pageHash, pageHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("changing a page byte invalidates the case", () => {
  const { pages, captures, root } = sandbox();
  writePair(captures, keyFor(pages));
  writeFileSync(resolve(pages, "bad.html"), "<h1>bad!</h1>");
  const decision = cacheDecision({ captureRoot: captures, caseId: "case-1", key: keyFor(pages) });
  assert.equal(decision.reuse, false);
  rmSync(root, { recursive: true, force: true });
});

test("a new asset in the page directory invalidates the case", () => {
  const { pages, captures, root } = sandbox();
  writePair(captures, keyFor(pages));
  // There are no assets today, but a fixture that gains one must not keep its old evidence.
  writeFileSync(resolve(pages, "photo.svg"), "<svg/>");
  assert.equal(cacheDecision({ captureRoot: captures, caseId: "case-1", key: keyFor(pages) }).reuse, false);
  rmSync(root, { recursive: true, force: true });
});

test("a protocol bump invalidates everything", () => {
  const { pages, captures, root } = sandbox();
  writePair(captures, keyFor(pages));
  const bumped = keyFor(pages, { environment: { ...ENV, captureProtocol: 2 } });
  assert.equal(cacheDecision({ captureRoot: captures, caseId: "case-1", key: bumped }).reuse, false);
  rmSync(root, { recursive: true, force: true });
});

test("a new NVDA or Edge version invalidates the case", () => {
  const { pages, captures, root } = sandbox();
  writePair(captures, keyFor(pages));
  for (const changed of [{ screenReaderVersion: "2026.2" }, { browserVersion: "151.0.1.1" }]) {
    const key = keyFor(pages, { environment: { ...ENV, ...changed } });
    assert.equal(cacheDecision({ captureRoot: captures, caseId: "case-1", key }).reuse, false);
  }
  rmSync(root, { recursive: true, force: true });
});

test("re-provisioning the guest invalidates the case", () => {
  const { pages, captures, root } = sandbox();
  writePair(captures, keyFor(pages));
  const key = keyFor(pages, { environment: { ...ENV, provisionRevision: "ffff999-cafebabe" } });
  assert.equal(cacheDecision({ captureRoot: captures, caseId: "case-1", key }).reuse, false);
  rmSync(root, { recursive: true, force: true });
});

test("a comment-only code change does NOT invalidate the case", () => {
  // The whole reason the key excludes the worker's code hash: rewording a comment must not cost a
  // 1.5-hour recapture. The differing hash is reported to the caller, not acted on.
  const { pages, captures, root } = sandbox();
  const key = keyFor(pages);
  writePair(captures, key);
  const decision = cacheDecision({ captureRoot: captures, caseId: "case-1", key });
  assert.equal(decision.reuse, true);
  assert.equal(decision.staleCode, "code0000");
  rmSync(root, { recursive: true, force: true });
});

test("evidence captured before the cache existed is not reused", () => {
  const { pages, captures, root } = sandbox();
  writePair(captures, undefined);
  assert.equal(cacheDecision({ captureRoot: captures, caseId: "case-1", key: keyFor(pages) }).reuse, false);
  rmSync(root, { recursive: true, force: true });
});

test("an empty transcript is never reused, even with a matching key", () => {
  // Empty captures are the known foreground flake. Caching one would make a transient failure
  // permanent.
  const { pages, captures, root } = sandbox();
  const key = keyFor(pages);
  writePair(captures, key, { transcript: [] });
  assert.equal(cacheDecision({ captureRoot: captures, caseId: "case-1", key }).reuse, false);
  rmSync(root, { recursive: true, force: true });
});

test("one stale variant invalidates the whole pair", () => {
  // A pair is only comparable if both halves came from the same worker and environment, so reuse
  // must be all-or-nothing.
  const { pages, captures, root } = sandbox();
  const key = keyFor(pages);
  writePair(captures, key);
  const good = JSON.parse(readFileSync(resolve(captures, "case-1.good.json"), "utf8"));
  good.provenance.cacheKey = "0000000000000000";
  writeFileSync(resolve(captures, "case-1.good.json"), JSON.stringify(good));
  assert.equal(cacheDecision({ captureRoot: captures, caseId: "case-1", key }).reuse, false);
  rmSync(root, { recursive: true, force: true });
});

test("the key is stable under object key order", () => {
  const a = cacheKey({ caseId: "c", pageHash: "h", options: { a: 1, b: 2 }, environment: ENV });
  const b = cacheKey({ caseId: "c", pageHash: "h", options: { b: 2, a: 1 }, environment: ENV });
  assert.equal(a, b);
});

test("an unreportable environment still keys consistently", () => {
  assert.deepEqual(environmentKey({}), {
    screenReader: "NVDA/unknown",
    browser: "unknown/unknown",
    os: "unknown/unknown",
    driver: "guidepup/unknown",
    captureProtocol: "unknown",
    // "default", NOT "unknown", and the difference is a real claim rather than a style choice. Every
    // capture taken before this field existed WAS taken at NVDA's defaults, so the absent value is a fact
    // about those captures and saying so beats saying we cannot tell. It still differs from the digest a
    // current guest reports, so nothing blends.
    screenReaderSettings: "default",
    provisionRevision: "unstamped",
  });
});

test("a guest capturing under different NVDA settings is a different environment", () => {
  // The property the field exists for. `reportLanguage` off means NVDA announces a 3.1.2 failure as a
  // change of VOICE and no text; on, it speaks the language into the transcript. Same page, different
  // evidence — so the two must never share a cache entry, exactly as two guidepup versions must not.
  const before = { ...ENV, screenReaderSettings: "default" };
  const after = { ...ENV, screenReaderSettings: "documentFormatting.reportLanguage=True" };
  assert.notEqual(
    JSON.stringify(environmentKey(before)), JSON.stringify(environmentKey(after)),
    "a capture taken with reportLanguage off must not be reused for one taken with it on");
});

test("a different Windows build is a different environment", () => {
  // Two images in one fleet must not share evidence. Whether NVDA announces identically across them is
  // what evidence:check answers; until it has, the cache must not assume it.
  const { root, pages } = sandbox();
  try {
    const base = { ...ENV, windowsVersion: "Microsoft Windows 11 Pro 10.0.22621", architecture: "arm64" };
    const other = { ...base, windowsVersion: "Microsoft Windows 11 Pro 10.0.26100" };
    assert.notEqual(keyFor(pages, { environment: base }), keyFor(pages, { environment: other }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a different architecture is a different environment", () => {
  // The concrete case: a developer's ARM64 Mac guest and an x64 server guest.
  const { root, pages } = sandbox();
  try {
    const arm = { ...ENV, windowsVersion: "Microsoft Windows 11 Pro 10.0.22621", architecture: "arm64" };
    const x64 = { ...arm, architecture: "x64" };
    assert.notEqual(keyFor(pages, { environment: arm }), keyFor(pages, { environment: x64 }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the same OS and architecture still share evidence", () => {
  // The pool only works because interchangeable guests reuse each other's captures.
  const { root, pages } = sandbox();
  try {
    const env = { ...ENV, windowsVersion: "Microsoft Windows 11 Pro 10.0.22621", architecture: "arm64" };
    assert.equal(keyFor(pages, { environment: env }), keyFor(pages, { environment: { ...env } }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a different guidepup version is a different environment", () => {
  // guidepup parses NVDA's speech before this project sees it, and 0.29.2 -> 0.31.0 changed that
  // parse: an object placeholder that intermittently appeared as U+FFFC now renders consistently as
  // an empty segment. Same NVDA, same page, same browser, different evidence.
  const { root, pages } = sandbox();
  try {
    const old = { ...ENV, guidepupVersion: "0.29.2" };
    const now = { ...ENV, guidepupVersion: "0.31.0" };
    assert.notEqual(keyFor(pages, { environment: old }), keyFor(pages, { environment: now }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
