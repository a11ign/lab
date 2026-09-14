/**
 * #1628: the per-floor table has ONE definition, and the recompute over a stored sweep refuses unless that
 * definition reproduces the stored table first.
 *
 * `floorRows` was a loop inline in `calibrate-abstention.mjs`'s `main()`. `claim-excludes-recompute.mjs`
 * recomputes the same table from a stored `abstention-sweep.json` when the corpus's `claimExcludes` change, and
 * the public claim (#1579) quotes what it prints -- so a second copy of the loop there would be a second
 * definition of "asserted wrongly" free to drift from the one the sweep prints. Both call `floorRows`, pinned
 * below by behaviour (a hand-computed fixture) and by source (exactly one copy of the loop exists).
 *
 * The fixture is hand-computed, never produced by `floorRows` itself: a table checked against its own output
 * would pass for any definition.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SCORED_CRITERIA } from "@a11ign/judge/coverage";

import { floorRows } from "../../scripts/calibrate-abstention.mjs";
import { recompute, render } from "../../scripts/claim-excludes-recompute.mjs";
import { REAL_PAGES } from "./real-page-corpus.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const ABSTENTION = resolve(REPO, "packages/lab/scripts/calibrate-abstention.mjs");
const RECOMPUTE = resolve(REPO, "packages/lab/scripts/claim-excludes-recompute.mjs");
const REFUSED = 2;

/** Cells a page contributes: every scored criterion its publisher does not exclude. Hand-derived. */
const cellsOf = (excludes: string[]) => SCORED_CRITERIA.filter((c: string) => !excludes.includes(c)).length;

const A = { url: "https://a.example/", cosine: 0.9, claim: "conformant", predicted: ["4.1.2"], cantTell: ["1.3.1", "2.4.4"], claimExcludes: ["1.1.1"] };
const B = { url: "https://b.example/", cosine: 0.7, claim: "conformant", predicted: [], cantTell: ["2.4.7"], claimExcludes: [] };
const C = { url: "https://c.example/", cosine: 0.5, claim: "inaccessible", predicted: ["1.1.1"], cantTell: [], claimExcludes: [] };
const D = { url: "https://d.example/", cosine: 0.6, claim: "conformant", predicted: ["1.1.1"], cantTell: ["3.2.1"], claimExcludes: ["1.1.1"] };
const SCORED = [A, B, C, D];
const FLOORS = [0.8, 0.65, 0];

/** The table, worked by hand from the four pages above. Key order is the one `abstention-sweep.json` stores. */
const HAND_ROWS = [
  { floor: 0.8, scored: 1, conformantScored: 1, falsePositives: 1, referred: 2,
    cells: cellsOf(A.claimExcludes), wrongCells: 1, disclosed: 0, inaccessibleScored: 0, inaccessibleCaught: 0 },
  { floor: 0.65, scored: 2, conformantScored: 2, falsePositives: 1, referred: 3,
    cells: cellsOf(A.claimExcludes) + cellsOf(B.claimExcludes), wrongCells: 1, disclosed: 0, inaccessibleScored: 0, inaccessibleCaught: 0 },
  { floor: 0, scored: 4, conformantScored: 3, falsePositives: 1, referred: 4,
    cells: cellsOf(A.claimExcludes) + cellsOf(B.claimExcludes) + cellsOf(D.claimExcludes), wrongCells: 1, disclosed: 1,
    inaccessibleScored: 1, inaccessibleCaught: 1 },
];

/** The corpus as each page's CURRENT entry, keyed by url. Unchanged unless a test overrides one. */
const corpusOf = (overrides: Record<string, string[]> = {}) => (url: string) => {
  const page = SCORED.find((p) => p.url === url);
  return page ? { url, claimExcludes: overrides[url] ?? page.claimExcludes } : undefined;
};

test("FIXTURE GUARD: the criteria the fixture relies on are scored, or the hand table measures nothing", () => {
  for (const c of ["1.1.1", "4.1.2"]) assert.ok(SCORED_CRITERIA.includes(c), `${c} must be a scored criterion`);
});

