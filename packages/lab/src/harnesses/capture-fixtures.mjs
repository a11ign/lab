// @ts-check
/**
 * Recapture eval fixtures — over a live worker, or in-process on the capture guest.
 *
 *     npm run eval:capture -- --worker=http://192.0.2.10:8765 --set=tutorials
 *     npm run eval:capture -- --worker=http://192.0.2.10:8765 --only=menus
 *     npm run eval:capture -- --set=books            # in-process; guest only, interactive session
 *
 * ## Why a worker mode exists
 *
 * This replaces `capture-books.mjs`, which could only capture in-process and therefore only on the Windows
 * guest in an interactive desktop session. `capture-check.mjs` records what that costs and the argument
 * transfers exactly: "A verification that costs a ceremony is one that does not happen." Fixtures are the
 * ground truth `npm run eval` measures against, so a fixture nobody can cheaply recapture is a fixture that
 * silently goes stale — and a stale fixture is a measurement of a pipeline that no longer exists.
 *
 * Nothing is lost by going over HTTP: the fixture IS the capture result, which the worker returns.
 *
 * ## Two defects inherited from `capture-books.mjs`, both silent
 *
 * Its output directory was `resolve(process.cwd(), "src/eval/fixtures/books")` — a path the `packages/`
 * restructure moved. `mkdirSync(..., { recursive: true })` would happily CREATE that directory next to
 * wherever you stood and write fixtures into it, where nothing reads them: the fixtures it existed to
 * maintain would never update, and it would report success doing it. Same defect as the one
 * `normalise-fleet.mjs` carries a comment about, in the same session it was found there.
 *
 * And `.c8rc.json` already described that file as "drives a live worker over HTTP", which it never did. A
 * description is not a feature.
 *
 * Paths here resolve from `import.meta.url`, so they are right from any working directory.
 *
 * ## Commit what it writes, from the machine that wrote it
 *
 * Fixtures are tracked files, so a recapture leaves the checkout it ran in modified — and a later
 * `git merge --ff-only` there aborts with "your local changes would be overwritten", even when the incoming
 * content is byte-identical to what was committed from somewhere else. That happened: the lab recaptured,
 * the fixtures were committed from a laptop, and the lab then silently refused every subsequent pull, so a
 * gate re-run measured code from three commits earlier and reported the same failure it had already fixed.
 *
 * Compare hashes before resolving it. If the committed copy matches, `git checkout --` the fixture directory
 * and pull; if it does not, the newer capture is the one to keep and commit.
 */
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CAPTURE_CLIENT_TIMEOUT_MS, assertWorkerUrl } from "@a11y-witness/worker-fleet/worker-http";
import { hostPagesBase } from "@a11y-witness/worker-fleet/host-address";
import { leasePageServer } from "../training/page-server.mjs";
import { refuseUnknownFlags, flagValue } from "@a11y-witness/worker-fleet/cli-flags";
import { captureTolerantly } from "@a11y-witness/worker-fleet/capture-client";

/**
 * recaptures the eval fixtures. `--ff-only` appears in this file because it is passed to GIT, not
 * because it is a flag of this command.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--set=", "--only=", "--worker="], { entry: import.meta.url, command: "npm run eval:capture" });

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = resolve(HERE, "../eval");
const DEFAULT_STEPS = 150;
const DEFAULT_PAGES_PORT = 5050;

/**
 * A named `--flag=value`, or the fallback.
 *
 * `fallback` is typed rather than inferred: defaulting to `null` infers exactly `null`, so every call
 * that supplies a real default -- a page set, a step count, a worker from the environment -- became the
 * type error, which is the argument that matters most here.
 *
 * @param {string} name
 * @param {string | number | null} [fallback]
 */
// audit §9 "argv parsing": was its own copy of the fifteen-file idiom, now the shared, tested extractor.
const arg = (name, fallback = null) => flagValue(process.argv, name) ?? fallback;

/** Every `.html` in a page set, so a page added to the directory is captured without editing a list here. */
function pagesIn(/** @type {any} */ set) {
  const dir = resolve(EVAL_ROOT, "pages", set);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""))
    .sort();
}

