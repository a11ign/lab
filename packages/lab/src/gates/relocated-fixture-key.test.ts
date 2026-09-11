/**
 * #881: A SCORED FIXTURE IS KEYED BY ITS DECLARED URL, NEVER BY THE ONE THE WORKER FETCHED.
 *
 * `realPageFor` now reconciles a fixture captured at the lab's LAN address with its loopback declaration,
 * so the five conformant fixtures are scored for the first time. Everything `currentFindings` records is
 * keyed per capture, and `--update` writes the findings map into the TRACKED
 * `packages/lab/baselines/real-page-findings.json`. Keyed by `capture.url`, the fix would have put the lab's
 * address into a public repository the first time the fleet operator accepted a baseline, and every
 * evidence and outcome lookup would have held a key the baseline never had.
 *
 * Driven through `REAL_CORPUS_ROOT` at a synthetic directory, never `runs/`. The address is from the RFC 5737
 * documentation range: shaped like the lab's, and not it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REAL_PAGES } from "../training/real-page-corpus.mjs";

const STAND_IN = "192.0.2.10";
const CONFORMANT_FIXTURE = REAL_PAGES.find((page) => page.role === "fixture" && page.publishedClaim === "conformant");

test("#881: a conformant fixture captured at another address is SCORED, under its DECLARED url", async () => {
  assert.ok(CONFORMANT_FIXTURE, "no conformant fixture in REAL_PAGES, so this test asserts over nothing");
  const fetched = new URL(CONFORMANT_FIXTURE.url);
  fetched.hostname = STAND_IN;
  const dir = mkdtempSync(join(tmpdir(), "relocated-fixture-"));
  try {
    writeFileSync(join(dir, "fixture.json"), JSON.stringify({
      role: "fixture",
      publishedClaim: "conformant",
      capturedAt: new Date().toISOString(),
      capture: { url: fetched.href, transcript: ["heading level 1, Fixture page"] },
    }));
    // SET BEFORE THE IMPORT: the gate resolves its corpus root once, at module load.
    process.env.REAL_CORPUS_ROOT = dir;
    const { currentFindings } = await import("../../scripts/check-real-page-findings.ts");
    const keys = Object.keys(currentFindings());

    assert.deepEqual(keys, [CONFORMANT_FIXTURE.url],
      "the relocated fixture must be scored -- before #881 it was walked past as undeclared");
    assert.ok(!keys.some((key) => key.includes(STAND_IN)),
      "a findings key carries the fetched address, and --update would write it into a tracked file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
