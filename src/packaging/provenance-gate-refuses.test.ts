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
const provenanceBody = (records: number) => `Retrained scorer weights (\`candidate\`).

Provenance, so a disputed finding can be traced to the model that produced it:

- records: \`${records}\`
- in-distribution floor: \`0.7\`
- derived floor: \`0.5587\`
- floor source: \`calibration-set\`
- encoder: \`abc123\`
- feature schema: \`screenreader-structured-v15\`
`;

/** A PENDING promotion changeset: the rows above, under changeset front-matter. */
const entryFor = (records: number) => `---
"@a11ign/scorer": major
---

${provenanceBody(records)}`;

/**
 * A PUBLISHED CHANGELOG carrying the same rows -- what `changeset version` leaves behind once a release
 * has actually landed. Built from `provenanceBody` rather than spelled a second time, for the reason
 * `shipped-provenance.mjs` names: a copy of the format drifts the first time a row is added.
 */
const changelogFor = (records: number) => `# @a11ign/scorer

## 0.1.0

### Major Changes

- a1b2c3d4: ${provenanceBody(records)}`;

/**
 * A minimal tree with the three things the gate reads.
 *
 * `changelog` is the third: absent by default, because that is this repository's own state and the state
 * every test here was written in. Passing one exercises the OTHER branch of the same code path, which is
 * what #2162 turns on -- a test that pins only the absent case passes with the summary line deleted.
 */