test("floorRows: stored pages in, the hand-computed table out, key order included", () => {
  const rows = floorRows(SCORED, FLOORS);
  assert.deepEqual(rows, HAND_ROWS);
  assert.equal(JSON.stringify(rows), JSON.stringify(HAND_ROWS), "the key order is what the stored rows compare on");
});

test("recompute: when the stored rows reproduce, an unchanged corpus returns the same table", () => {
  const result = recompute({ sweep: { scored: SCORED, rows: HAND_ROWS }, corpusFor: corpusOf() });
  assert.ok(!("refusal" in result), JSON.stringify(result));
  assert.deepEqual(result.rows, HAND_ROWS);
  assert.deepEqual(result.changed, []);
  assert.equal(result.population, 4);
});

test("MUTATION TARGET: stored rows that do not reproduce are REFUSED, naming the floor and the field", () => {
  const tampered = HAND_ROWS.map((r) => (r.floor === 0.65 ? { ...r, referred: r.referred + 1 } : r));
  const result = recompute({ sweep: { scored: SCORED, rows: tampered }, corpusFor: corpusOf() });
  assert.ok("refusal" in result, "a table the stored excludes cannot reproduce must not be recomputed");
  assert.match(result.refusal, /control failed/);
  assert.match(result.refusal, /floor 0\.65: stored referred=4, recomputed 3/);
});

test("recompute: a corrected claimExcludes moves the finding from asserted wrongly to disclosed, and nothing else", () => {
  const result = recompute({ sweep: { scored: SCORED, rows: HAND_ROWS },
    corpusFor: corpusOf({ [A.url]: ["1.1.1", "4.1.2"] }) });
  assert.ok(!("refusal" in result), JSON.stringify(result));
  assert.deepEqual(result.changed, [{ url: A.url, before: ["1.1.1"], after: ["1.1.1", "4.1.2"] }]);
  const top = result.rows.find((r: { floor: number }) => r.floor === 0.8);
  assert.equal(top.falsePositives, 0);
  assert.equal(top.disclosed, 1);
  assert.equal(top.wrongCells, 0);
  assert.equal(top.cells, HAND_ROWS[0].cells - (SCORED_CRITERIA.includes("4.1.2") ? 1 : 0));
  assert.equal(top.referred, HAND_ROWS[0].referred, "an exclude never removes a referral");
});

