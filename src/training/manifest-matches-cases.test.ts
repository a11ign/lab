/**
 * #958: ONE MANIFEST CHECK, EVERY VERDICT READER -- `manifest-matches-cases.mjs`.
 *
 * `check-signals` passed over a manifest missing #869's five new 1.3.5 cases (`orchestrator`, #957): it
 * checked only the DELETED direction, so a case the code defines and the manifest never listed was simply
 * never examined, and the PASS was over a case set that no longer existed. Only the export checked all three
 * directions. This file pins the three, the fixture escape, and that every reader asks the one check -- over
 * the WHOLE manifest, and with no partial copy of its own left beside it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { CASES } from "./case-matrix.mjs";
import { ACCEPTANCE_CASES, ALL_ACCEPTANCE_CASES } from "./acceptance-matrix.mjs";
import { assertManifestMatchesCases, casesForKind, manifestDrift } from "./manifest-matches-cases.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(REPO, path), "utf8");

/** Three cases the code "defines", and a manifest the generator would write from them. */
const DEFINED = [
  { id: "a-case.good", family: "a", subtype: "1.1.1:missing-alt", probeFocus: false },
  { id: "b-case.good", family: "b", subtype: "2.4.2:route-title-stale", probeFocus: true },
  { id: "c-case.good", family: "c", subtype: "1.3.5:input-purpose", probeFocus: false },
];
type Defined = { id: string } & Record<string, unknown>;
const manifestOf = (cases: readonly Defined[]): { cases: Defined[] } =>
  ({ cases: cases.map((testCase) => ({ ...testCase, pages: { good: `pages/${testCase.id}/good.html` } })) });
const drift = (manifest: { cases: { id: string }[] }) => manifestDrift(manifest, DEFINED).drifted;

test("a manifest the generator would write from CASES has no drift -- `pages` is manifest-only", () => {
  assert.deepEqual(manifestDrift(manifestOf(DEFINED), DEFINED), { fixture: false, drifted: [] });
});

test("DELETED: a manifest case no longer in CASES is drift, named", () => {
  const manifest = manifestOf([...DEFINED, { id: "gone-case.good", family: "g" }]);
  assert.deepEqual(drift(manifest), ["gone-case.good: in the manifest, not in CASES"]);
});

test("CHANGED: a field that differs is drift, naming the field and both values -- key order is not", () => {
  const changed = manifestOf([{ ...DEFINED[0] }, { ...DEFINED[1], probeFocus: false }, { ...DEFINED[2] }]);
  assert.deepEqual(drift(changed), ["b-case.good.probeFocus: manifest=false CASES=true"]);
  // The same definition with its keys in another order is the same definition.
  const reordered = manifestOf(DEFINED.map((testCase) => Object.fromEntries(Object.entries(testCase).reverse()) as Defined));
  assert.deepEqual(drift(reordered), []);
});

test("ADDED: a CASES entry the manifest never lists is drift -- the direction that let #957's PASS through", () => {
  const stale = manifestOf(DEFINED.slice(0, 2));
  assert.deepEqual(drift(stale), ["c-case.good: in CASES, not in the manifest"]);
  assert.throws(() => assertManifestMatchesCases(stale, { consequence: "a test would pass over it", cases: DEFINED }),
    /so a test would pass over it\.\n {2}c-case\.good: in CASES, not in the manifest/);
});

test("THE FIXTURE ESCAPE: a manifest sharing NO id with CASES is reported, not refused", () => {
  const fixture = { cases: [{ id: "fixture-only.good" }, { id: "another-fixture.good" }] };
  assert.deepEqual(manifestDrift(fixture, DEFINED), { fixture: true, drifted: [] });
  const logged: string[] = [];
  assertManifestMatchesCases(fixture, { consequence: "n/a", cases: DEFINED, log: (line) => logged.push(line) });
  assert.deepEqual(logged, ["Manifest shares no case id with CASES (2 entries); not comparing definitions."],
    "said out loud: a guard that skips quietly is indistinguishable from one that never ran");
});

test("a drifted manifest names at most eight entries, and counts the rest", () => {
  const cases = Array.from({ length: 12 }, (_, i) => ({ id: `case-${i}.good` }));
  const manifest = { cases: [cases[0]] };
  assert.throws(() => assertManifestMatchesCases(manifest, { consequence: "x", cases }), /\.\.\. and 3 more/);
});

/** Every reader that computes a verdict on the case set, or acts on it (#958's table). */
const READERS: Record<string, string> = {
  "preflight-screenreader-dataset.mjs": "packages/lab/src/training/preflight-screenreader-dataset.mjs",
  "export-screenreader-dataset.mjs": "packages/lab/src/training/export-screenreader-dataset.mjs",
  "check-signals.mjs": "packages/lab/src/training/check-signals.mjs",
  "capture-screenreader-dataset.mjs": "packages/lab/src/training/capture-screenreader-dataset.mjs",
  "evidence-check.mjs": "packages/lab/scripts/evidence-check.mjs",
};

