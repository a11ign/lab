/**
 * #3273: THE STABILITY GATE KEEPS THE VARIANTS OF A FAILED CANARY, EACH IN ITS OWN DIRECTORY.
 *
 * `gate:stability` failed one of ten runs on the live canary with `VARIES transcript counts 11,11,11,11,11` and
 * nothing that said WHAT differed: the gate kept only the `VARIES` lines, and the five captures were overwritten
 * by the next canary. These drive what the script now calls to keep both.
 *
 * THIS FILE IMPORTS ONLY `stability-canary.mjs`. The gate script's import closure reaches the corpus
 * (`dataset-paths.mjs`), so importing it would make this Acceptance unrunnable in the token-less CI job. The
 * script's WIRING of those functions is therefore read from its source, and the reading is proved able to fail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { varianceLines, canaryOutDir, unstableDetail, repeatCaptureArgs } from "./stability-canary.mjs";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/stability-gate.mjs");

// Shaped like `repeat-capture`'s report (compareFields): a STABLE line, then a VARIES line with its variants.
const VARYING_REPORT = [
  "5/5 usable",
  "  STABLE    headings      3 item(s), identical every time",
  "  VARIES    transcript    counts 11,11,11,11,11 across runs",
  '      11: ["heading, level 1, Join us","link, Donate","link, Contact us","link, Visit"]',
  '      11: ["heading, level 1, Join us","link, Donate","link, Contact us","link, Plan a visit"]',
  "  VARIES    focusEvents   counts 5,5,5,5,5 across runs",
  '      5: [{"role":"link","name":"Donate"},{"role":"button","name":"Accept"}]',
  '      5: [{"role":"link","name":"Donate"},{"role":"button","name":"Accept all"}]',
  "  STABLE    formChanges   0 item(s), identical every time",
  "raw captures kept in /srv/a11y-runs/repeat-captures (diagnostics included)",
].join("\n");

const STABLE_REPORT = [
  "5/5 usable",
  "  STABLE    transcript    11 item(s), identical every time",
  "  STABLE    focusEvents   5 item(s), identical every time",
  "All compared fields are stable.",
].join("\n");

test("#3273 variants: a VARIES line is reported WITH the variant lines under it, not alone", () => {
  const lines = varianceLines(VARYING_REPORT);
  assert.equal(lines.length, 6, `two VARIES lines and two variants under each: ${JSON.stringify(lines)}`);
  assert.deepEqual(lines.filter((l) => l.includes("VARIES")).length, 2);
  assert.ok(lines.some((l) => l.includes("link, Plan a visit")), "the differing content is kept");
  assert.ok(lines.some((l) => l.includes("Accept all")), "the second field's variants are kept too");
  assert.ok(lines.every((l) => l === l.trim()), "trimmed, as the gate prints them");
});

test("#3273 variants: the detail carries the variants, so the journal says HOW a field varies", () => {
  const detail = unstableDetail({ lines: varianceLines(VARYING_REPORT), outDir: "/runs/x" });
  assert.match(detail, /VARIES\s+transcript\s+counts 11,11,11,11,11/);
  assert.match(detail, /link, Plan a visit/);
});

test("#3273 variants negative control: a STABLE report adds no variant lines", () => {
  assert.deepEqual(varianceLines(STABLE_REPORT), []);
  // An indented `n: ` line is a variant ONLY under a VARIES line. This one follows a STABLE line.
  assert.deepEqual(varianceLines("  STABLE    transcript    3 item(s)\n      3: [\"a\"]\n"), []);
});

test("#3273 variants: a variant group ends at the next line that is not a variant", () => {
  assert.deepEqual(varianceLines("  VARIES    a   counts 1,1\n      1: [\"x\"]\nnote\n      1: [\"stray\"]\n"),
    ["VARIES    a   counts 1,1", '1: ["x"]']);
});

test("#3273 directory: each canary of each run gets its OWN directory", () => {
  const where = (runId: string, name: string) => canaryOutDir({ root: "/srv/a11y-runs/repeat-captures", runId, name });
  const dirs = [
    where("run-a", "form-unlabelled/good"),
    where("run-a", "form-error-silent/good"),
    where("run-a", "https://www.nls.uk/join/"),
    where("run-b", "form-unlabelled/good"),
  ];
  assert.equal(new Set(dirs).size, dirs.length, `a later canary or a concurrent run must not share one: ${dirs}`);
  assert.ok(dirs[0].includes("run-a") && dirs[0].includes("form-unlabelled-good"), "named by run and canary");
  assert.ok(dirs[2].includes("www.nls.uk-join"), "a live URL is a usable directory name");
  assert.ok(dirs.every((d) => d.startsWith("/srv/a11y-runs/repeat-captures/")), "under the root it was given");
  assert.notEqual(dirs[0], "/srv/a11y-runs/repeat-captures", "never the shared root itself");
});

test("#3273 directory: it is passed to repeat-capture as --out, beside the flags it already forwarded", () => {
  const outDir = "/runs/stability/run-a/x";
  const args = repeatCaptureArgs({ script: "rc.mjs", url: "http://h/x", times: 5, worker: "http://w:1", outDir });
  assert.ok(args.includes(`--out=${outDir}`));
  assert.deepEqual(args.filter((a) => /^--(probe|task)/.test(a)), [], "no probe flag unless the canary asks");
  const probing = repeatCaptureArgs({ script: "rc.mjs", url: "u", times: 5, worker: "w", outDir,
    probeForms: true, task: "Do it.", probeFocus: true });
  assert.ok(probing.includes("--probe-forms") && probing.includes("--task=Do it.") && probing.includes("--probe-focus"));
});

test("#3273 directory: the directory is named in the output next to any UNSTABLE", () => {
  const detail = unstableDetail({ lines: ["VARIES    a   counts 1,1"], outDir: "/runs/stability/run-a/x" });
  assert.match(detail, /captures kept in \/runs\/stability\/run-a\/x$/);
});

/** The script must USE what is tested above: a tested helper nobody calls fixes nothing. */
function wiringFaults(source: string): string[] {
  const faults: string[] = [];
  if (!/from "\.\.\/src\/gates\/stability-canary\.mjs"/.test(source)) faults.push("does not import stability-canary.mjs");
  if (/includes\("VARIES"\)/.test(source)) faults.push("still keeps only the VARIES lines");
  if (!/canaryOutDir\(\{[^}]*runId/.test(source)) faults.push("does not give each canary of each run its own directory");
  if (!/repeatCaptureArgs\(\{[^}]*outDir/.test(source)) faults.push("does not pass the directory to repeat-capture");
  if (!/unstableDetail\(/.test(source)) faults.push("does not name the directory next to UNSTABLE");
  return faults;
}

test("#3273 wiring: stability-gate.mjs uses the tested functions, and the check can fail", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.deepEqual(wiringFaults(source), []);
  // Positive controls: break each thing the check looks for and it notices.
  assert.ok(wiringFaults(source.replace(/varianceLines\(stdout\)/, 'stdout.split("\\n").filter((l) => l.includes("VARIES"))'))
    .includes("still keeps only the VARIES lines"));
  assert.ok(wiringFaults(source.replace("repeatCaptureArgs({", "legacyArgs({"))
    .includes("does not pass the directory to repeat-capture"));
  assert.ok(wiringFaults(source.replace(/canaryOutDir\(\{/, "sharedDir({"))
    .includes("does not give each canary of each run its own directory"));
  // An empty script still "keeps only VARIES lines" in no sense -- that check is about presence of the old filter.
  assert.equal(wiringFaults("").length, 4, "an empty script fails every check that looks for the new wiring");
});