test("recompute: a scored page the corpus does not declare is refused", () => {
  const result = recompute({ sweep: { scored: SCORED, rows: HAND_ROWS },
    corpusFor: (url: string) => (url === B.url ? undefined : corpusOf()(url)) });
  assert.ok("refusal" in result);
  assert.match(result.refusal, /not in the corpus: https:\/\/b\.example\//);
});

test("recompute: the URL filter restricts the population, names listed URLs not scored, and refuses an empty match", () => {
  const result = recompute({ sweep: { scored: SCORED, rows: HAND_ROWS }, corpusFor: corpusOf(),
    urls: ["https://A.example", "https://absent.example/"] });
  assert.ok(!("refusal" in result), JSON.stringify(result));
  assert.equal(result.population, 1);
  assert.equal(result.listed, 2);
  assert.deepEqual(result.unscoredListed, ["https://absent.example/"]);
  assert.deepEqual(result.rows.map((r: { conformantScored: number }) => r.conformantScored), [1, 1, 1]);
  const none = recompute({ sweep: { scored: SCORED, rows: HAND_ROWS }, corpusFor: corpusOf(), urls: ["https://absent.example/"] });
  assert.ok("refusal" in none);
});

test("recompute: a file that is not a sweep output is refused", () => {
  assert.ok("refusal" in recompute({ sweep: { scored: SCORED }, corpusFor: corpusOf() }));
  assert.ok("refusal" in recompute({ sweep: null, corpusFor: corpusOf() }));
});

test("render: the printed text carries the run, the sha256, the corpus commit and every floor row", () => {
  const result = recompute({ sweep: { scored: SCORED, rows: HAND_ROWS }, corpusFor: corpusOf() });
  assert.ok(!("refusal" in result));
  const text = render({ run: "run-1", sha256: "ab".repeat(32), corpusCommit: "deadbeef 2026-09-14T00:00:00Z", head: "cafef00d" }, result);
  assert.match(text, /^run: run-1$/m);
  assert.match(text, new RegExp(`^sweep output: sha256 ${"ab".repeat(32)}, 4 scored pages, 3 floors$`, "m"));
  assert.match(text, /last changed on the first-parent line in deadbeef 2026-09-14T00:00:00Z; checkout HEAD cafef00d$/m);
  assert.match(text, /^control: the stored claimExcludes reproduce all 3 stored rows exactly$/m);
  assert.equal(text.split("\n").filter((l) => /^ {2}(0\.8|0\.65|0) /.test(l)).length, 3);
});

test("ONE COPY: the per-floor loop exists only in floorRows, and both callers use it", () => {
  const abstention = readFileSync(ABSTENTION, "utf8");
  const recomputeSource = readFileSync(RECOMPUTE, "utf8");
  const LOOP = /\(p\.cosine \?\? 0\) >= floor/g;
  assert.equal(abstention.match(LOOP)?.length ?? 0, 1, "calibrate-abstention holds exactly one copy of the loop");
  assert.equal(recomputeSource.match(LOOP)?.length ?? 0, 0, "the recompute must call floorRows, not copy the loop");
  assert.match(abstention, /const rows = floorRows\(scored, CANDIDATE_FLOORS\);/, "main() prints the table floorRows returns");
  assert.match(recomputeSource, /import \{ floorRows \} from "\.\/calibrate-abstention\.mjs";/);
  assert.match(recomputeSource, /floorRows\(sweep\.scored, floors\)/, "the control runs through floorRows");
});

test("CLI: over a stored sweep built from real corpus entries it prints the table; a tampered copy exits REFUSED with nothing on stdout", () => {
  const pages = REAL_PAGES.filter((p: { role?: string; publishedClaim?: string }) => p.role === "calibration" && p.publishedClaim === "conformant").slice(0, 2);
  assert.equal(pages.length, 2, "the corpus must hold two conformant calibration pages for this fixture");
  const scored = pages.map((p: { url: string; claimExcludes?: string[] }, i: number) => ({
    url: p.url, cosine: 0.9 - i / 10, claim: "conformant", predicted: [], cantTell: ["2.4.4"], claimExcludes: p.claimExcludes ?? [] }));
  const floors = [0.85, 0];
  const dir = mkdtempSync(join(tmpdir(), "claim-excludes-recompute-"));
  try {
    const good = join(dir, "sweep.json");
    writeFileSync(good, JSON.stringify({ scored, rows: floorRows(scored, floors) }));
    const ok = spawnSync(process.execPath, [RECOMPUTE, `--sweep=${good}`, "--run=fixture-run"], { cwd: REPO, encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^control: the stored claimExcludes reproduce all 2 stored rows exactly$/m);
    assert.match(ok.stdout, /^claimExcludes changed by the corpus since the run: 0$/m);
    assert.ok(!ok.stdout.includes(dir), "the printed text carries no local path");
    const bad = join(dir, "tampered.json");
    const rows = floorRows(scored, floors);
    rows[1].referred += 1;
    writeFileSync(bad, JSON.stringify({ scored, rows }));
    const refused = spawnSync(process.execPath, [RECOMPUTE, `--sweep=${bad}`, "--run=fixture-run"], { cwd: REPO, encoding: "utf8" });
    assert.equal(refused.status, REFUSED, refused.stderr);
    assert.equal(refused.stdout, "", "nothing is printed when the control fails");
    assert.match(refused.stderr, /control failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
