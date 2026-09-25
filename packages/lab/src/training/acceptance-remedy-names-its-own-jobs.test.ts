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
 * WHAT IT READS IS THE RUNTIME STRING, NOT THE FILE (reviewer-2, #2444). The evaluator is Python, and its
 * docstring and comments explain the remedy in the same `-e job=<name>` spelling; scanning the raw source
 * let a docstring satisfy the guard while the string the operator actually sees named the wrong job.
 * `pythonMessageText()` keeps only string literals that are not docstrings, so prose beside the code
 * cannot stand in for it.
 *
 * POSITIVE CONTROLS: `FILED_MESSAGE` is the remedy as it stood at filing, and the tests below show
 * `disagreements()` refusing it, naming `generate` and `capture`; `DOCSTRING_ONLY` is a source whose
 * runtime message omits a repeat that its docstring and a comment name, and it must be refused. A checker
 * that has only ever been shown passing is the defect this repo files rows about.
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
  const script = /(^|\/)npm$/.test(String(argv[0])) && argv[1] === "run"
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

const TRIPLE = 3;

/** The string literal opening at `at` (a quote), as `{ end, quote }`: the index past its close and its delimiter. */
function literalEnd(source: string, at: number): { end: number; quote: string } {
  const quote = source.startsWith(source[at].repeat(TRIPLE), at) ? source[at].repeat(TRIPLE) : source[at];
  let end = at + quote.length;
  while (end < source.length && !source.startsWith(quote, end)) end += source[end] === "\\" ? 2 : 1;
  return { end: Math.min(end + quote.length, source.length), quote };
}

/**
 * A triple-quoted literal is a docstring, which is prose about the code, when it opens a block (directly after
 * a `:` line) or the module (nothing before it but blank lines and comments: the shebang, an encoding line).
 * The module case has no `:` to find, which is how one slipped past this test (reviewer, #2449).
 */
function isDocstring(source: string, at: number): boolean {
  const before = source.slice(0, at);
  const opensModule = before.split("\n").every((line) => line.trim() === "" || line.trim().startsWith("#"));
  return opensModule || /:[ \t]*\n\s*$/.test(before);
}

/**
 * The text of every Python string literal that is NOT a docstring, joined by newlines, with comments dropped.
 * The line numbers `jobsNamedBy()` then reports count lines of THIS text, not of the file: they say which
 * literal, and `grep` finds it.
 */
export function pythonMessageText(source: string): string {
  const literals: string[] = [];
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (char === "#") {
      at = source.indexOf("\n", at) === -1 ? source.length : source.indexOf("\n", at);
    } else if (char === '"' || char === "'") {
      const { end, quote } = literalEnd(source, at);
      const inside = source.slice(at + quote.length, end - quote.length);
      if (quote.length === 1 || !isDocstring(source, at)) literals.push(inside);
      at = end;
    } else at += 1;
  }
  return literals.join("\n");
}

/** Every `-e job=<name>` the evaluator's text tells an operator to run, with the line it is on. */
export function jobsNamedBy(text: string): Array<{ job: string; line: number }> {
  return text.split("\n").flatMap((line, at) =>
    [...line.matchAll(/-e job=([\w-]+)/g)].map((match) => ({ job: match[1], line: at + 1 })));
}

/**
 * Whether a job's script chain writes `--out=runs/<corpus>/…`, i.e. the `repeat-N.jsonl` files the evaluator
 * reads. Only the export does: a capture writes `captures/`, and the evaluator never opens those, so a
 * remedy naming captures alone leaves this refusal byte-identical (#2168's original defect, one step on).
 */
function writesReadFiles(name: string, jobs: Record<string, Job>, scripts: Record<string, string>,
                         corpus: string): boolean {
  const argv = [jobs[name]?.argv ?? ""].flat();
  const script = argv[1] === "run" ? argv.slice(2).find((word) => !word.startsWith("-")) : undefined;
  return scriptChain(script ?? "", scripts).some((body) => body.includes(`--out=runs/${corpus}/`));
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
  // And the files themselves: the evaluator reads `repeat-N.jsonl`, which only the export rewrites.
  if (!named.some(({ job }) => writesReadFiles(job, jobs, scripts, corpus))) {
    problems.push(`no job named that writes the runs/${corpus}/*.jsonl the evaluator reads (the export)`);
  }
  return problems;
}

