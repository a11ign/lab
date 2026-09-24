/**
 * `scorer:explain --case=<id>` reads what the model SAW on one held-out acceptance case (#2334).
 *
 * The question it answers, from #2258: `form_change_nonempty` and `validation_error_missing` are 0 on every
 * positive of the two status heads, so did the 16 misses and 6 false alarms carry them at 0 too, or at 1?
 * `--case=` was DOCUMENTED and REFUSED, `explain-feature` reads the training export, and no job existed, so a
 * retrain was being weighed for want of a reading.
 *
 * WHAT MAKES THIS TESTABLE WITHOUT A MODEL. The reader prints label and feature values from the featurizer
 * alone (standard library) and adds head scores only when a model directory is given, so these tests run where
 * there is no encoder. What they must prove is that the values come from the RECORD: a reader that ignored it
 * would print the same block for a record whose `form_change_nonempty` is 1 and one whose is 0.
 *
 * The head scores need the encoder and are checked by hand on the lab; nothing here claims them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "./dataset-paths.mjs";
import { acceptanceDataPaths, caseIdsOf, caseReaderArgs, criterionDetail } from "../scripts/explain-scorer.mjs";

const READER = fileURLToPath(new URL("../scripts/explain-case.py", import.meta.url));
const EXPLAIN = fileURLToPath(new URL("../scripts/explain-scorer.mjs", import.meta.url));
// The featurizer is standard library, so any python3 reads a record; the venv is preferred where it exists.
const VENV_PYTHON = join(REPO_ROOT, ".venv/bin/python");
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";

const PARSED = {
  transcript: [], headings: [], tableCells: [], controls: [], postSubmitFields: [],
  formFields: [{ containers: [], leaving: [], objects: [{ name: "Email", role: "edit", states: [] }] }],
};

/** A record `read_records` accepts whole, with the form change the status heads' vetoed feature reads. */
function record(caseId: string, variant: string, after: string, subtypes = ["4.1.3:status-progress"]) {
  return {
    input: {
      inputVersion: 2,
      transcript: ["Page, document"],
      structure: { headings: [], formFields: ["Email, edit"], tableCells: [] },
      interaction: {
        controls: [], stateChanges: [], postSubmitFields: [],
        formChanges: [{ control: "Save, button", kind: "disclosure", after, baselineQuiet: true }],
      },
      evidenceUnits: [{ channel: "transcript", text: "Page, document" }],
      evidenceText: "Page, document",
      parsed: PARSED,
    },
    target: subtypes.length
      ? { label: "violation", criteria: ["4.1.3"], subtypes, unknownSubtypes: [] }
      : { label: "clean", criteria: [], subtypes: [], unknownSubtypes: [] },
    provenance: { caseId, variant, family: "acceptance-status" },
  };
}

type Read = { status: number | null; stdout: string; stderr: string };