test("EVERY verdict reader asks the one check, over the WHOLE manifest, and keeps no partial copy", () => {
  for (const [name, path] of Object.entries(READERS)) {
    const source = read(path);
    assert.match(source, /import \{[^}]*\bassertManifestMatchesCases\b[^}]*\} from "[./a-z-]*manifest-matches-cases\.mjs"/,
      `${name} does not import the shared check`);
    // Called with the manifest itself -- never a `--only` selection of its cases, or every unselected case
    // would read as added.
    assert.match(source, /assertManifestMatchesCases\(manifest, \{/, `${name} does not pass the whole manifest`);
    // No reader keeps its own copy of any direction beside the shared one: check-signals' old deleted-only
    // check read `CASES` directly, and so would any partial copy.
    assert.doesNotMatch(source, /\bCASES\.map\(|no longer DEFINED/, `${name} still carries its own manifest check`);
  }
});

test("END TO END: check-signals REFUSES a manifest missing a defined case -- the PASS #957 got, now a refusal", () => {
  // The real reader, the real CASES, a real manifest file: every case but the first, carrying the fields
  // the check compares. On `origin/main` this reached the signal loop and passed over the missing case.
  const root = mkdtempSync(resolve(tmpdir(), "manifest-958-"));
  try {
    const [missing, ...listed] = CASES as readonly { id: string; family: unknown; subtype: unknown }[];
    const manifest = { cases: listed.map(({ id, family, subtype }: { id: string; family: unknown; subtype: unknown }) => ({ id, family, subtype })) };
    writeFileSync(resolve(root, "manifest.json"), JSON.stringify(manifest));
    const run = spawnSync(process.execPath, [resolve(REPO, "packages/lab/src/training/check-signals.mjs")], {
      encoding: "utf8", timeout: 120_000, env: { ...process.env, DATASET_ROOT: root },
    });
    assert.equal(run.status, 2, `exit ${run.status}; stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stderr, new RegExp(`${missing.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: in CASES, not in the manifest`));
    assert.match(run.stderr, /STALE BUILD, not a broken signal/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Run `body` with `DATASET_KIND` set as a reader's environment would set it, then put it back. */
function withKind<T>(kind: string | undefined, body: () => T): T {
  const before = process.env.DATASET_KIND;
  if (kind === undefined) delete process.env.DATASET_KIND; else process.env.DATASET_KIND = kind;
  try { return body(); } finally {
    if (before === undefined) delete process.env.DATASET_KIND; else process.env.DATASET_KIND = before;
  }
}

test("#978: the case set is the one the manifest's KIND was generated from -- ALL_ACCEPTANCE_CASES, never CASES", () => {
  assert.equal(casesForKind("acceptance"), ALL_ACCEPTANCE_CASES,
    "the acceptance generator writes ALL_ACCEPTANCE_CASES, multi-defect cases included");
  assert.notEqual(ALL_ACCEPTANCE_CASES.length, ACCEPTANCE_CASES.length, "the distinction this pins must exist");
  assert.equal(casesForKind(undefined), CASES);
  assert.equal(casesForKind("training"), CASES);
  // Read at CALL time from the environment the acceptance npm scripts set -- so no reader passes a set itself.
  assert.equal(withKind("acceptance", () => casesForKind()), ALL_ACCEPTANCE_CASES);
});

test("#978: an ACCEPTANCE manifest is COMPARED in all three directions, never escaped as a fixture", () => {
  const listed = ALL_ACCEPTANCE_CASES.map(({ id }: { id: string }) => ({ id }));
  withKind("acceptance", () => {
    assert.deepEqual(manifestDrift({ cases: listed }), { fixture: false, drifted: [] }, "a faithful manifest is clean");
    const [first, ...rest] = listed;
    assert.deepEqual(manifestDrift({ cases: rest }).drifted, [`${first.id}: in CASES, not in the manifest`], "ADDED");
    assert.deepEqual(manifestDrift({ cases: [...listed, { id: "acceptance-gone" }] }).drifted,
      ["acceptance-gone: in the manifest, not in CASES"], "DELETED");
    const family = (ALL_ACCEPTANCE_CASES[0] as unknown as { family: unknown }).family;
    const changed = [{ ...first, family: "not-the-family" }, ...rest];
    assert.deepEqual(manifestDrift({ cases: changed }).drifted,
      [`${first.id}.family: manifest="not-the-family" CASES=${JSON.stringify(family)}`], "CHANGED");
  });
});

test("#978 END TO END: preflight passes a freshly generated ACCEPTANCE manifest, and refuses one missing a case", () => {
  // On `origin/main` the first half FAILED: preflight expected ACCEPTANCE_CASES (72) and the generator wrote 79,
  // so `training:preflight-acceptance` refused every fresh manifest with "case count does not match".
  const root = mkdtempSync(resolve(tmpdir(), "acceptance-978-"));
  const env = { ...process.env, DATASET_KIND: "acceptance", DATASET_ROOT: root };
  const run = (script: string) => spawnSync(process.execPath, [resolve(REPO, "packages/lab/src/training", script)],
    { encoding: "utf8", timeout: 240_000, env });
  try {
    assert.equal(run("generate-screenreader-acceptance.mjs").status, 0, "the generator must write the manifest");
    const fresh = run("preflight-screenreader-dataset.mjs");
    assert.equal(fresh.status, 0, `preflight refused a fresh manifest:\n${fresh.stdout}\n${fresh.stderr}`);
    assert.match(fresh.stdout, new RegExp(`Cases: ${ALL_ACCEPTANCE_CASES.length};`));
    const path = resolve(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const dropped = manifest.cases.pop();
    writeFileSync(path, JSON.stringify(manifest));
    const stale = run("preflight-screenreader-dataset.mjs");
    assert.notEqual(stale.status, 0, "preflight passed a manifest missing a defined case");
    assert.ok(stale.stderr.includes(`${dropped.id}: in CASES, not in the manifest`), stale.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