/** The remedy exactly as it stood at filing (evaluate-screenreader-acceptance.py:431-432, `76df05625`). */
const FILED_MESSAGE = [
  "\nRecapture the cases named above at this commit, on the box that owns the corpus:",
  "\n  npm run lab:job -- -e job=generate   then   npm run lab:job -- -e job=capture",
].join("");

test("the evaluator's remedy names only jobs that write the corpus it refuses", () => {
  const problems = disagreements(pythonMessageText(read(EVALUATOR)), catalogue(), npmScripts());
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

test("POSITIVE CONTROL: the extractor reads the real refusal, so the guard above is not passing on an empty text", () => {
  const named = jobsNamedBy(pythonMessageText(read(EVALUATOR))).map(({ job }) => job);
  assert.ok(writesReadFiles("export-acceptance", catalogue(), npmScripts(), "screenreader-acceptance"));
  assert.ok(!writesReadFiles("capture-acceptance", catalogue(), npmScripts(), "screenreader-acceptance"));
  assert.ok(named.length > 0, "the extractor found no `-e job=` in the evaluator's string literals");
});

test("MUTATION: a docstring or a comment naming a job does not stand in for the message (reviewer-2, #2444)", () => {
  const DOCSTRING_ONLY = [
    "def refuse():",
    '    """Remedy: `-e job=export-acceptance` after `-e job=capture-acceptance-2`."""',
    "    # npm run lab:job -- -e job=capture-acceptance-2",
    '    raise SystemExit("\\n  npm run lab:job -- -e job=generate-acceptance"',
    '                     "\\n  npm run lab:job -- -e job=capture-acceptance")',
  ].join("\n");
  const problems = disagreements(pythonMessageText(DOCSTRING_ONLY), catalogue(), npmScripts());
  assert.deepEqual(problems, [
    "no job named for repeat-2, which the evaluator reads",
    "no job named that writes the runs/screenreader-acceptance/*.jsonl the evaluator reads (the export)",
  ]);
  // The same source scanned raw is what the guard used to do, and it passes: the defect, kept as evidence.
  assert.deepEqual(disagreements(DOCSTRING_ONLY, catalogue(), npmScripts()), []);
});

const MODULE_DOCSTRING_ONLY = [
  "#!/usr/bin/env python3",
  "# -*- coding: utf-8 -*-",
  '"""Evaluate the scorer. Remedy: `-e job=export-acceptance` after `-e job=capture-acceptance-2`."""',
  "",
  "def refuse():",
  '    raise SystemExit("\\n  npm run lab:job -- -e job=generate-acceptance"',
  '                     "\\n  npm run lab:job -- -e job=capture-acceptance")',
].join("\n");

test("MUTATION: a MODULE docstring naming a job does not stand in for the message (reviewer, #2449)", () => {
  // Nothing precedes a module docstring but the shebang and comments, so the `:`-then-newline test that
  // recognises a function's or class's docstring never sees it.
  const problems = disagreements(pythonMessageText(MODULE_DOCSTRING_ONLY), catalogue(), npmScripts());
  assert.deepEqual(problems, [
    "no job named for repeat-2, which the evaluator reads",
    "no job named that writes the runs/screenreader-acceptance/*.jsonl the evaluator reads (the export)",
  ]);
  assert.deepEqual(disagreements(MODULE_DOCSTRING_ONLY, catalogue(), npmScripts()), []);
});

test("POSITIVE CONTROL: a triple-quoted string after code is message text, so the module rule is not 'all of them'", () => {
  const assigned = ['"""Prose."""', 'REMEDY = """', "  npm run lab:job -- -e job=export-acceptance", '"""'].join("\n");
  assert.deepEqual(jobsNamedBy(pythonMessageText(assigned)).map(({ job }) => job), ["export-acceptance"]);
});
