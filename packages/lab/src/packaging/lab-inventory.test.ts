/**
 * `lab:inventory` answers the questions that were previously answered by an SSH shell.
 *
 * Its verdicts are what a human acts on — "the corpus is split", "this export is stale", "no candidate
 * carries the pending schema" — so the pure functions behind them are worth pinning. The reporting is
 * thin; the judgements are not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  environmentSpread, splitFields, migrationVerdict, fetchedArtifacts,
} from "../../scripts/lab-inventory.mjs";

const capture = (env: Record<string, unknown>, prov: Record<string, unknown> = {}) =>
  ({ environment: env, provenance: prov });

test("a homogeneous corpus reports no split", () => {
  const spread = environmentSpread([
    capture({ browserVersion: "151.0.4129.107" }, { workerCode: "abc" }),
    capture({ browserVersion: "151.0.4129.107" }, { workerCode: "abc" }),
  ]);
  assert.deepEqual(splitFields(spread), []);
});

test("a split is reported with the COUNTS, not just the fact", () => {
  // "The corpus is split" and "split 3,168 to 42" are different facts, and only the second distinguishes
  // a finished migration from a run that died halfway. Measured on the real corpus, which held exactly
  // that shape on 2026-08-25.
  const captures = [
    ...Array.from({ length: 3168 }, () => capture({ browserVersion: "151.0.4129.101" })),
    ...Array.from({ length: 42 }, () => capture({ browserVersion: "151.0.4129.107" })),
  ];
  const [split] = splitFields(environmentSpread(captures));
  assert.equal(split.field, "browserVersion");
  assert.deepEqual(split.values, { "151.0.4129.101": 3168, "151.0.4129.107": 42 });
});

test("an ABSENT field is a value, never skipped", () => {
  // This is the single most useful thing the report can say. `environmentKey` reads an absent field as
  // "unknown", so those captures can never match a live guest — and the only symptom is cache misses
  // that read as ordinary churn. Measured: every capture in the corpus carried `browserVersion` in
  // `environment` and NONE carried it in `provenance`, which is why the whole corpus was cache-invalid.
  const spread = environmentSpread([
    capture({ browserVersion: "151.0.4129.107" }),
    capture({}),
  ]);
  assert.deepEqual(spread.browserVersion, { "151.0.4129.107": 1, "(absent)": 1 });
  assert.equal(splitFields(spread).length, 1, "absent vs present IS a split");
});

test("more populations sort first, so the worst split is read first", () => {
  const spread = environmentSpread([
    capture({ browserVersion: "a" }, { workerCode: "1" }),
    capture({ browserVersion: "a" }, { workerCode: "2" }),
    capture({ browserVersion: "b" }, { workerCode: "3" }),
  ]);
  assert.equal(splitFields(spread)[0].field, "workerCode");
  assert.equal(splitFields(spread)[0].populations, 3);
});

test("no migration file means nothing blocks a release", () => {
  assert.deepEqual(migrationVerdict(null, []), { open: false });
});

test("an open migration names which candidates could close it", () => {
  const verdict = migrationVerdict(
    { pendingSchema: "v15", shippedSchema: "v7", openedAt: "2026-08-24" },
    [
      { name: "shipped", schema: "v7" },
      { name: "model-candidate", schema: "v15" },
      { name: "model-multidefect", schema: "v9" },
    ] as never,
  );
  assert.equal(verdict.open, true);
  assert.equal(verdict.shippedSchema, "v7");
  assert.deepEqual(verdict.candidatesWithPendingSchema, ["model-candidate"]);
});

// `runs/fetched/` was invisible to this tool entirely until a fetched export (`candidate.dataset-export
// .jsonl`) and a same-day `rules-gate.log` disagreed about a census count, with nothing here even saying
// the fetched copy existed. These pin that it now does, without needing a real `runs/fetched/` on disk.

test("no runs/fetched/ directory is ordinary, not an error -- reports empty", () => {
  assert.deepEqual(fetchedArtifacts(join(tmpdir(), "no-such-dir-at-all")), []);
});

test("every file present is reported, oldest first", () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-inventory-test-"));
  try {
    const older = join(dir, "candidate.dataset-export.jsonl");
    const newer = join(dir, "rules-gate.log");
    writeFileSync(older, "x".repeat(1000));
    writeFileSync(newer, "y");
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const now = new Date();
    utimesSync(older, anHourAgo, anHourAgo);
    utimesSync(newer, now, now);
    const found = fetchedArtifacts(dir);
    assert.deepEqual(found.map((f) => f.name), ["candidate.dataset-export.jsonl", "rules-gate.log"],
      "the OLDER fetch (the one most likely to be silently stale-and-trusted) is reported first");
    assert.equal(found[0].bytes, 1000);
    assert.ok(found[0].minutesAgo >= 59, "an hour-old file must not read as fresh");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a matching schema is NECESSARY and not sufficient, and the report must not imply otherwise", () => {
  // The schema is a version STRING, so it cannot distinguish a candidate trained on the current parse
  // from one trained before an announcement-grammar change moved the features underneath the same
  // version. That is not hypothetical: six commits to announcement.ts landed after the export that
  // produced the v15 candidate on the lab, and its stamp still read v15.
  const verdict = migrationVerdict({ pendingSchema: "v15" }, [{ name: "c", schema: "v15" }] as never);
  assert.deepEqual(verdict.candidatesWithPendingSchema, ["c"]);
  assert.equal(verdict.open, true);
});
