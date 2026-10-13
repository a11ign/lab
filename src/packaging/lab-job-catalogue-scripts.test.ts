/**
 * The control plane's catalogue (`ansible/lab-job.yml`) and the lab's own scripts agree.
 *
 * Moved from control's `src/control-owned/lab-job.test.ts` (control#87, a11ign#5372). Both checks read the
 * LAB's scripts, and the scripts are what the catalogue calls, so the join between them lives here.
 *
 * POSITIVE CONTROL: the dispatching-gate discovery must find at least two gates, or the first test would
 * pass on an empty set; the exit-code test reads a job that declares exit meanings, so it cannot pass on
 * nothing either.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const LAB_SCRIPTS = fileURLToPath(new URL("../../scripts/", import.meta.url));
const CATALOGUE = fileURLToPath(new URL("../../../control/ansible/lab-job.yml", import.meta.url));

type JobEntry = { argv?: unknown[] | string; exitMeanings?: Record<string, string> };
type CataloguePlay = { vars?: { lab_jobs?: Record<string, JobEntry> } };

/** The play HOLDING the catalogue, found by what it declares rather than by position. */
function catalogueJobs(): Record<string, JobEntry> {
  const doc = parseYaml(readFileSync(CATALOGUE, "utf8")) as CataloguePlay[];
  const play = doc.find((candidate) => candidate?.vars?.lab_jobs);
  if (!play?.vars?.lab_jobs) throw new Error("lab_jobs not found in lab-job.yml — this guard is parsing the wrong shape");
  return play.vars.lab_jobs;
}

test("a gate that dispatches to the control plane must be told --local when the control plane runs it", () => {
  // MEASURED 2026-08-30: `gate-probe-order` died `sh: 1: ansible-playbook: not found`, exit 127 -- a message
  // that reads like a broken lab rather than a job wired to call itself. DISCOVERED rather than listed,
  // because "which scripts dispatch" is a fact about the source that a hand-written list goes stale against.
  const dispatching = readdirSync(LAB_SCRIPTS)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .filter((file) => readFileSync(LAB_SCRIPTS + file, "utf8").includes("gates/dispatch.ts"));
  assert.ok(dispatching.length >= 2,
    `found ${dispatching.length} dispatching gates; the discovery is broken, not the catalogue clean`);

  const offenders: string[] = [];
  for (const [name, job] of Object.entries(catalogueJobs())) {
    const argv = (Array.isArray(job?.argv) ? job.argv : []).map(String);
    const script = dispatching.find((file) => argv.some((part) => part.endsWith(file)));
    if (script && !argv.includes("--local")) offenders.push(`${name} runs ${script} without --local`);
  }
  assert.deepEqual(offenders, [],
    "these jobs re-dispatch from inside the lab and die with `ansible-playbook: not found`");
});

test("#1626: axe-calibration's declared exit codes are ones its own script can actually produce", () => {
  // axe-calibration.ts is its own contract, so what it can return is read from ITS source, never typed by hand.
  const source = readFileSync(resolve(LAB_SCRIPTS, "axe-calibration.ts"), "utf8");
  const meanings = catalogueJobs()["axe-calibration"]?.exitMeanings ?? {};
  const declared = Object.keys(meanings);
  assert.ok(declared.length > 0, "axe-calibration must declare what its non-zero exits mean");
  for (const code of declared) {
    assert.match(source, new RegExp(String.raw`process\.exitCode\s*=\s*${code}\b`),
      `axe-calibration declares exit ${code}, but its script has no \`process.exitCode = ${code}\``);
  }
});
