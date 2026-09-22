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
// #968: importing a PRODUCER runs nothing -- both guard `main()` on `import.meta.url`, and their
// `refuseUnknownFlags` calls take the same guard as `entry`. Driven rather than assumed: imported under a
// bare argv and under an argv carrying flags neither script declares, both load clean with exitCode 0.
import { OUT as UNCLOSABLE_VETOES } from "../../scripts/emit-unclosable-vetoes.mjs";
import { REPORT as EVIDENCE_CHECK_REPORT } from "../../scripts/evidence-check.mjs";

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
  // #968: both were UNREACHED for one reason -- "a module-level `OUT` it does not export" -- which is the
  // cheapest kind of unverified there is. `evidence-check`'s `OUT` is a DIRECTORY, so it exports `REPORT`
  // beside it; naming `"report.json"` here instead would put the filename in two places, which is the
  // drift #959 exists to stop rather than a tidier spelling of it.
  "unclosable-vetoes": () => exported(UNCLOSABLE_VETOES),
  "evidence-check": () => exported(EVIDENCE_CHECK_REPORT),
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

/**
 * Producers found, paths not readable from here. Named on every run; each is a path worth exporting.
 *
 * #968: WAS SIX, IS FOUR. `unclosable-vetoes` and `evidence-check` moved into `RESOLVED` -- both were
 * unverified only because a module-level `OUT` was not exported, which is one word each and the cheapest
 * kind of unverified there is. The four that remain are two Python producers (paths built with `pathlib`),
 * one that writes OUTSIDE `runs/` against cwd, and one whose name is hashed from the release by design.
 */