function readCase(records: object[], caseIds: string): Read {
  const dir = mkdtempSync(join(tmpdir(), "explain-case-"));
  try {
    const data = join(dir, "repeat-1.jsonl");
    writeFileSync(data, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const run = spawnSync(PYTHON, [READER, "--data", data, "--case", caseIds], { encoding: "utf8" });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The value printed for one feature, or undefined when the line is not there. */
const valueOf = (output: string, feature: string) =>
  output.match(new RegExp(`^\\s+${feature}\\s+(\\S+)\\s*$`, "m"))?.[1];

test("the value printed for `form_change_nonempty` follows the RECORD: 1 when the form change said something, 0 when it did not", () => {
  const spoke = readCase([record("acceptance-b3-status-taxi", "bad", "Saved, 2 of 4")], "acceptance-b3-status-taxi");
  const silent = readCase([record("acceptance-b3-status-plot", "bad", "")], "acceptance-b3-status-plot");
  assert.equal(spoke.status, 0, spoke.stderr);
  assert.equal(silent.status, 0, silent.stderr);
  assert.equal(valueOf(spoke.stdout, "form_change_nonempty"), "1", spoke.stdout);
  assert.equal(valueOf(silent.stdout, "form_change_nonempty"), "0", silent.stdout);
  // The control: a reader that printed a constant, or read some other record, gives one block for both.
  assert.notEqual(spoke.stdout.replace(/taxi|plot/g, ""), silent.stdout.replace(/taxi|plot/g, ""),
    "two records whose vetoed feature differs printed the same block");
});

test("every feature the model has is printed by name, and the label and the case identity beside them", () => {
  const out = readCase([record("acceptance-b3-status-taxi", "bad", "")], "acceptance-b3-status-taxi").stdout;
  assert.match(out, /^case acceptance-b3-status-taxi\/bad {3}\(repeat-1\.jsonl\)/m);
  assert.match(out, /label: criteria 4\.1\.3; subtypes 4\.1\.3:status-progress/);
  for (const feature of ["form_change_nonempty", "validation_error_missing", "transcript_present"]) {
    assert.notEqual(valueOf(out, feature), undefined, `${feature} is not printed, so it cannot be read by name`);
  }
  // No model was given, and the output SAYS the scores were not computed rather than omitting them.
  assert.match(out, /head scores: not computed/);
});

test("a case id no record names is REFUSED BY NAME, with the ids that exist, and prints no features block", () => {
  const run = readCase([record("acceptance-b3-status-taxi", "bad", "")], "acceptance-b3-status-typo");
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no acceptance record names case 'acceptance-b3-status-typo'/);
  assert.match(run.stderr, /acceptance-b3-status-taxi/, "the refusal must say which ids the records DO hold");
  assert.equal(run.stdout, "", "a refusal printed a block anyway -- an empty block is what a typo used to look like");
});

test("one absent id among present ones refuses the whole request and names only the absent one", () => {
  const run = readCase([record("acceptance-b3-status-taxi", "bad", "")], "acceptance-b3-status-taxi,acceptance-nope");
  assert.equal(run.status, 2);
  assert.match(run.stderr, /'acceptance-nope'/);
  assert.doesNotMatch(run.stderr, /no acceptance record names case[^\n]*acceptance-b3-status-taxi'/);
  assert.equal(run.stdout, "", "a half-answer to a two-case question reads as the whole answer");
});

test("`caseId` reads every variant of the case, `caseId/variant` reads that one, and a list reads each", () => {
  const records = [record("acceptance-a", "bad", "said"), record("acceptance-a", "good", "", []),
    record("acceptance-b", "bad", "")];
  const blocks = (ids: string) => readCase(records, ids).stdout.match(/^case \S+/gm);
  assert.deepEqual(blocks("acceptance-a"), ["case acceptance-a/bad", "case acceptance-a/good"]);
  assert.deepEqual(blocks("acceptance-a/good"), ["case acceptance-a/good"]);
  assert.deepEqual(blocks("acceptance-a/bad,acceptance-b"), ["case acceptance-a/bad", "case acceptance-b/bad"]);
});

test("a case captured in two repeat files prints once per file, so the repeats stay separate observations", () => {
  const dir = mkdtempSync(join(tmpdir(), "explain-case-repeats-"));
  try {
    const files = ["repeat-1.jsonl", "repeat-2.jsonl"].map((name, index) => {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify(record("acceptance-a", "bad", index ? "said" : "")) + "\n");
      return path;
    });
    const run = spawnSync(PYTHON, [READER, ...files.flatMap((f) => ["--data", f]), "--case", "acceptance-a"],
      { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const values = [...run.stdout.matchAll(/^\s+form_change_nonempty\s+(\S+)$/gm)].map((m) => m[1]);
    assert.deepEqual(values, ["0", "1"], "the two repeats disagree, and collapsing them would hide it");
    assert.match(run.stdout, /\(repeat-1\.jsonl\)[\s\S]*\(repeat-2\.jsonl\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the JavaScript half: the flag, the listing, and the argv the reader gets ---------------------------------

test("`--case=` is admitted by refuseUnknownFlags, and an unknown flag still is not", () => {
  // A model name no corpus holds, so the run stops at "no acceptance report" wherever it is run.
  const admitted = spawnSync(process.execPath, [EXPLAIN, "--model=no-such-model-2334", "--case=x"], { encoding: "utf8" });
  assert.doesNotMatch(admitted.stderr, /unknown flag|not a flag/i, admitted.stderr);
  assert.match(admitted.stderr, /no acceptance report for 'no-such-model-2334'/,
    "past the flag check it must go and look for the model's acceptance report");
  const refused = spawnSync(process.execPath, [EXPLAIN, "--model=m", "--bogus=1"], { encoding: "utf8" });
  assert.notEqual(refused.status, 0, "an unrecognised flag ran the default and reported success");
});

test("`--case` with no value is refused rather than falling through to the whole-report listing", () => {
  for (const argv of [["--model=m", "--case"], ["--model=m", "--case="]]) {
    const run = spawnSync(process.execPath, [EXPLAIN, ...argv], { encoding: "utf8" });
    assert.equal(run.status, 2, `${argv.join(" ")}: ${run.stderr}`);
    assert.match(run.stderr, /--case needs one or more case ids/);
  }
});

const failing = (extra: Record<string, unknown>) => ({
  criteria: {
    "4.1.3": {
      modelEvaluated: true, decisionOwner: "learned-screenreader-scorer", records: 100, positive: 30, clean: 70,
      truePositive: 10, falsePositive: 6, falseNegative: 16, subtypeThresholds: { "4.1.3:status-progress": 0.9 }, ...extra,
    },
  },
});

test("the `--criterion` listing names EVERY case it would print, including the ones the twelve-name cap cut", () => {
  const misses = Array.from({ length: 16 }, (_, i) => `acceptance-miss-${String(i).padStart(2, "0")}`);
  const alarms = Array.from({ length: 6 }, (_, i) => `acceptance-alarm-${i}`);
  const report = failing({
    // The evaluator's own shape: the named lists are cut at twelve, the score maps are not.
    falseNegativeCases: misses.slice(0, 12).map((id) => `${id}/bad`), falseNegativeCasesTruncated: 4,
    falsePositiveCases: alarms.map((id) => `${id}/good`),
    falseNegativeSubtypeScores: Object.fromEntries(misses.map((id) => [`${id}/bad`, { "4.1.3:status-progress": 0.1 }])),
    falsePositiveSubtypeScores: Object.fromEntries(alarms.map((id) => [`${id}/good`, { "4.1.3:status-progress": 0.95 }])),
  });
  const ids = caseIdsOf(report.criteria["4.1.3"]);
  assert.deepEqual(ids, [...alarms, ...misses].sort(), "16 misses and 6 false alarms are 22 cases, cut or not");
  const detail = criterionDetail(report, "4.1.3").join("\n");
  assert.ok(detail.includes(`--case=${ids.join(",")}`), "the listing does not print the pasteable list");
  assert.match(detail, /-e job=explain-case/);
  assert.doesNotMatch(detail, /--case=[^\n]*\//, "a variant in the list cannot be passed to the job, whose shape has no `/`");
});

test("a criterion with nothing wrong prints no hint, and a report from before the score maps existed still lists its names", () => {
  assert.doesNotMatch(criterionDetail(failing({ falsePositive: 0, falseNegative: 0 }), "4.1.3").join("\n"), /--case=/);
  const old = failing({ falseNegativeCases: ["acceptance-old/bad"], falsePositiveCases: [] });
  assert.deepEqual(caseIdsOf(old.criteria["4.1.3"]), ["acceptance-old"]);
});

test("the reader is given the records THE REPORT names, in order, and refuses a report that names none", () => {
  const repeat = (name: string) => ["runs", "screenreader-acceptance", name].join("/");
  const report = { data: [{ path: repeat("repeat-1.jsonl") }, { path: repeat("repeat-2.jsonl") }] };
  const args = caseReaderArgs({ report, modelDir: "/m/model-candidate", cases: "a,b", criterion: "4.1.3" });
  assert.equal(args[0], join(REPO_ROOT, "packages/lab/scripts/explain-case.py"));
  assert.deepEqual(args.slice(1), [
    "--data", join(REPO_ROOT, repeat("repeat-1.jsonl")),
    "--data", join(REPO_ROOT, repeat("repeat-2.jsonl")),
    "--case", "a,b", "--model", "/m/model-candidate", "--criterion", "4.1.3"]);
  assert.ok(!caseReaderArgs({ report, modelDir: "/m", cases: "a" }).includes("--criterion"));
  assert.throws(() => acceptanceDataPaths({ data: [] }), /records no --data files/);
});
