/**
 * A RECORD OF WHERE EVIDENCE CAME FROM IS NEVER RENAMED, and nothing in this repository could tell when
 * one was.
 *
 * #534, following #515. `e435ac17` (the product rename) rewrote the recorded capture `url` in these ten
 * eval fixtures — one line each, from the path the capture really ran under to one that has never existed
 * on that machine:
 *
 *     -  "url": "file:///C:/Users/borem/a11y-witness/src/eval/pages/books/headings-bad.html",
 *     +  "url": "file:///C:/Users/borem/a11ign/src/eval/pages/books/headings-bad.html",
 *
 * **No number moved and nothing went red**, either side of it. That is what makes this a blocker rather
 * than a tidy-up: nothing recomputes a recorded provenance value against anything, so a sweep can edit
 * the answer to "where did this evidence come from" and every gate in the repository stays green.
 * `identity:rate`'s whole premise is that the record says which page.
 *
 * ## Why a DIGEST, and why the two obvious guards fail
 *
 * The property that matters is not "a checksum". It is that **the guard's expectation must be
 * unreachable by the same motion that would corrupt the thing it guards** — and the motion here is one
 * `sed` over the tree. Both obvious shapes fail exactly there, and each for a reason this repository has
 * already paid for:
 *
 *   - **A diff against `origin/main`.** On `main`, `HEAD` IS `origin/main`, so the comparison is
 *     `diff(B, B)` — empty by construction, green forever, examining nothing. That vacuity is what held
 *     trunk red for 8 h 28 m on 2026-09-08 before anyone noticed the check could not fail.
 *   - **A pinned literal in the test.** The sweep rewrites the fixture and the expectation in the same
 *     pass, so the two copies drift TOGETHER — which is worse than drifting apart, because nothing
 *     disagrees and the guard reports green about a value it no longer describes. CLAUDE.md's
 *     "A FACT STATED TWICE" is the general case; this is its sharpest instance.
 *
 * A hex digest carries neither product name, so no rename sweep can touch it. Restoring green after one
 * requires restoring the VALUES.
 *
 * ## What is in the digest, and what deliberately is not
 *
 * The `environment` block is taken WHOLESALE rather than field by field, so a new environment field
 * (`provisionRevision` was one, once) joins the guarded set without anybody remembering. Outside it, four
 * keys are named because they are the provenance fields that do not live there: `url` (where the capture
 * ran, and where the page was served from — the `browserReused` diagnostic carries a second one),
 * `capturedAt`, `baseUrl` and `cacheKey`.
 *
 * NOT the transcript or the structure. Those are evidence too, and they change legitimately whenever a
 * fixture is recaptured; folding them in would make this guard fire on every honest change and therefore
 * get bypassed, which is how a check stops being a check.
 *
 * ## What was swept and found CLEAN, so nobody repeats it
 *
 * The authoritative corpus was read read-only by the orchestrator at **2026-09-08T18:24:18Z**: **zero
 * `a11ign` across 7,941 JSON files under `runs/`**, proven with a positive control — `"transcript"`
 * matched 7,907 of them. The first control tried, `"a11y-worker"`, was itself absent (captures record
 * worker IPs, not hostnames) and would have read as a broken grep. **29 files under `runs/model-*` and
 * `runs/salvage` DO carry the old name**, as the training reports' schema identifier
 * `"a11y-witness/screenreader-scorer-training"` — a true statement about what produced them, and it must
 * never be swept.
 */
// FIRST, so it observes every read below it -- #929. See `scripts/walk-scope.mjs`.
import { declareWalkScope } from "../../../../scripts/walk-scope.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * WHAT THIS GUARD READS, declared so a diff outside it does not run it -- #929. It reads recorded-provenance sources under `packages/lab/src` and nothing outside it.
 * Its own run checks that, and fails if it ever reads wider.
 */
export const WALK_SCOPE = ["packages/lab/src"];
await declareWalkScope(import.meta.url);

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURES = "packages/lab/src/eval/fixtures/books";
const DIGESTS = "packages/lab/src/eval/recorded-provenance.sha256";

