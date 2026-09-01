// @ts-check
/**
 * Bring a promotion home from the lab, in one command.
 *
 * `promote:gated` runs on the lab — it is the only box holding both the candidate weights and the code —
 * and deliberately does not commit, because promoting is a MAJOR release and that is a human's call. The
 * consequence is a five-step manual dance nobody wrote down, and it is not optional: until the promotion
 * is committed and pushed, the lab keeps an UNTRACKED changeset at a path origin does not have, so
 * `run-job.yml` refuses to pull and every later job silently runs at the old commit.
 *
 * The cost is measured, twice, in this repo's own notes. 2026-08-30: three round trips, ending in
 * "renaming the committed file to match the lab's fixed it at once". 2026-09-01: four more, by me, and
 * the reason both times is the same — the changeset's NAME. `promote:model` names it after the candidate
 * it promoted, `lab-fetch` flattens that to `candidate.promoted-changeset.md`, and committing it under
 * any other name leaves the lab's copy untracked forever.
 *
 * So this exists for the reason the worker VMs, the page server and NVDA are leased rather than managed
 * by hand: **anything a human has to remember is something that does not happen.** It fetches all four
 * artefacts, reads the changeset's real name off the lab rather than guessing it, installs them, and then
 * runs the two gates that decide whether what it installed is coherent.
 *
 * WHAT IT DOES NOT DO: commit, push, or clear the lab. Those are the deliberate human steps, and it
 * prints the exact commands. Overwriting tracked weights is already the largest thing this script does.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MODEL_DIR = resolve(REPO, "packages/scorer/models/screenreader-scorer");

refuseUnknownFlags(["--dry-run"], { entry: import.meta.url, command: "npm run lab:collect-promotion" });
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * The four artefacts a promotion writes, and where each belongs once it is home.
 *
 * `dest: null` means "the lab decides the name" — only the changeset, and that is the whole reason this
 * script exists rather than a four-line shell alias.
 */
const ARTEFACTS = [
  { artifact: "promoted-weights", local: "candidate.promoted-weights.safetensors",
    dest: resolve(MODEL_DIR, "model.safetensors") },
  { artifact: "promoted-training-report", local: "candidate.promoted-training-report.json",
    dest: resolve(MODEL_DIR, "training-report.json") },
  { artifact: "promoted-acceptance-report", local: "candidate.promoted-acceptance-report.json",
    dest: resolve(MODEL_DIR, "acceptance-report.json") },
  { artifact: "promoted-changeset", local: "candidate.promoted-changeset.md", dest: null },
];

const sha = (/** @type {string} */ file) =>
  existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16) : "(absent)";

/**
 * Fetch one artefact and return the path it had ON THE LAB.
 *
 * That path is the point. `lab-fetch` reports it because a globbed artefact's real name survives nowhere
 * else — see the comment on its "Where it landed" task, which was added for exactly this caller.
 *
 * @param {string} artifact
 * @returns {string} the lab-relative source path
 */
function fetchArtefact(artifact) {
  const output = execFileSync("npm", ["run", "--silent", "lab:fetch", "--", "-e", `artifact=${artifact}`],
    { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  const source = output.match(/from (\S+) on the lab/);
  if (!source) {
    // REFUSE rather than fall back to the flattened local name. Guessing it is the bug this replaces, and
    // a guess that is usually right is worse than a refusal, because it fails only on the run that matters.
    throw new Error(`lab:fetch did not report where ${artifact} came from. Without the lab-side name the `
      + "changeset cannot be committed under it, which is the whole point of this command. Check that "
      + "lab-fetch.yml's \"Where it landed\" task still prints the source path.");
  }
  return source[1];
}

function main() {
  process.stdout.write("Collecting the promotion the lab is holding.\n\n");
  const collected = [];
  for (const entry of ARTEFACTS) {
    const source = fetchArtefact(entry.artifact);
    const local = resolve(REPO, "runs/fetched", entry.local);
    if (!existsSync(local)) throw new Error(`${entry.artifact} fetched but ${local} is absent`);
    // The changeset's destination is the lab's own basename — never a name of our choosing.
    const dest = entry.dest ?? resolve(REPO, ".changeset", source.split("/").pop() ?? "");
    collected.push({ ...entry, source, local, dest, before: sha(dest), after: sha(local) });
  }

  for (const c of collected) {
    const verdict = c.before === c.after ? "same" : c.before === "(absent)" ? "NEW" : "REPLACES";
    process.stdout.write(`  ${verdict.padEnd(9)} ${c.dest.replace(`${REPO}/`, "")}\n`);
    if (verdict !== "same") process.stdout.write(`            ${c.before} -> ${c.after}   (${c.source})\n`);
  }

  if (DRY_RUN) {
    process.stdout.write("\n--dry-run: nothing was written.\n");
    return;
  }

  for (const c of collected) {
    mkdirSync(dirname(c.dest), { recursive: true });
    copyFileSync(c.local, c.dest);
  }

  // THE GATES, RUN HERE RATHER THAN LEFT TO THE OPERATOR. `release:provenance` is the one check that can
  // see the failure this flow actually produces: weights and a changeset that describe DIFFERENT models.
  // It found exactly that today — the tree held 2,525-record weights while the lab had promoted 2,607 —
  // and it can only find it once both are in the same tree, which is here.
  process.stdout.write("\n");
  for (const [script, why] of [["scorer:verify", "the artefact is safetensors, not an executable format"],
                               ["release:provenance", "the changeset accounts for the weights beside it"]]) {
    process.stdout.write(`=== ${script}\n    ${why}\n`);
    execFileSync("npm", ["run", "--silent", script], { cwd: REPO, stdio: "inherit" });
  }

  const changeset = collected.find((c) => c.artifact === "promoted-changeset");
  process.stdout.write("\nInstalled. Two deliberate steps remain, and they are yours:\n\n"
    + `  git add ${MODEL_DIR.replace(`${REPO}/`, "")} ${changeset?.dest.replace(`${REPO}/`, "")}\n`
    + "  git commit && git push\n\n"
    + "then clear the lab, which can only discard what origin already carries:\n\n"
    + `  npm run lab:reset -- -e apply=true -e remove=${changeset?.source}\n`);
}

// ONLY WHEN THIS MODULE IS THE COMMAND. Called unconditionally at first, and `npm test` caught it within
// the minute — as did I, by importing this file to check it parsed and watching it fetch four artefacts
// and overwrite the shipped weights. A module whose import has side effects cannot be examined without
// running it, which is the same rule `refuseUnknownFlags` enforces one line up for the same reason.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