function planted(records: number, changesets: Record<string, string>, changelog?: string): string {
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
  if (changelog !== undefined) writeFileSync(join(root, "packages/scorer/CHANGELOG.md"), changelog);
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

test("ABSENT: the summary says only what `existsSync` can support, and the PASS names no CHANGELOG", () => {
  // #2162. Two defects in one output, and this repository's own vocabulary names both.
  //
  // `absent (never published)` joined a measured fact to an unmeasured conclusion with a bracket, leaving
  // a reader no way to tell which half was checked. `existsSync` answers whether THIS CHECKOUT holds the
  // file; a publish that did not commit its CHANGELOG back leaves exactly this state, and #1824 records
  // that happening here on 2026-09-19. Only the registry can answer the publication question, and this
  // gate runs where `npm view` cannot authenticate -- by design, so the answer is to claim less.
  //
  // And `renderVerdict` appends the word `examined` to `source`, so naming "the CHANGELOG" there printed
  // `PASS ... and the CHANGELOG examined and clean` over a `changelog` of `null` -- which the summary
  // line's own comment, six lines above the string, defines as a check reporting success having examined
  // nothing.
  const root = planted(2487, { "promote-candidate-a1b2c3d4.md": entryFor(2487) });
  try {
    const { code, out } = runGate(root);
    assert.equal(code, 0, `a correct tree with no CHANGELOG must still pass; the gate said: ${out}`);
    assert.match(out, /CHANGELOG absent, so nothing to examine/,
      "the state is `absent`, and what that state means for what was read");
    assert.doesNotMatch(out, /never published/,
      "absent is measured; what it implies about the registry is not, and this gate cannot ask");
    assert.match(
      out,
      /PASS — all 1 of 1 from the shipped weights and 1 pending changeset\(s\) \(no CHANGELOG to read\) examined and clean/,
      "every name in `source` must correspond to something this run read",
    );
    assert.doesNotMatch(out, /and the CHANGELOG examined/,
      "a `null` is not a CHANGELOG examined");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PRESENT: the same code path reads the CHANGELOG, says so, and names it in what was examined", () => {
  // THE POSITIVE CONTROL for the test above, and the row's own requirement: assert the output BOTH ways
  // from one code path, or a pass over the absent branch is satisfied by a summary line that was deleted.
  //
  // NO pending changeset at all, deliberately. The CHANGELOG is then the ONLY thing that can state the
  // shipped provenance (`shipped-provenance.mjs` accepts either), so exit 0 proves the file was READ --
  // not merely that `existsSync` returned true and the word changed.
  const root = planted(2487, {}, changelogFor(2487));
  try {
    const { code, out } = runGate(root);
    assert.equal(code, 0, `a published CHANGELOG stating the provenance must pass; the gate said: ${out}`);
    assert.match(out, /0 pending promotion changeset\(s\); CHANGELOG present/);
    assert.match(
      out,
      /PASS — all 1 of 1 from the shipped weights, 0 pending changeset\(s\) and the CHANGELOG examined and clean/,
      "when the file IS there and IS read, the verdict must say so",
    );
    assert.doesNotMatch(out, /no CHANGELOG to read/);
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

test("TWO simultaneous problems on the one artefact examined still report as one FAIL, correctly counted", () => {
  // `gateVerdict`'s own header names this gate as the reason `failures` is not read as a subset of
  // `examined`: it reads ONE artefact and can find several things wrong with it. Two byte-identical entries
  // that ALSO fail to state the shipped provenance produce a duplicate problem AND a not-stated problem --
  // `failures` (2) exceeding `of` (1), which must render as "2 problem(s) across 1 of 1", never
  // "2 of 1 examined failed".
  const text = entryFor(2403); // wrong records count: does not match the shipped 2487
  const root = planted(2487, { "promote-candidate-4.md": text, "promote-candidate-6.md": text });
  try {
    const { code, out } = runGate(root);
    assert.equal(code, 1);
    assert.match(out, /byte-identical/);
    assert.match(out, /no pending changeset and no published CHANGELOG/);
    assert.match(out, /FAIL — 2 problem\(s\) across 1 of 1/,
      "two problems about one artefact must not render as though 2 of 1 examined failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("INCONCLUSIVE is unreachable from this gate, by construction", () => {
  // This gate's population is one artefact and one question -- there is no partial-examination state, so
  // `examined` (always 1) can never fall short of `of` (always 1) the way `verdict.mjs`'s INCONCLUSIVE
  // requires. Proven by exhausting every problem-count this gate's wiring can actually produce -- zero,
  // one (two different causes), two (combined), and three (three mutually-identical wrong entries, the
  // largest failure count this gate's logic can construct) -- and confirming none of them reaches exit 2
  // or prints INCONCLUSIVE. A mutation that decoupled `of` from `examined` (see check below) is exactly
  // what this test exists to catch.
  const scenarios = [
    { label: "0 problems (correct entry)", root: planted(2487, { "promote-candidate-a1b2c3d4.md": entryFor(2487) }) },
    { label: "1 problem (wrong provenance)", root: planted(2487, { "promote-candidate-6.md": entryFor(2403) }) },
    {
      label: "1 problem (duplicate of a CORRECT entry)",
      root: planted(2487, {
        "promote-candidate-4.md": entryFor(2487),
        "promote-candidate-6.md": entryFor(2487),
      }),
    },
    {
      label: "2 problems (duplicate + wrong provenance)",
      root: planted(2487, {
        "promote-candidate-4.md": entryFor(2403),
        "promote-candidate-6.md": entryFor(2403),
      }),
    },
    {
      label: "3 problems (two duplicates of a third, all wrong)",
      root: planted(2487, {
        "promote-candidate-4.md": entryFor(2403),
        "promote-candidate-6.md": entryFor(2403),
        "promote-candidate-8.md": entryFor(2403),
      }),
    },
    { label: "no training report at all", root: (() => {
      const r = mkdtempSync(join(tmpdir(), "a11y-prov-empty2-"));
      mkdirSync(join(r, ".changeset"), { recursive: true });
      return r;
    })() },
  ];
  try {
    for (const { label, root } of scenarios) {
      const { code, out } = runGate(root);
      assert.ok(code === 0 || code === 1, `${label}: exit code was ${code}, expected 0 or 1 -- never 2`);
      assert.doesNotMatch(out, /INCONCLUSIVE/, `${label}: printed INCONCLUSIVE, which this gate must never reach`);
    }
  } finally {
    for (const { root } of scenarios) rmSync(root, { recursive: true, force: true });
  }
});
