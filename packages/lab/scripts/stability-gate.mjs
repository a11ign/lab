// Refuse to start a corpus run if the pipeline does not produce the same evidence twice.
//
//   npm run gate:stability                       # before any recapture
//   npm run gate:stability -- --times=6
//
// ## Why this is a gate and not a tool
//
// The corpus carried a non-deterministic artefact for weeks and nothing caught it. Edge's autofill
// drew a suggestion icon inside recognised inputs, NVDA announced it as an embedded object appended to
// the field, and because `probeForms` submits forms the profile learned more as a run progressed --
// so the rate climbed from 3% to 31% and 26 good/bad pairs ended up disagreeing about it.
//
// Every existing check stayed green throughout, because they count. The counts never moved: one form
// field before, one form field after. Only comparing CONTENT across repeated captures of the same
// unchanged page could have seen it, and that was an ad-hoc tool nobody was required to run.
//
// ## Why these pages
//
// A canary that cannot express the fault is worthless, and choosing one that could not is a mistake
// made three times in a single day here -- each time producing a clean result that was read as
// confirmation. Every page below is present because of a specific mechanism it can exercise, and that
// reason is recorded next to it. Add pages the same way.
//
// This delegates to `training:repeat` rather than reimplementing its comparison, which is the same
// point in miniature: the tool already existed and hand-rolled substitutes were worse.
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

// Resolved from THIS module. It was the cwd-relative `"src/training/repeat-capture.mjs"`, which stopped
// existing when M8 moved the corpus pipeline into this package — and `gate:stability` is the check that must
// pass before any corpus run, so it failing with "Command failed" is exactly the confusing symptom the comment
// below warns about.
const REPEAT_CAPTURE = fileURLToPath(new URL("../src/training/repeat-capture.mjs", import.meta.url));

import { leaseWorker, guestReachableUrl } from "@a11y-witness/worker-fleet";
import { leasePageServer } from "../src/training/page-server.mjs";

const run = promisify(execFile);

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const TIMES = Number(arg("times", "5"));

/**
 * This gate LEASES what it needs, rather than requiring you to have set it up.
 *
 * It could not run at all before: `repeat-capture.mjs` refuses without a worker, and the canary URLs
 * pointed at a page server nobody started — so with neither `A11Y_WORKER` nor a hand-run `npx serve`,
 * all five canaries reported "harness did not start" and the gate exited 2. A gate that a corpus run is
 * forbidden to start without, and that cannot start itself, is a gate that gets skipped; `release:gate`
 * was broken from the day it was written for the same reason, and `capture:check` went unrun for months
 * because it "cost a ceremony". This project's own rule: automate a check or lose it.
 *
 * Both leases put things back as they found them — a worker somebody had already started is left
 * running, and a page server somebody else is serving is left alone.
 */
const DATASET_ROOT = resolve(process.cwd(), process.env.DATASET_ROOT || "runs/screenreader-dataset");
const PAGES_PORT = Number(process.env.DATASET_PAGES_PORT || 5050);

/**
 * Canaries, each with the mechanism it exists to catch.
 *
 * `reason` is not documentation. It is the thing to check before trusting a PASS: if a page cannot
 * express the fault you care about, its stability tells you nothing about that fault.
 */
const CANARIES = [
  {
    path: "form-unlabelled/good",
    reason: "auto-focuses its input, which is what surfaces Edge's autofill affordance — the exact " +
      "page that still produced U+FFFC after a fix verified on a page that does not auto-focus",
  },
  {
    path: "form-error-silent/bad",
    reason: "submits a form, which is how the profile LEARNS the values that later become suggestions",
  },
  {
    path: "table-unassociated-headers/bad",
    reason: "the table walk returned 4, 2, 4, 4, 1, 4, 4 cells across 18 captures once; tables are " +
      "the other field with a history of non-determinism",
  },
  {
    path: "disclosure-state-silent/good",
    reason: "state changes depend on an interaction landing, which is timing-sensitive in a way a " +
      "static read is not",
  },
  {
    path: "image-missing-alt/good",
    reason: "the simplest page there is — if this one varies, the fault is in the pipeline rather " +
      "than in anything the page does",
  },
  {
    // The page that proved this gate had a blind spot. An intermittent late document announcement was
    // credited to the activation here — `after: "Energy results, document"` on a page whose entire
    // finding is that activating the filter announces NOTHING — and it reached the corpus while every
    // canary reported stable, because no canary drove a task-button probe and `formChanges` was not even
    // among the compared fields.
    path: "filter-status-silent-solar/bad",
    task: "Show solar tours and notice the result count.",
    probeForms: true,
    reason: "the only canary that activates a control and measures what the page says back; the " +
      "interaction criteria (3.3.1, 4.1.3) are unreachable without it, and a contaminant lived here",
  },
];

// Leased before the first canary and released in the `finally` at the bottom, so a gate that throws
// half way through still leaves the host as it found it.
const pages = await leasePageServer({
  root: resolve(DATASET_ROOT, "pages"),
  port: PAGES_PORT,
  probePath: `${CANARIES[0].path}.html`,
});
const lease = await leaseWorker({ worker: arg("worker", process.env.A11Y_WORKER), after: "restore" });
// The GUEST fetches these pages, and the guest's localhost is not ours. `guestReachableUrl` rewrites the
// host — skipping it is how every capture came to fetch the guest's own localhost, showing Edge
// "localhost refused to connect" and burning three attempts per page.
const BASE = arg("base", guestReachableUrl(pages.url, lease));
process.stdout.write(`worker ${lease.worker} (${lease.source}) · pages ${BASE}\n`);

