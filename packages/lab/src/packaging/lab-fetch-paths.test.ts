/**
 * EVERY `lab-fetch.yml` ENTRY, AGAINST THE PATH ITS PRODUCER WRITES -- #959.
 *
 * `lab-fetch.yml` is the only way an artefact leaves the lab, and every path in its map is a SECOND
 * statement of where some producer writes. Nothing compared the two. `cbea0d3b` (2026-09-05) moved
 * `calibrate-abstention.mjs`'s output to `runs/abstention/` and left `abstention-sweep` pointing at
 * `runs/real-page-corpus/`, so from then on the file PLAN.md's floor decisions rest on could not be fetched.
 * It was found only when #951's gate 3 asked for it. No test failed, because no test read the map.
 *
 * Each entry is resolved against its producer ONE of three ways, and never by writing the path again here:
 *
 *   EXPORTED  the value the producer's module exports -- `dataset-paths.mjs`, which owns `runs/`, for most;
 *             the two pipeline scripts' transcript constants for two. Compared exactly.
 *   INVOKED   the path is on the producer's command line: a `lab-job.yml` job's argv, or the npm script a
 *             job runs. Compared exactly. `train` gives only the directory; its trainer names the file.
 *   TRACKED   the artefact is committed, so its path must exist in the tree.
 *
 * An entry none of those reaches is in UNREACHED, with its producer and the reason. IT IS NAMED, NOT
 * VERIFIED: the test checks only that the producer still NAMES the file, which catches a rename and not a
 * move -- exactly the move this row was filed for. So the list is printed on every run, and shrinking it
 * means exporting a producer's path. A NEW fetch entry in neither table fails, by name.
 *
 * Parameters compare as `*`: `{{ out | default('candidate') }}` in the playbook, `${REPEAT:-repeat-1}` in
 * an npm script, and the case id or page slug a producer puts in a file name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { parse } from "yaml";
import {
  REPO_ROOT, abstentionSweepPath, captureRoot, datasetExportPath, datasetRoot, realCorpusRoot, runsRoot,
} from "../dataset-paths.mjs";
import { captureFilePath } from "../capture/evidence-diff.mjs";
import { progressPath } from "../training/capture-progress.mjs";
import { TRANSCRIPT } from "../../scripts/everything-pipeline.mjs";
import { RETRAIN_TRANSCRIPT } from "../../scripts/retrain-pipeline.mjs";

/** The env overrides `dataset-paths.mjs` reads at call time. The lab runs with none, so neither does this. */
const PATH_OVERRIDES = ["DATASET_ROOT", "DATASET_CAPTURE_ROOT", "DATASET_EXPORT", "REAL_CORPUS_ROOT"];
for (const name of PATH_OVERRIDES) delete process.env[name];

/** Stands for a file-name parameter a producer fills in (a case id, a page slug); compared as `*`. */
const PARAM = "\u0000";

const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf8");

/** The playbook's own map, parsed rather than grepped. */
function fetchMap(): Record<string, string> {
  const plays = parse(read("packages/control/ansible/lab-fetch.yml")) as { vars?: { lab_artifacts?: unknown } }[];
  const map = plays.find((play) => play.vars?.lab_artifacts)?.vars?.lab_artifacts;
  assert.ok(map && typeof map === "object", "lab-fetch.yml has no `lab_artifacts` map -- its shape changed");
  return map as Record<string, string>;
}

/** Every placeholder shape as `*`, so a playbook default and an npm default compare equal. */
function normalise(path: string): string {
  return path
    .replace(/\{\{[^}]*\}\}/g, "*")
    .replace(/\$\{[^}]*\}/g, "*")
    .replace(new RegExp(`${PARAM}(\\.${PARAM})*`, "g"), "*");
}

