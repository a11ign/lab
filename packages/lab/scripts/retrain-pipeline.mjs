// @ts-check
/**
 * The whole retrain, as ONE command.
 *
 * Until 2026-08-23 this sequence existed nowhere. Producing a candidate meant running eight things in
 * order and reading each result — generate, capture, check-signals, export, build-realism, train,
 * acceptance, audit — and the ORDER and the STOP CONDITIONS lived in somebody's head. That is the same
 * defect this repo already fixed for worker deploys and lab jobs, left in place for the most expensive
 * operation it has.
 *
 * The cost was not hypothetical. Every defect found on 2026-08-23 existed because the pipeline had never
 * once been run end to end: a circular deadlock where acceptance refused to run on a fresh candidate, a
 * training job that was single-use, an acceptance corpus that could not express the case it was meant to
 * judge, and a promotion step that did not exist at all. Each was invisible while the path was walked by
 * hand, because a human silently works around what a script cannot.
 *
 * **It stops at the first gate that fails, and says which.** A pipeline that carries on past
 * `check-signals` produces a candidate trained on a corpus with a hole in it, and the number at the end
 * looks exactly like a good one.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { releasability } from "../src/packaging/releasability.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * a mistyped `--dry-run` runs the REAL retrain; `--silent` in this file is npm's, passed to each step.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--candidate=", "--dry-run"], { entry: import.meta.url, command: "npm run lab:retrain" });

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Every step, in order, with what it is for.
 *
 * `gate: true` means a failure STOPS the pipeline. The others are steps whose failure is also fatal, but
 * the distinction is worth keeping visible: a gate failing is the pipeline working.
 */
const STEPS = [
  { name: "generate", script: "training:generate",
    why: "rebuild the pages from the case definitions — capturing the previous ones is testing the previous commit" },
  { name: "capture", script: "training:capture",
    why: "drive them through the fleet; cached where nothing changed" },
  { name: "check-signals", script: "training:check-signals", gate: true,
    why: "every case must still tell its good page from its bad one" },
  { name: "export", script: "training:export",
    why: "captures to training records" },
  { name: "build-realism", script: "training:build-realism",
    why: "add the real-page tier" },
];

/**
 * Run one step. Exported so a SECOND pipeline can name it rather than reimplement it — see
 * `everything-pipeline.mjs`, which is the same shape over a longer chain. `step.args` are appended after
 * npm's `--`, for the steps that take one; a step without them is unchanged.
 */
/**
 * @param {{ name: string, why: string, script: string, args?: string[] }} step
 * @param {{ dryRun?: boolean }} options
 * @returns {{ ok: boolean, output: string, error?: unknown }}
 */