/** One capture, over the worker's own HTTP interface — the path production uses. */
async function captureOverWorker(/** @type {any} */ url, /** @type {any} */ worker, /** @type {any} */ steps) {
  const response = await captureTolerantly({
    worker,
    // `probeForms` ON: these are OUR pages, written to be activated, and the interaction criteria
    // (3.3.1, 4.1.3) are structurally unreachable without it. That is the same rule the Action follows
    // and the opposite of the real-page corpus, where the page belongs to somebody else.
    body: { url, steps, probeForms: true, probeFocus: true },
    timeoutMs: CAPTURE_CLIENT_TIMEOUT_MS,
  });
  const data = response.json ?? {};
  if (data.error) throw new Error(`${data.error}${data.fault ? ` (fault: ${data.fault})` : ""}`);
  return data;
}

/** In-process, for the Windows guest. Imported lazily so this file loads on a Mac or on Linux. */
async function captureInProcess(/** @type {any} */ url, /** @type {any} */ steps) {
  const { captureWithNvda } = await import("@a11y-witness/nvda-worker");
  return captureWithNvda(url, { steps, probeForms: true });
}

function report(/** @type {any} */ name, /** @type {any} */ result, /** @type {any} */ outPath) {
  const i = result.interaction ?? {};
  const events = (i.stateChanges ?? []).length + (i.formChanges ?? []).length;
  process.stdout.write(`  wrote ${name.padEnd(22)} ${String(result.transcript?.length ?? 0).padStart(4)}`
    + ` phrase(s), ${events} interaction event(s)\n`);
  // Named, not counted: an empty transcript is the shape a failed capture takes, and a fixture written
  // from one would make a working page look broken for as long as nobody recaptured it.
  if (!result.transcript?.length) process.stdout.write(`  WARNING ${name}: 0 phrases — do NOT ship this fixture\n`);
  return outPath;
}

async function main() {
  const set = String(arg("set", "tutorials"));
  const only = arg("only");
  const steps = Number(arg("steps", DEFAULT_STEPS));
  const workerArg = arg("worker", process.env.A11Y_WORKER ?? null);
  const worker = workerArg ? assertWorkerUrl(String(workerArg), { source: "--worker" }) : null;

  const names = pagesIn(set).filter((/** @type {string} */ n) => !only || n.includes(String(only)));
  if (!names.length) {
    process.stderr.write(`no pages in ${set}${only ? ` matching --only=${only}` : ""}\n`);
    process.exit(2);
  }
  const outDir = resolve(EVAL_ROOT, "fixtures", set);
  mkdirSync(outDir, { recursive: true });

  // Leased the same way a real run does, rather than assuming somebody left a server up — a stale manual
  // `npx serve` is how this project once began capturing Edge's error page and reporting success.
  const lease = worker
    ? await leasePageServer({ root: resolve(EVAL_ROOT, "pages", set), port: DEFAULT_PAGES_PORT,
                              probePath: `${names[0]}.html` })
    : null;
  const base = worker ? hostPagesBase(worker, DEFAULT_PAGES_PORT) : pathToFileURL(resolve(EVAL_ROOT, "pages", set)).href;
  process.stdout.write(`Recapturing ${names.length} fixture(s) from ${set}\n`
    + `  via   ${worker ?? "in-process NVDA (this machine)"}\n  pages ${base}\n  out   ${outDir}\n\n`);

  const failed = [];
  try {
    for (const name of names) {
      const url = `${base}/${name}.html`;
      try {
        const result = worker ? await captureOverWorker(url, worker, steps) : await captureInProcess(url, steps);
        const outPath = resolve(outDir, `${name}.json`);
        writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
        report(name, result, outPath);
      } catch (error) {
        failed.push(`${name}: ${/** @type {any} */ (error).message.split("\n")[0]}`);
        process.stdout.write(`  FAILED  ${name}: ${/** @type {any} */ (error).message.split("\n")[0]}\n`);
      }
    }
  } finally {
    if (lease) await lease.release();
  }

  process.stdout.write(`\n${names.length - failed.length}/${names.length} recaptured\n`);
  for (const line of failed) process.stdout.write(`  ${line}\n`);
  process.exit(failed.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