/** A producer's absolute path as the fetch map spells it: `runs/` for wherever `runsRoot()` resolved. */
function asFetchPath(absolute: string): string {
  const inRuns = relative(runsRoot(), absolute);
  const underRuns = !inRuns.startsWith("..") && !isAbsolute(inRuns);
  return normalise(underRuns ? `runs/${inRuns}` : relative(REPO_ROOT, absolute));
}

/** The value after `flag` in a `lab-job.yml` job's argv -- that job's own statement of where it writes. */
function argvAfter(job: string, flag: string): string {
  const plays = parse(read("packages/control/ansible/lab-job.yml")) as { vars?: { lab_jobs?: Record<string, { argv?: unknown }> } }[];
  const argv = plays.find((play) => play.vars?.lab_jobs)?.vars?.lab_jobs?.[job]?.argv;
  assert.ok(Array.isArray(argv), `lab-job.yml has no job \`${job}\` with an argv -- its producer cannot be found`);
  const at = argv.indexOf(flag);
  assert.ok(at >= 0 && typeof argv[at + 1] === "string", `job \`${job}\` has no \`${flag}\` in its argv`);
  return normalise(argv[at + 1] as string);
}

/** The value of `--flag=` in a root npm script -- the command a lab job runs. */
function npmFlag(script: string, flag: string): string {
  const text = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts[script];
  assert.ok(text, `package.json has no script \`${script}\` -- its producer cannot be found`);
  const value = text.match(new RegExp(`${flag}=(\\S+)`))?.[1];
  assert.ok(value, `script \`${script}\` passes no \`${flag}=\``);
  return normalise(value);
}

type Resolution =
  | { how: "exported" | "invoked"; path: string }
  | { how: "invoked-dir"; dir: string; namedBy: string }
  | { how: "tracked" };

const exported = (absolute: string): Resolution => ({ how: "exported", path: asFetchPath(absolute) });
const tracked = (): Resolution => ({ how: "tracked" });

/** Each entry's producer, and how its path is read from it. The paths themselves are nowhere in this table. */
const RESOLVED: Record<string, () => Resolution> = {
  "abstention-sweep": () => exported(abstentionSweepPath()),
  "dataset-export": () => exported(datasetExportPath()),
  "capture-progress": () => exported(progressPath(datasetRoot())),
  "capture": () => exported(captureFilePath(captureRoot(datasetRoot()), PARAM, PARAM)),
  // `capture-real-pages.mjs` writes `resolve(realCorpusRoot(), `${slug(url)}.json`)`; `slug` is its own.
  "real-capture": () => exported(resolve(realCorpusRoot(), `${PARAM}.json`)),
  "real-page-capture": () => exported(resolve(realCorpusRoot(), `${PARAM}.json`)),
  "everything-transcript": () => exported(TRANSCRIPT),
  "retrain-transcript": () => exported(RETRAIN_TRANSCRIPT),
  "acceptance-report": () => ({ how: "invoked", path: argvAfter("acceptance", "--out") }),
  "false-positives": () => ({ how: "invoked", path: argvAfter("false-positives", "--out") }),
  "shipped-acceptance": () => ({ how: "invoked", path: argvAfter("acceptance-shipped", "--out") }),
  "acceptance-records": () => ({ how: "invoked", path: npmFlag("training:export-acceptance", "--out") }),
  "training-report": () => ({
    how: "invoked-dir", dir: argvAfter("train", "--output"), namedBy: "packages/lab/scripts/train-screenreader-model.py",
  }),
  "real-page-baseline": tracked,
  "shortcuts-baseline": tracked,
  "promoted-weights": tracked,
  "promoted-training-report": tracked,
  "promoted-acceptance-report": tracked,
};