export function run(step, { dryRun }) {
  process.stdout.write(`\n=== ${step.name}\n    ${step.why}\n`);
  if (dryRun) return { ok: true, output: "(dry run)" };
  const argv = ["run", "--silent", step.script, ...(step.args?.length ? ["--", ...step.args] : [])];
  try {
    const output = execFileSync("npm", argv,
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(output.split("\n").slice(-6).join("\n") + "\n");
    return { ok: true, output };
  } catch (cause) {
    // STDERR TOO, and it is not a nicety. This printed only `cause.stdout`, so a step that died with a
    // stack trace reported nothing at all: measured 2026-08-25, `capture` failed at import with
    // `No available supported screen readers` from guidepup and the pipeline said exactly
    // `STOPPED at capture. That step is required` and not one word of the reason. Diagnosing it took a
    // manual re-run of the same command with 2>&1.
    //
    // A caught error whose message is discarded is worse than an uncaught one: this repo's rule is that a
    // caught-and-LOGGED error is not a handled error, and this was caught and not even logged.
    // The thrown value from `execFileSync`, typed so its captured streams are readable. `cause` is
    // `unknown` under strict, and this block exists precisely to PRINT those streams -- the repo's rule
    // that a caught-and-logged error is not a handled one, with the logging half restored.
    const failure = /** @type {{ stdout?: string, stderr?: string }} */ (cause);
    const stderr = (failure.stderr ?? "").trim();
    process.stdout.write(`${(failure.stdout ?? "").split("\n").slice(-12).join("\n")}\n`);
    if (stderr) process.stdout.write(`--- stderr ---\n${stderr.split("\n").slice(-20).join("\n")}\n`);
    return { ok: false, output: `${failure.stdout ?? ""}${stderr}`, error: cause };
  }
}

/**
 * The verdict, from the artifacts the pipeline just produced.
 *
 * Deliberately the SAME function `promote:model` uses. A pipeline that judged its own output by a second
 * definition would let a candidate look shippable here and be refused there, which is how a release
 * process comes to be argued with rather than trusted.
 */
/** @param {string} candidateDirectory */
function verdict(candidateDirectory) {
  const read = (/** @type {string} */ path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
  const shipped = resolve(REPO, "packages/scorer/models/screenreader-scorer");
  return releasability({
    training: read(resolve(candidateDirectory, "training-report.json")),
    acceptance: read(resolve(candidateDirectory, "acceptance-report.json")),
    shipped: read(resolve(shipped, "training-report.json")),
    shippedAcceptance: read(resolve(shipped, "acceptance-report.json")),
  });
}

/**
 * @param {object} [input]
 * @param {boolean} [input.dryRun]   print what each step would do and run nothing
 * @param {object[]} [input.steps]   the sequence; defaults to the real one
 * @param {Function} [input.runStep] how to run a step. INJECTABLE so the ordering and the stop conditions
 *   can be tested without a fleet — which is the half that has actually gone wrong. The order and the
 *   gates were in somebody's head for months; a test that proves a failing gate stops the run needs no
 *   worker, no lab and no corpus.
 */
export { STEPS };

/**
 * Run a stage, and keep everything it said.
 *
 * The runner prints a six-line tail per stage, which is what makes a nine-stage chain legible — and it
 * captures the child's stdout to do that, so the detail no longer reaches the journal AT ALL. Measured
 * on the first green run: the fetched log went from 400 lines to 63, and `RULES: PASS`, the per-criterion
 * table and `1183 scored, 0 false positive(s)` were all simply gone. The chain reported a pass with the
 * evidence FOR that pass discarded, which is worse than the illegibility it replaced — this repo's oldest
 * rule is that a number is only as good as what it was computed from.
 *
 * So the tail is the summary and this is the record. Appended per stage rather than written at the end,
 * because a chain killed at hour three must still leave behind what it had already done.
 *
 * IT LIVES HERE, BESIDE `run`, BECAUSE THE TAIL DOES. It was written in `everything-pipeline.mjs` and
 * solved the problem only for THAT pipeline's nine stages — while `retrain`, which is one of them, is
 * itself a pipeline running this same `run` in a child process, tailing its own five stages to six lines
 * before everything-pipeline ever sees them. So the "full record" nested a tail inside it: measured
 * 2026-09-01, `build-realism` reports one line PER HEAD and the transcript preserved the last three,
 * of which `4.1.3: 0 of 37` was legible only because 4.1.3 sorts last. That is this repo's most
 * expensive recurring shape — a remedy reaching one of several paths — and the fix is one definition
 * both entry points call, not a second copy in this file.
 *
 * The transcript path is now REQUIRED rather than defaulted. Two pipelines writing one default path
 * would interleave a nested run's stages with its parent's, and 'which run wrote this line' is exactly
 * the question a transcript exists to answer.
 */
/**
 * Typed by what this wrapper DOES, not by redeclaring what it wraps.
 *
 * A first attempt spelled out a guessed signature for `runStep`, and the guess made the CALL SITE fail
 * to typecheck against the real `run` — which takes `{ dryRun }`. A wrapper that restates its subject's
 * shape has two copies of that shape, and this is the cheaper half of the same lesson the `Mismatch`
 * typedef records one package over.
 *
 * Both parameters are loose on purpose. A generic that MIRRORS the wrapped function's type was tried and
 * is too clever: it forces the wrapper to have the wrapped function's exact arity, so a caller passing a
 * one-argument stub could no longer invoke the two-argument wrapper. The honest description is what this
 * wrapper guarantees — a step goes in, a result comes out, and the output reaches the transcript.
 *
 * @param {(step: any, options?: any) => {ok: boolean, output: string}} runStep
 * @param {{transcript: string}} where
 * @returns {(step: any, options?: any) => {ok: boolean, output: string}}
 */
export function keepingTranscript(runStep, { transcript }) {
  return (step, options) => {
    const result = runStep(step, options);
    mkdirSync(dirname(transcript), { recursive: true });
    appendFileSync(transcript,
      `\n${"=".repeat(78)}\n=== ${step.name}${result.ok ? "" : "  — FAILED"}\n`
      + `${"=".repeat(78)}\n${result.output ?? ""}\n`, "utf8");
    return result;
  };
}

/**
 * Where a standalone `lab:retrain` keeps its full record. A DIFFERENT file from the everything chain's,
 * because when `everything` runs this as a child both exist at once and a shared path would interleave
 * them — see `keepingTranscript`.
 */
export const RETRAIN_TRANSCRIPT = resolve(REPO, "runs", "retrain-transcript.log");

export function pipeline({ dryRun = false, steps = STEPS, runStep = run } = {}) {
  const done = [];
  for (const step of steps) {
    const result = runStep(step, { dryRun });
    done.push({ step: step.name, ok: result.ok });
    if (!result.ok) {
      process.stdout.write(`\nSTOPPED at ${step.name}.`
        + (step.gate ? " That is a GATE, and it failing is the pipeline working — fix the corpus, "
          + "not the pipeline.\n" : " That step is required; nothing after it would be meaningful.\n"));
      return { ok: false, stoppedAt: step.name, done };
    }
  }
  return { ok: true, done };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const candidate = (args.find((a) => a.startsWith("--candidate=")) ?? "").split("=")[1];
  const dryRun = args.includes("--dry-run");
  // A DRY RUN KEEPS NO TRANSCRIPT, rather than appending "(dry run)" to the last real one. The `rmSync`
  // below is skipped on a dry run — correctly, since nothing should be destroyed — but the append was
  // not, so `--dry-run` silently added stages to the record of the last REAL run. That is precisely the
  // failure the comment on that `rmSync` describes ("the fixture capture keeps failing", read off a
  // later unrelated job), reintroduced by the guard written to prevent it.
  // A fresh transcript per run: appending to the previous one is how "the fixture capture keeps failing"
  // came to be read off a later, unrelated job.
  if (!dryRun) rmSync(RETRAIN_TRANSCRIPT, { force: true });
  const result = pipeline({
    dryRun,
    runStep: dryRun ? run : keepingTranscript(run, { transcript: RETRAIN_TRANSCRIPT }),
  });
  if (!result.ok) process.exit(1);
  if (candidate) {
    const v = verdict(resolve(REPO, "runs", `model-${candidate}`));
    process.stdout.write(`\n=== verdict\nRELEASABLE: ${v.releasable}\n`);
    for (const blocker of v.blockers) process.stdout.write(`  blocked: ${blocker}\n`);
    for (const note of v.notes) process.stdout.write(`  note:    ${note}\n`);
    process.exit(v.releasable ? 0 : 1);
  }
}
