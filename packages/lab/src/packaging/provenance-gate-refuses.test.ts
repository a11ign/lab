/**
 * `release:provenance` must REFUSE a release whose weights no changelog entry accounts for.
 *
 * Tier 2 of the two the recipe asks for (`docs/proving-a-gate.md`). `shipped-provenance.test.ts` proves
 * the DECISION over injected inputs; this proves the COMMAND — the paths it composes, the exit code it
 * returns and the sentence it prints. They fail independently, and this repo's most expensive shape is a
 * correct decision on a path nothing reaches: `refreshBrowseBuffer` guarded on a flag nothing set,
 * `ensureSpeechChannel` fixed at one call site of two. A green predicate says nothing about the wiring.
 *
 * The first step of that recipe is to disbelieve "this gate needs a real model to test". It needs a temp
 * directory and two small JSON files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPT = join(REPO, "packages/lab/scripts/check-shipped-provenance.mjs");

/** The provenance rows `promote-model.mjs` renders, for a report with this many records. */
const entryFor = (records: number) => `---
"@a11y-witness/scorer": major
---

Retrained scorer weights (\`candidate\`).

Provenance, so a disputed finding can be traced to the model that produced it:

- records: \`${records}\`
- in-distribution floor: \`0.7\`
- derived floor: \`0.5587\`
- floor source: \`calibration-set\`
- encoder: \`abc123\`
- feature schema: \`screenreader-structured-v15\`
`;

/** A minimal tree with the three things the gate reads. */
function planted(records: number, changesets: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "a11y-prov-"));
  const model = join(root, "packages/scorer/models/screenreader-scorer");
  mkdirSync(model, { recursive: true });
  writeFileSync(join(model, "training-report.json"), JSON.stringify({
    dataset: { records },
    outOfDistribution: { inDistributionFloor: 0.7, derivedFloor: 0.5587, floorSource: "calibration-set" },
    representation: { encoder: "abc123" },
    featureSchemaVersion: "screenreader-structured-v15",
    criteria: {},
  }));
  mkdirSync(join(root, ".changeset"), { recursive: true });
  for (const [name, text] of Object.entries(changesets)) {
    writeFileSync(join(root, ".changeset", name), text);
  }
  return root;
}

/** @returns the command's exit code and its combined output. */
function runGate(root: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      encoding: "utf8", env: { ...process.env, A11Y_PROVENANCE_ROOT: root },
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

test("the COMMAND refuses weights whose provenance no entry states, and says which", () => {
  // THE LIVE DEFECT, reproduced: shipped 2487, the only pending entry describes 2403.
  const root = planted(2487, { "promote-candidate-6.md": entryFor(2403) });
  try {
    const { code, out } = runGate(root);
    assert.equal(code, 1, "a release that cannot say which model it ships must not pass");
    // WHERE the refusal came from, not merely that one happened. A non-zero exit proves nothing about
    // which check produced it -- a syntax error exits non-zero too.
    assert.match(out, /no pending changeset and no published CHANGELOG/);
    assert.match(out, /records: `2487`/, "and it must print the provenance it wanted stated");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the COMMAND refuses two byte-identical entries", () => {
  const text = entryFor(2487);
  const root = planted(2487, { "promote-candidate-4.md": text, "promote-candidate-6.md": text });
  try {
    const { code, out } = runGate(root);
    assert.equal(code, 1);
    assert.match(out, /byte-identical/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("THE CONTROL: a matching entry passes, and the gate says what it examined", () => {
  // Without this the two refusals above are satisfied by a command that refuses everything -- including
  // the gate that reported "not measured OR unstable" in one string for months.
  const root = planted(2487, { "promote-candidate-a1b2c3d4.md": entryFor(2487) });
  try {
    const { code, out } = runGate(root);
    assert.equal(code, 0, `a correct tree must pass; the gate said: ${out}`);
    assert.match(out, /PASS/);
    assert.match(out, /1 pending promotion changeset\(s\)/,
      "a pass that does not say how much it read is indistinguishable from a pass over nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a model directory with no report at all is a REFUSAL, never a quiet pass", () => {
  const root = mkdtempSync(join(tmpdir(), "a11y-prov-empty-"));
  mkdirSync(join(root, ".changeset"), { recursive: true });
  try {
    const { code, out } = runGate(root);
    assert.equal(code, 1);
    assert.match(out, /refusal, not a pass/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