/** Producers found, paths not readable from here. Named on every run; each is a path worth exporting. */
const UNREACHED: Record<string, { producer: string; why: string }> = {
  "grants-audit": { producer: "packages/scorer/python/audit_grants.py", why: "built with pathlib in Python" },
  "shortcuts": { producer: "packages/lab/scripts/audit-scorer-shortcuts.py", why: "built with pathlib in Python" },
  "unclosable-vetoes": { producer: "packages/lab/scripts/emit-unclosable-vetoes.mjs", why: "a module-level `OUT` it does not export" },
  "evidence-check": { producer: "packages/lab/scripts/evidence-check.mjs", why: "a module-level `OUT` it does not export" },
  "corpus-archive": {
    producer: "packages/lab/scripts/corpus-snapshot.mjs", why: "outside `runs/`: a `--out` flag defaulting to `backups`, against cwd",
  },
  "promoted-changeset": {
    producer: "packages/lab/scripts/promote-model.mjs", why: "a name hashed from the release, unguessable by design; the fetch globs",
  },
};

test("every fetch entry is resolved against its producer or named as unreached -- a new entry fails by name", () => {
  const entries = Object.keys(fetchMap());
  const classified = new Set([...Object.keys(RESOLVED), ...Object.keys(UNREACHED)]);
  assert.deepEqual(entries.filter((entry) => !classified.has(entry)), [],
    "lab-fetch.yml has entries nobody resolved against a producer: add each to RESOLVED, or to UNREACHED with a reason");
  assert.deepEqual([...classified].filter((entry) => !entries.includes(entry)), [],
    "this test names entries lab-fetch.yml no longer has -- remove them");
  assert.deepEqual(Object.keys(RESOLVED).filter((entry) => entry in UNREACHED), [], "an entry is in both tables");
});

test("every resolved entry is exactly where its producer writes it", () => {
  const map = fetchMap();
  const wrong: string[] = [];
  for (const [entry, resolveProducer] of Object.entries(RESOLVED)) {
    const fetches = normalise(map[entry]);
    const producer = resolveProducer();
    if (producer.how === "tracked") {
      if (!existsSync(resolve(REPO_ROOT, fetches))) wrong.push(`${entry}: fetches ${fetches}, which is not in the tree`);
    } else if (producer.how === "invoked-dir") {
      if (dirname(fetches) !== producer.dir) wrong.push(`${entry}: fetches from ${dirname(fetches)}/, its job writes to ${producer.dir}/`);
      if (!read(producer.namedBy).includes(basename(fetches))) wrong.push(`${entry}: ${producer.namedBy} no longer names ${basename(fetches)}`);
    } else if (fetches !== producer.path) {
      wrong.push(`${entry}: fetches ${fetches}, its producer writes ${producer.path} (${producer.how})`);
    }
  }
  assert.deepEqual(wrong, [], `lab-fetch.yml disagrees with the producers:\n  ${wrong.join("\n  ")}`);
});

test("every unreached producer exists and still NAMES its file -- a rename is caught, a move is not", (t) => {
  const map = fetchMap();
  const lost: string[] = [];
  for (const [entry, { producer, why }] of Object.entries(UNREACHED)) {
    t.diagnostic(`NOT VERIFIED: ${entry} (${map[entry]}) -- ${producer}: ${why}`);
    if (!existsSync(resolve(REPO_ROOT, producer))) { lost.push(`${entry}: ${producer} does not exist`); continue; }
    const source = read(producer);
    const fragments = basename(normalise(map[entry])).split("*").filter(Boolean);
    const missing = fragments.filter((fragment) => !source.includes(fragment));
    if (missing.length) lost.push(`${entry}: ${producer} no longer names ${missing.join(", ")}`);
  }
  assert.deepEqual(lost, [], lost.join("\n"));
});

test("the normaliser turns every placeholder shape into `*` -- or two defaults would never compare equal", () => {
  assert.equal(normalise("runs/model-{{ out | default('candidate') }}/x.json"), "runs/model-*/x.json");
  assert.equal(normalise("runs/a/${REPEAT:-repeat-1}.jsonl"), "runs/a/*.jsonl");
  assert.equal(normalise(`runs/c/${PARAM}.${PARAM}.json`), "runs/c/*.json");
  assert.equal(normalise(`runs/r/${PARAM}.json`), "runs/r/*.json");
});
