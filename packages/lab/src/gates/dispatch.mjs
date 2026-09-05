// @ts-check
/**
 * A GATE RUNS ON THE CONTROL PLANE BY DEFAULT; `--local` is the escape hatch — control-plane-plan L2a.
 *
 * The safe thing is the default and the other one announces itself. That is the convention this repo
 * already uses for `--worker` (naming one box says "ONLY" in the verdict) and for capture runs (setting
 * nothing dispatches across the fleet), and it is the opposite of a warning, which depends on being read.
 *
 * WHY IT MATTERS FOR A GATE SPECIFICALLY. A gate produces a VERDICT, and two verdicts that look identical
 * were produced under conditions that were not: a laptop on Wi-Fi lost 9 of 40 responses while its battery
 * fell 18% to 1%, and nothing in the output said where it had run. The evidence for that was in `pmset`,
 * not in any report, and it cost two days of attributing a transport fault to the capture protocol.
 *
 * THE FRICTION IS THE CORRECT FRICTION. Dispatching needs the ref pushed, because `run-job.yml` refuses a
 * commit other than the one asked for -- "a job that quietly runs four commits behind reports success for
 * code you did not ask for". So `--local` stays genuinely useful for a working tree, which is what it is
 * for, and it says so in the verdict rather than being indistinguishable.
 */
import { spawn } from "node:child_process";
import { REPO_ROOT } from "../dataset-paths.mjs";

/**
 * The flag that keeps a gate here. EXPORTED so a caller's `refuseUnknownFlags` list and this check cannot
 * disagree — the fact-stated-twice shape, and a mismatch would refuse the one flag this module needs.
 */
export const LOCAL_FLAG = "--local";

/**
 * Hand this gate to the lab, unless asked to run here.
 *
 * `argv` is REQUIRED and never read from `process.argv`: a module that reaches for global state is one a
 * test cannot drive, and the discovery guard that finds every argv reader correctly flagged it when it did
 * — this is a library its CALLERS guard, not a CLI of its own.
 *
 * @param {{ job: string, argv: string[] }} what  the `lab-job.yml` entry this gate corresponds to
 * @returns {Promise<{ runHere: true, controlPlane: string } | never>}
 *   Returns only when the caller should proceed locally; otherwise it dispatches and EXITS with the job's
 *   status, so a caller cannot accidentally run both.
 */
export async function dispatchUnlessLocal({ job, argv }) {
  if (argv.includes(LOCAL_FLAG)) {
    // NAMED, not merely permitted. `hostname` is what distinguishes one operator's laptop from another's
    // in a pasted result, which is the case this exists for.
    return { runHere: true, controlPlane: `${localHost()} (${LOCAL_FLAG})` };
  }
  process.stdout.write(`dispatching ${job} to the lab — the control plane, not this machine.\n`
    + "  `--local` runs it here instead, and says so in the verdict.\n");
  const code = await run("npm", ["run", "--silent", "lab:job", "--", `-e`, `job=${job}`]);
  // EXITS rather than returning: a dispatcher that fell through would run the gate twice, once remotely
  // and once here, and the second result would overwrite the first in the operator's terminal.
  process.exit(code);
}

/** What this machine calls itself, for the verdict's provenance. */
export function localHost() {
  return process.env.HOSTNAME || process.env.HOST || "this machine";
}

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, stdio: "inherit" });
    child.on("error", () => resolvePromise(2));
    // `?? 2` because a signal gives a null code, and INCONCLUSIVE is the honest verdict for a dispatch
    // that was killed -- not success, and not a gate failure either.
    child.on("exit", (code) => resolvePromise(code ?? 2));
  });
}
