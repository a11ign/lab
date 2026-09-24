/**
 * The acceptance evaluator's refusal names the jobs that clear it, and each of them must write the corpus
 * the refusal is ABOUT (#2168).
 *
 * Measured on the lab 2026-09-23: `job=acceptance` refused records in `runs/screenreader-acceptance/` and
 * told the operator to run `job=generate` then `job=capture`, which write `runs/screenreader-dataset` —
 * the TRAINING corpus, hours of fleet time across ten boxes, after which the refusal is byte-identical.
 * The right spelling was already one file over (`export-screenreader-dataset.mjs` names
 * `generate-acceptance`), so this was a wrong constant, not an open question.
 *
 * THIS DOES NOT PIN THE CORRECTED STRING. It reads the job names OUT of the message, and the corpus each
 * job writes OUT of the catalogue, and compares the two — so it passes on the day a fourth acceptance job
 * is added only if the message keeps up, and says something the day a job is renamed or re-pointed.
 * The corpus the evaluator reads comes from the catalogue's own `acceptance` job (`--data runs/<dir>/…`),
 * so there is no second copy of "which corpus" here to drift.
 *
 * HOW A JOB'S CORPUS IS DERIVED: `argv` is an `npm run <script>`; the script chain is followed through
 * `npm run` segments; the corpus is `DATASET_ROOT=runs/<dir>` where a script sets it, else the
 * `datasetRoot("<dir>")` literal in the `.mjs`/`.ts` the script runs, else `datasetRoot()`'s own default.
 * A job whose corpus cannot be determined is REFUSED rather than assumed fine: *could not determine* and
 * *confirmed right* never share a value.
 *
 * POSITIVE CONTROL: `FILED_MESSAGE` is the remedy as it stood at filing, and the tests below show
 * `disagreements()` refusing it, naming `generate` and `capture`. A checker that has only ever been
 * shown passing is the defect this repo files rows about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { stripComments } from "@a11ign/evidence/source-text";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const EVALUATOR = "packages/lab/scripts/evaluate-screenreader-acceptance.py";

interface Job {
  argv?: string[] | string;
  setenv?: string[];
}

function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

/** The play that holds the catalogue, found by what it holds (see `trainer-callers.test.ts`). */
function catalogue(): Record<string, Job> {
  const plays = parseYaml(read("packages/control/ansible/lab-job.yml")) as
    Array<{ vars?: { lab_jobs?: Record<string, Job> } }>;
  const jobs = plays.flatMap((play) => (play?.vars?.lab_jobs ? [play.vars.lab_jobs] : []))[0];
  if (!jobs) throw new Error("lab_jobs not found in lab-job.yml — this guard is parsing the wrong shape");
  return jobs;
}

function npmScripts(): Record<string, string> {
  return JSON.parse(read("package.json")).scripts;
}

/** `npm run [--silent] <name>` → `<name>`, for every such segment of a script body. */
function npmRunTargets(body: string): string[] {
  return [...body.matchAll(/npm run (?:--silent )?([\w:-]+)/g)].map((match) => match[1]);
}

/** A script's body plus the body of every script it runs, so `training:capture:fresh` is not just its own line. */
function scriptChain(name: string, scripts: Record<string, string>, seen = new Set<string>()): string[] {
  if (seen.has(name) || scripts[name] === undefined) return [];
  seen.add(name);
  const body = scripts[name];
  return [body, ...npmRunTargets(body).flatMap((next) => scriptChain(next, scripts, seen))];
}

/** The subdirectory of `runs/` `datasetRoot()` uses when nothing names one. */
function defaultDatasetDir(): string {
  const found = /DEFAULT_DATASET_SUBDIR\s*=\s*"([\w-]+)"/.exec(read("packages/lab/src/dataset-paths.mjs"));
  if (!found) throw new Error("DEFAULT_DATASET_SUBDIR not found in dataset-paths.mjs — parsing the wrong shape");
  return found[1];
}

/** What a script FILE says about its corpus: a `datasetRoot("<dir>")` literal, or the default for `datasetRoot()`. */
function corpusOfSource(path: string): string[] {
  const source = stripComments(read(path));
  const named = [...source.matchAll(/datasetRoot\(\s*"([\w-]+)"\s*\)/g)].map((match) => match[1]);
  const usesDefault = /datasetRoot\(\s*\)/.test(source);
  return usesDefault ? [...named, defaultDatasetDir()] : named;
}

/** The `runs/<dir>` a job writes, or `null` when it cannot be worked out (which is never read as "fine"). */
export function corpusWrittenBy(name: string, jobs: Record<string, Job>,
                                scripts: Record<string, string>): string | null {
  const argv = [jobs[name]?.argv ?? ""].flat();
  const script = argv[0]?.endsWith("npm") && argv[1] === "run"
    ? argv.slice(2).find((word) => !word.startsWith("-"))
    : undefined;
  if (!script) return null;
  const bodies = scriptChain(script, scripts);
  const fromEnv = bodies.flatMap((body) => [...body.matchAll(/DATASET_ROOT=runs\/([\w-]+)/g)].map((m) => m[1]));
  const fromSource = bodies.flatMap((body) => [...body.matchAll(/(?:node|tsx) (\S+\.(?:mjs|ts))/g)])
    .flatMap((match) => corpusOfSource(match[1]));
  const corpora = new Set(fromEnv.length ? fromEnv : fromSource);
  return corpora.size === 1 ? [...corpora][0] : null;
}