/**
 * The provenance keys that live OUTSIDE `environment`. Named rather than derived because there is
 * nothing to derive them from — unlike `environment`, whose every member is provenance by construction.
 */
const PROVENANCE_KEYS = new Set(["url", "capturedAt", "baseUrl", "cacheKey"]);

/**
 * Every recorded provenance leaf, as `path = value`, in document order. `JSON.parse` preserves insertion
 * order for string keys, so the sequence is a property of the file rather than of this walk.
 */
export function provenanceOf(value: unknown, path = "", underEnvironment = false): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => provenanceOf(item, `${path}[${i}]`, underEnvironment));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      provenanceOf(child, path === "" ? key : `${path}.${key}`, underEnvironment || key === "environment"));
  }
  const key = path.split(".").pop() ?? "";
  return underEnvironment || PROVENANCE_KEYS.has(key) ? [`${path} = ${String(value)}`] : [];
}

const digestOf = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex");

const fixtureFiles = (): string[] =>
  readdirSync(join(REPO, FIXTURES)).filter((f) => f.endsWith(".json")).sort();

/** The committed file, as `path -> digest`. Comment and blank lines are ignored. */
function committedDigests(): Map<string, string> {
  const rows = readFileSync(join(REPO, DIGESTS), "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
  return new Map(rows.map((row) => {
    const [digest, path] = row.split(/\s+/);
    return [path, digest];
  }));
}

test("the extraction actually reaches the recorded fields -- a digest over an empty list is a stable "
  + "hash of nothing, which is the vacuity this guard would otherwise ship", () => {
  const one = JSON.parse(readFileSync(join(REPO, FIXTURES, "headings-bad.json"), "utf8"));
  const lines = provenanceOf(one);
  assert.ok(lines.length >= 12, `only ${lines.length} provenance field(s) extracted: ${lines.join(", ")}`);
  assert.ok(lines.some((l) => l.startsWith("url = file:///C:/")),
    "the top-level capture url is the field this whole row exists for and it is not in the set");
  assert.ok(lines.some((l) => l.includes("environment.browserVersion = ")),
    "the environment block must be taken wholesale, so a new field joins without anybody remembering");
  assert.ok(!lines.some((l) => l.startsWith("transcript")),
    "the transcript is evidence that changes on an honest recapture; folding it in makes this guard "
    + "fire on every legitimate change and therefore get bypassed");
});

test("every fixture has a committed digest and every committed digest names a fixture -- membership "
  + "drift is how a file quietly leaves a guarded set", () => {
  const committed = committedDigests();
  const files = fixtureFiles();
  assert.ok(files.length >= 10, `only ${files.length} fixture(s) found -- the walk is broken`);
  assert.deepEqual(files.map((f) => `${FIXTURES}/${f}`).sort(), [...committed.keys()].sort());
});

test("every fixture's recorded provenance still hashes to what was committed -- a rename sweep can "
  + "rewrite the values but not a hex digest, so restoring green means restoring the VALUES", () => {
  const committed = committedDigests();
  const mismatches: string[] = [];
  for (const file of fixtureFiles()) {
    const path = `${FIXTURES}/${file}`;
    const lines = provenanceOf(JSON.parse(readFileSync(join(REPO, path), "utf8")));
    const actual = digestOf(lines);
    if (actual !== committed.get(path)) mismatches.push(`${actual}  ${path}\n    now: ${lines.join("\n    now: ")}`);
  }
  assert.deepEqual(mismatches, [], mismatches.length === 0 ? "" :
    `${mismatches.length} fixture(s) no longer hash to their committed provenance digest:\n\n`
    + `${mismatches.join("\n\n")}\n\n`
    + `If a capture was genuinely re-taken, paste the new digest into ${DIGESTS}. Doing so ASSERTS that `
    + "these values describe where the evidence actually came from -- not that the test was noisy. If "
    + "you did not re-capture anything, something has edited a record of the past: find what, and "
    + "restore the values instead.");
});
