/**
 * `gate:nvda-release` must REFUSE a release whose NVDA reading of the held-out acceptance set regressed
 * against the shipped reading stored in `packages/lab/baselines/nvda-acceptance-shipped/` -- `ceo`'s #928
 * ruling point 1. Tier 2 of `docs/proving-a-gate.md`'s recipe: `nvda-release-regression.test.ts` proves
 * the decision over injected inputs; this proves the COMMAND -- the paths it composes, the exit code it
 * returns, the sentence it prints.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureFilePath } from "../capture/evidence-diff.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPT = join(REPO, "packages/lab/scripts/nvda-release-gate.mjs");

/** A minimal usable NVDA capture -- the same shape `evidence-diff.test.ts` builds. */
function capture(over: Record<string, unknown> = {}) {
  return {
    screenReader: "NVDA",
    transcript: ["heading, level 1, Museum 004 controls", "Print this report"],
    structure: {
      headings: ["Museum 004 controls, heading, level 1"], landmarks: [], formFields: [],
      tableCells: [], links: [], lists: [], graphics: [],
    },
    interaction: { controls: [], stateChanges: [], formChanges: [], postSubmitFields: [], focusOrder: [] },
    ...over,
  };
}

/**
 * A planted tree: a candidate root carrying a manifest and (optionally) captures, and a shipped root
 * carrying (optionally) captures for the same case ids. `realpathSync` on the tmp root, per
 * `docs/proving-a-gate.md`'s own §3a: a script anchoring on `import.meta.url`/`process.argv[1]` can
 * silently no-op under an unresolved symlinked tmpdir.
 */
function planted({ ids, candidateCaptures = {}, shippedCaptures = {} }: {
  ids: string[];
  candidateCaptures?: Record<string, { good?: unknown; bad?: unknown }>;
  shippedCaptures?: Record<string, { good?: unknown; bad?: unknown }>;
}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "a11y-nvda-release-gate-")));
  const candidateRoot = join(root, "candidate");
  const shippedRoot = join(root, "shipped");
  mkdirSync(join(candidateRoot, "captures"), { recursive: true });
  mkdirSync(join(shippedRoot, "captures"), { recursive: true });
  writeFileSync(join(candidateRoot, "manifest.json"),
    JSON.stringify({ cases: ids.map((id) => ({ id })) }));
  for (const [id, variants] of Object.entries(candidateCaptures)) {
    for (const [variant, cap] of Object.entries(variants)) {
      writeFileSync(captureFilePath(join(candidateRoot, "captures"), id, variant), JSON.stringify(cap));
    }
  }
  for (const [id, variants] of Object.entries(shippedCaptures)) {
    for (const [variant, cap] of Object.entries(variants)) {
      writeFileSync(captureFilePath(join(shippedRoot, "captures"), id, variant), JSON.stringify(cap));
    }
  }
  return { root, candidateRoot, shippedRoot };
}

/** @returns the command's exit code and its combined output. */
function runGate(candidateRoot: string, shippedRoot: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, A11Y_NVDA_RELEASE_CANDIDATE_ROOT: candidateRoot, A11Y_NVDA_RELEASE_SHIPPED_ROOT: shippedRoot },
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

test("no candidate manifest at all REFUSES rather than crashing, naming what to run first", () => {
  const { root, candidateRoot, shippedRoot } = planted({ ids: [] });
  rmSync(join(candidateRoot, "manifest.json"));
  try {
    const { code, out } = runGate(candidateRoot, shippedRoot);
    assert.equal(code, 1);
    assert.match(out, /no held-out acceptance manifest/);
    assert.match(out, /training:generate-acceptance/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an empty shipped baseline PASSES -- the first release must be possible", () => {
  const { root, candidateRoot, shippedRoot } = planted({
    ids: ["acceptance-museum-controls"],
    candidateCaptures: { "acceptance-museum-controls": { good: capture(), bad: capture() } },
  });
  try {
    const { code, out } = runGate(candidateRoot, shippedRoot);
    assert.equal(code, 0, `an empty baseline must not block; the gate said: ${out}`);
    assert.match(out, /PASS/);
    assert.match(out, /no shipped reading stored yet/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a candidate that never captured a case REFUSES, naming which case", () => {
  const { root, candidateRoot, shippedRoot } = planted({
    ids: ["acceptance-museum-controls"],
    shippedCaptures: { "acceptance-museum-controls": { good: capture(), bad: capture() } },
    // no candidateCaptures for it at all
  });
  try {
    const { code, out } = runGate(candidateRoot, shippedRoot);
    assert.equal(code, 1);
    assert.match(out, /acceptance-museum-controls\.good: not captured/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("evidence CHANGED against the shipped reading REFUSES, naming the field", () => {
  const strippedCandidate = capture({ structure: { ...capture().structure, headings: [] } });
  const { root, candidateRoot, shippedRoot } = planted({
    ids: ["acceptance-museum-controls"],
    shippedCaptures: { "acceptance-museum-controls": { good: capture(), bad: capture() } },
    candidateCaptures: { "acceptance-museum-controls": { good: strippedCandidate, bad: capture() } },
  });
  try {
    const { code, out } = runGate(candidateRoot, shippedRoot);
    assert.equal(code, 1, `a lost heading must block a release; the gate said: ${out}`);
    assert.match(out, /evidence CHANGED/);
    assert.match(out, /structure\.headings/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an identical shipped and candidate reading PASSES clean", () => {
  const { root, candidateRoot, shippedRoot } = planted({
    ids: ["acceptance-museum-controls"],
    shippedCaptures: { "acceptance-museum-controls": { good: capture(), bad: capture() } },
    candidateCaptures: { "acceptance-museum-controls": { good: capture(), bad: capture() } },
  });
  try {
    const { code, out } = runGate(candidateRoot, shippedRoot);
    assert.equal(code, 0, `an identical reading must pass; the gate said: ${out}`);
    assert.match(out, /PASS/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("transcript DRIFT only PASSES, and is named in a note rather than silently dropped", () => {
  const driftedCandidate = capture({ transcript: ["heading, level 1, Museum 004 controls"] });
  const { root, candidateRoot, shippedRoot } = planted({
    ids: ["acceptance-museum-controls"],
    shippedCaptures: { "acceptance-museum-controls": { good: capture(), bad: capture() } },
    candidateCaptures: { "acceptance-museum-controls": { good: driftedCandidate, bad: capture() } },
  });
  try {
    const { code, out } = runGate(candidateRoot, shippedRoot);
    assert.equal(code, 0, `drift alone must not block; the gate said: ${out}`);
    assert.match(out, /DRIFT only/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