const results = [];
/**
 * One canary, captured `TIMES` times and judged.
 *
 * Extracted so the leases can be held in a `try/finally` around the loop without pushing the loop body
 * to four levels of nesting -- the lint gate's limit is three, and the honest fix for depth is a named
 * function rather than a suppression.
 */
async function judgeCanary({ path, reason, task, probeForms }, { base, worker, results }) {
  const url = `${base}/${path}`;
  process.stdout.write(`\n=== ${path} (${TIMES}x) ===\n    why: ${reason}\n`);
  // tsx, not node: repeat-capture imports isTransient from capture-decisions.mjs, which imports the
  // TypeScript verify.js. Under plain node that is ERR_MODULE_NOT_FOUND before a single line of output
  // -- which is precisely how five canaries came back "Command failed" with nothing to read. The repo
  // has hit this before with evidence-check.mjs; the fix there was the same.
  const args = [REPEAT_CAPTURE, `--url=${url}`, `--times=${TIMES}`,
    `--worker=${worker}`];
  // Opt-in per canary: a capture must never pay for evidence nobody asked for, and a probe that does not
  // run is cheaper than one that does.
  if (probeForms) args.push("--probe-forms", `--task=${task}`);
  try {
    const { stdout } = await run("npx", ["tsx", ...args], { maxBuffer: 1 << 24 });
    const varies = stdout.split("\n").filter((l) => l.includes("VARIES"));
    const usable = /(\d+)\/\d+ usable/.exec(stdout)?.[1];
    if (varies.length) {
      results.push({ path, ok: false, detail: varies.map((v) => v.trim()).join("; ") });
      process.stdout.write(varies.map((v) => `  ${v.trim()}\n`).join(""));
    } else if (Number(usable ?? 0) < 2) {
      // Too few usable captures is not a PASS. A gate that passes when it could not measure is worse
      // than no gate, because it launders "unknown" into "fine".
      results.push({ path, ok: false, detail: `only ${usable ?? 0} usable capture(s) — could not judge` });
      process.stdout.write(`  INCONCLUSIVE — only ${usable ?? 0} usable\n`);
    } else {
      results.push({ path, ok: true, detail: `${usable} usable, all fields identical` });
      process.stdout.write(`  STABLE — ${usable} usable, all fields identical\n`);
    }
  } catch (error) {
    interpretFailure(error, path, results);
  }
}

/**
 * What a non-zero exit from repeat-capture actually MEANS.
 *
 * Three different outcomes come back the same way -- a field varies, a capture errored, a capture heard
 * nothing -- and only the first is evidence that the pipeline is nondeterministic. Collapsing them into
 * "Command failed" once made a transient capture error read exactly like genuine instability and cost a
 * re-run to discover the page was fine. repeat-capture puts its report on stdout even when it exits 1.
 */
function interpretFailure(error, path, results) {
  const out = String(error.stdout ?? "");
  const varies = out.split("\n").filter((l) => l.includes("VARIES")).map((l) => l.trim());
  const empty = /(\d+) capture\(s\) heard nothing/.exec(out)?.[1];
  const failedRuns = out.split("\n").filter((l) => l.trim().startsWith("FAILED")).map((l) => l.trim());
  // An empty stdout means the child never started -- a module resolution error, a missing file -- and
  // that is a broken harness, not an inconclusive measurement. Say so rather than advising a re-run that
  // will fail identically. This is exactly what five "harness did not start" canaries looked like when
  // the gate had no worker to give them.
  if (!out.trim()) {
    const firstError = String(error.stderr ?? error.message).split("\n").find((l) => l.includes("Error"));
    const detail = `harness did not start: ${firstError ?? error.message.split("\n")[0]}`;
    results.push({ path, ok: false, unstable: false, detail });
    process.stdout.write(`  BROKEN — ${detail}\n`);
    return;
  }
  const detail = varies.length ? `UNSTABLE: ${varies.join("; ")}`
    : empty ? `${empty} empty capture(s) — the foreground flake, not instability`
    : failedRuns.length ? `${failedRuns.length} capture(s) errored: ${failedRuns[0]}`
    : error.message.split("\n")[0];
  // Only a VARIES is evidence of nondeterminism. An errored or empty capture is a flake in the run, so it
  // is reported and retried rather than treated as a verdict.
  results.push({ path, ok: false, unstable: varies.length > 0, detail });
  process.stdout.write(`  ${varies.length ? "UNSTABLE" : "INCONCLUSIVE"} — ${detail}\n`);
}

try {
  for (const canary of CANARIES) await judgeCanary(canary, { base: BASE, worker: lease.worker, results });
} finally {
  // Release in the reverse order they were taken, and never let a release failure mask the verdict.
  await lease.release().catch((e) => process.stderr.write(`worker release failed: ${e.message}\n`));
  await pages.release().catch((e) => process.stderr.write(`page server release failed: ${e.message}\n`));
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} canaries stable\n`);
for (const f of failed) process.stdout.write(`  ${f.path}: ${f.detail}\n`);
const unstable = failed.filter((f) => f.unstable);
if (failed.length && !unstable.length) {
  process.stdout.write("\nNo canary was UNSTABLE, but some could not be judged (errored or empty " +
    "captures). Re-run the gate; if the same canary keeps failing to complete, that is a worker " +
    "problem rather than a determinism one.\n");
  process.exit(2);
}
if (failed.length) {
  process.stdout.write("\nDo NOT start a corpus run. Evidence that varies for the same unchanged page " +
    "is indistinguishable from evidence that differs because the page differs, which is the one defect " +
    "this project cannot tolerate.\n");
  process.exit(1);
}
process.stdout.write("\nStable. Safe to start a corpus run.\n");
