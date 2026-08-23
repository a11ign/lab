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
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { releasability } from "../src/packaging/releasability.mjs";

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

function run(step, { dryRun }) {
  process.stdout.write(`\n=== ${step.name}\n    ${step.why}\n`);
  if (dryRun) return { ok: true, output: "(dry run)" };
  try {
    const output = execFileSync("npm", ["run", "--silent", step.script],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(output.split("\n").slice(-6).join("\n") + "\n");
    return { ok: true, output };
  } catch (cause) {
    process.stdout.write(`${(cause.stdout ?? "").split("\n").slice(-12).join("\n")}\n`);
    return { ok: false, output: cause.stdout ?? "", error: cause };
  }
}

/**
 * The verdict, from the artifacts the pipeline just produced.
 *
 * Deliberately the SAME function `promote:model` uses. A pipeline that judged its own output by a second
 * definition would let a candidate look shippable here and be refused there, which is how a release
 * process comes to be argued with rather than trusted.
 */
function verdict(candidateDirectory) {
  const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
  const shipped = resolve(REPO, "packages/scorer/models/screenreader-scorer");
  return releasability({
    training: read(resolve(candidateDirectory, "training-report.json")),
    acceptance: read(resolve(candidateDirectory, "acceptance-report.json")),
    shipped: read(resolve(shipped, "training-report.json")),
    shippedAcceptance: read(resolve(shipped, "acceptance-report.json")),
  });
}

export function pipeline({ dryRun = false, steps = STEPS } = {}) {
  const done = [];
  for (const step of steps) {
    const result = run(step, { dryRun });
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
  const result = pipeline({ dryRun: args.includes("--dry-run") });
  if (!result.ok) process.exit(1);
  if (candidate) {
    const v = verdict(resolve(REPO, "runs", `model-${candidate}`));
    process.stdout.write(`\n=== verdict\nRELEASABLE: ${v.releasable}\n`);
    for (const blocker of v.blockers) process.stdout.write(`  blocked: ${blocker}\n`);
    for (const note of v.notes) process.stdout.write(`  note:    ${note}\n`);
    process.exit(v.releasable ? 0 : 1);
  }
}