const UNREACHED: Record<string, { producer: string; why: string }> = {
  "grants-audit": { producer: "packages/scorer/python/audit_grants.py", why: "built with pathlib in Python" },
  "shortcuts": { producer: "packages/lab/scripts/audit-scorer-shortcuts.py", why: "built with pathlib in Python" },
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

test("#968: the UNVERIFIED COUNT is pinned, because nothing else counts it -- the diagnostics NAME each "
  + "one and a silent seventh would read exactly like the six before it", () => {
  // The direction matters and only one of the two is a defect. Falling is a producer that started
  // exporting its path, which is this row; RISING is an entry that stopped being verifiable, and it would
  // otherwise arrive as one more `NOT VERIFIED:` line among several -- the shape where a number moves and
  // the only reader is a human scanning diagnostics.
  assert.equal(Object.keys(UNREACHED).length, 4,
    `expected four unreached producers, found ${Object.keys(UNREACHED).length}: `
    + `${Object.keys(UNREACHED).join(", ")}. If this ROSE, an entry stopped being verifiable and the `
    + "reason belongs in UNREACHED beside the others. If it FELL, a producer started exporting its path "
    + "-- lower the number here, and say which in the commit.");
  // AND WHY EACH ONE IS STILL THERE, so lowering the number cannot be done by deleting an entry: the four
  // remaining reasons are structural, not "nobody got round to it".
  assert.deepEqual(Object.keys(UNREACHED).sort(),
    ["corpus-archive", "grants-audit", "promoted-changeset", "shortcuts"],
    "these four are Python `pathlib`, Python `pathlib`, a path outside `runs/` against cwd, and a name "
    + "hashed from the release -- none of them is an unexported constant, which is what #968 removed");
});

test("the normaliser turns every placeholder shape into `*` -- or two defaults would never compare equal", () => {
  assert.equal(normalise("runs/model-{{ out | default('candidate') }}/x.json"), "runs/model-*/x.json");
  assert.equal(normalise("runs/a/${REPEAT:-repeat-1}.jsonl"), "runs/a/*.jsonl");
  assert.equal(normalise(`runs/c/${PARAM}.${PARAM}.json`), "runs/c/*.json");
  assert.equal(normalise(`runs/r/${PARAM}.json`), "runs/r/*.json");
});

/**
 * AND THE DESTINATION DIRECTORY MUST EXIST BEFORE ANYTHING TOUCHES IT -- #1979.
 *
 * `runs/` is gitignored, so `runs/fetched/` is present in the primary checkout and in every worktree that
 * has fetched once, and absent in exactly the case a new session is in. The stale-sibling task runs `find`
 * over that directory and `find` exits 1 when it is not there, so the FIRST fetch in a checkout failed
 * AFTER the slurp had already succeeded: the artefact was read off the lab and then thrown away. Measured
 * 2026-09-22 in a fresh worktree; `copy` to a dest whose parent is absent is the next failure in line, so
 * guarding the `find` alone would only move the error.
 *
 * This is a PARSE of the checked-in playbook, so it needs no lab and no ansible. It reads the task list of
 * the fetch play and asks three things of it, each with its own refusal and its own control below:
 * the directory is created at all; it is created before the first task that names the destination; and it
 * is created on `localhost`, because this play's hosts are the LAB and the destination is under this
 * checkout.
 */
const DEST = "lab_fetch_dest";

type Task = Record<string, unknown>;

/** Ansible's own task keywords; whatever key is left is the module, and its value the module's arguments. */
const TASK_KEYWORDS = new Set([
  "name", "when", "register", "delegate_to", "changed_when", "failed_when", "loop", "with_items",
  "vars", "become", "tags", "notify", "ignore_errors", "no_log", "run_once",
]);

/** The fetch play's tasks -- the same play `fetchMap()` reads, parsed rather than grepped. */
function fetchPlayTasks(): Task[] {
  const plays = parse(read("packages/control/ansible/lab-fetch.yml")) as { vars?: { lab_artifacts?: unknown }; tasks?: unknown }[];
  const tasks = plays.find((play) => play.vars?.lab_artifacts)?.tasks;
  assert.ok(Array.isArray(tasks) && tasks.length > 0, "the fetch play has no tasks -- lab-fetch.yml's shape changed");
  return tasks as Task[];
}

/** A task's module name and arguments, with the keywords Ansible owns stripped off. */
function moduleOf(task: Task): { module: string; args: unknown } {
  const module = Object.keys(task).find((key) => !TASK_KEYWORDS.has(key));
  assert.ok(module, `task \`${String(task.name)}\` has no module key`);
  return { module, args: task[module] };
}

/** The set_fact that computes the destination path: everything after it may name it, nothing before it can. */
function definesDest(task: Task): boolean {
  const { module, args } = moduleOf(task);
  return module.endsWith("set_fact") && !!args && typeof args === "object" && DEST in (args as object);
}

/** A task whose module ARGUMENTS name the destination -- so a read or a write at that path. */
const namesDest = (task: Task): boolean => JSON.stringify(moduleOf(task).args ?? null).includes(DEST);

/** A task that makes the destination's parent directory. */
function createsDestDir(task: Task): boolean {
  const { module, args } = moduleOf(task);
  if (!module.endsWith("file") || !args || typeof args !== "object") return false;
  const { state, path } = args as { state?: unknown; path?: unknown };
  return state === "directory" && typeof path === "string" && path.includes(DEST);
}

/**
 * What is wrong with this task list, in the playbook's own terms. Empty is the passing answer, and the
 * shipped playbook below is the control that says the population is not empty by construction.
 */
function creationOffenders(tasks: Task[]): string[] {
  const definedAt = tasks.findIndex(definesDest);
  assert.ok(definedAt >= 0, `no task defines \`${DEST}\` -- the playbook's shape changed, not its directory handling`);
  const after = tasks.slice(definedAt + 1);
  const creates = after.findIndex(createsDestDir);
  const firstUse = after.findIndex(namesDest);
  if (creates < 0) {
    return [`nothing creates \`${DEST} | dirname\`: add an \`ansible.builtin.file\` task with `
      + `\`state: directory\` before \`${String(after[firstUse]?.name)}\`, which is the first task to name `
      + "the destination and fails on a checkout that has never fetched"];
  }
  const offenders: string[] = [];
  if (creates !== firstUse) {
    offenders.push(`the directory is created by \`${String(after[creates].name)}\`, but `
      + `\`${String(after[firstUse].name)}\` names the destination first -- it runs against a directory `
      + "that does not exist yet");
  }
  if (after[creates].delegate_to !== "localhost") {
    offenders.push(`\`${String(after[creates].name)}\` has no \`delegate_to: localhost\`, so it would `
      + "create the directory on the LAB; this play's hosts are `a11y_lab` and the destination is under "
      + "this checkout");
  }
  return offenders;
}

/** A deep copy of the shipped task list, so a control mutates a fixture and never the parsed playbook. */
const shippedTasks = (): Task[] => structuredClone(fetchPlayTasks());

test("#1979: the shipped playbook creates runs/fetched/ before anything reads or writes inside it", () => {
  assert.deepEqual(creationOffenders(fetchPlayTasks()), [],
    "lab-fetch.yml's first fetch in a fresh checkout would fail; see the offenders above");
});

test("#1979 positive control: the playbook with its directory task REMOVED is refused, by name", () => {
  const withoutIt = shippedTasks().filter((task) => !createsDestDir(task));
  assert.equal(withoutIt.length, fetchPlayTasks().length - 1, "the control removed no task -- it is not a control");
  const offenders = creationOffenders(withoutIt);
  assert.equal(offenders.length, 1, `expected one refusal, got: ${offenders.join(" | ")}`);
  assert.match(offenders[0], /nothing creates/);
  // AND IT NAMES THE TASK THAT WOULD HAVE FAILED, because "add a directory task" with no `find` in it
  // reads as tidiness rather than the outage it prevents.
  assert.match(offenders[0], /stale copy/i);
});

test("#1979 positive control: creating the directory AFTER the task that uses it is refused", () => {
  const tasks = shippedTasks();
  const creating = tasks.splice(tasks.findIndex(createsDestDir), 1)[0];
  const definedAt = tasks.findIndex(definesDest);
  const firstUse = definedAt + 1 + tasks.slice(definedAt + 1).findIndex(namesDest);
  tasks.splice(firstUse + 1, 0, creating);
  const offenders = creationOffenders(tasks);
  assert.equal(offenders.length, 1, `expected one refusal, got: ${offenders.join(" | ")}`);
  assert.match(offenders[0], /names the destination first/);
});

test("#1979 positive control: creating the directory on the LAB rather than locally is refused", () => {
  const tasks = shippedTasks();
  delete tasks[tasks.findIndex(createsDestDir)].delegate_to;
  const offenders = creationOffenders(tasks);
  assert.equal(offenders.length, 1, `expected one refusal, got: ${offenders.join(" | ")}`);
  assert.match(offenders[0], /delegate_to: localhost/);
});