/** The corpus the evaluator READS, from the catalogue's `acceptance` job: every `--data runs/<dir>/<repeat>.jsonl`. */
function evaluatorReads(jobs: Record<string, Job>): { corpus: string; repeats: string[] } {
  const argv = [jobs.acceptance?.argv ?? ""].flat();
  const data = argv.flatMap((word, at) => (argv[at - 1] === "--data" ? [word] : []));
  const parsed = data.map((path) => /^runs\/([\w-]+)\/([\w-]+)\.jsonl$/.exec(path));
  const corpora = new Set(parsed.map((m) => m?.[1]));
  assert.ok(data.length >= 2 && !parsed.includes(null) && corpora.size === 1,
    `the catalogue's acceptance job must read >= 2 repeats from ONE runs/<dir> (got ${JSON.stringify(data)})`);
  return { corpus: [...corpora][0] as string, repeats: parsed.map((m) => (m as RegExpExecArray)[2]) };
}

/** Every `-e job=<name>` the evaluator's text tells an operator to run, with the line it is on. */
export function jobsNamedBy(text: string): Array<{ job: string; line: number }> {
  return text.split("\n").flatMap((line, at) =>
    [...line.matchAll(/-e job=([\w-]+)/g)].map((match) => ({ job: match[1], line: at + 1 })));
}

/** Every way the message's job names disagree with the catalogue; empty means they agree. */
export function disagreements(text: string, jobs: Record<string, Job>, scripts: Record<string, string>): string[] {
  const { corpus, repeats } = evaluatorReads(jobs);
  const named = jobsNamedBy(text);
  const problems: string[] = [];
  for (const { job, line } of named) {
    if (!jobs[job]) {
      problems.push(`:${line} names job=${job}, which is not in the catalogue`);
      continue;
    }
    const writes = corpusWrittenBy(job, jobs, scripts);
    if (writes === null) problems.push(`:${line} names job=${job}, whose corpus could not be determined`);
    else if (writes !== corpus) {
      problems.push(`:${line} names job=${job}, which writes runs/${writes} and not runs/${corpus}`);
    }
  }
  // The other direction: naming only RIGHT jobs is still a wrong remedy if a repeat the evaluator reads
  // has no job named for it, because that repeat's records would be left as they were.
  for (const repeat of repeats) {
    const covered = named.some(({ job }) => (jobs[job]?.setenv ?? []).includes(`REPEAT=${repeat}`));
    if (!covered) problems.push(`no job named for ${repeat}, which the evaluator reads`);
  }
  return problems;
}

/** The remedy exactly as it stood at filing (evaluate-screenreader-acceptance.py:431-432, `76df05625`). */
const FILED_MESSAGE = [
  "\nRecapture the cases named above at this commit, on the box that owns the corpus:",
  "\n  npm run lab:job -- -e job=generate   then   npm run lab:job -- -e job=capture",
].join("");

test("the evaluator's remedy names only jobs that write the corpus it refuses", () => {
  const problems = disagreements(read(EVALUATOR), catalogue(), npmScripts());
  assert.deepEqual(problems, [],
    `${EVALUATOR} sends the operator at the wrong corpus or leaves a repeat uncleared:\n  ${problems.join("\n  ")}`);
});

test("POSITIVE CONTROL: the remedy as filed is refused, naming generate and capture", () => {
  const problems = disagreements(FILED_MESSAGE, catalogue(), npmScripts());
  const wrongCorpus = problems.filter((problem) => /writes runs\/screenreader-dataset/.test(problem));
  assert.equal(wrongCorpus.length, 2, `expected both training jobs refused, got: ${problems.join(" | ")}`);
  assert.match(wrongCorpus[0], /job=generate,/);
  assert.match(wrongCorpus[1], /job=capture,/);
});

test("MUTATION: one right job and one wrong job is still refused, naming the wrong one", () => {
  const oneRightOneWrong = FILED_MESSAGE.replace("job=generate ", "job=generate-acceptance ");
  const problems = disagreements(oneRightOneWrong, catalogue(), npmScripts());
  const wrongCorpus = problems.filter((problem) => /writes runs\/screenreader-dataset/.test(problem));
  assert.equal(wrongCorpus.length, 1, `a pass on one of two is counting, not checking: ${problems.join(" | ")}`);
  assert.match(wrongCorpus[0], /job=capture,/);
});

test("the corpus derivation separates the two corpora, and does not read a job it cannot resolve as fine", () => {
  const jobs = catalogue();
  const scripts = npmScripts();
  // The two poles, each through a different resolution path (env var / datasetRoot literal / default).
  assert.equal(corpusWrittenBy("capture-acceptance", jobs, scripts), "screenreader-acceptance");
  assert.equal(corpusWrittenBy("generate-acceptance", jobs, scripts), "screenreader-acceptance");
  assert.equal(corpusWrittenBy("export-acceptance", jobs, scripts), "screenreader-acceptance");
  assert.equal(corpusWrittenBy("capture", jobs, scripts), "screenreader-dataset");
  assert.equal(corpusWrittenBy("generate", jobs, scripts), "screenreader-dataset");
  assert.equal(corpusWrittenBy("no-such-job", jobs, scripts), null);
});
