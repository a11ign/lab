/**
 * Recapture eval fixtures — over a live worker, or in-process on the capture guest.
 *
 *     npm run eval:capture -- --worker=http://REDACTED-INTERNAL-ADDRESS:8765 --set=tutorials
 *     npm run eval:capture -- --worker=http://REDACTED-INTERNAL-ADDRESS:8765 --only=menus
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
 */
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { requestJson, CAPTURE_CLIENT_TIMEOUT_MS, assertWorkerUrl }
  from "../../../worker-fleet/src/worker-http.mjs";
import { hostPagesBase } from "../../../worker-fleet/src/host-address.mjs";
import { leasePageServer } from "../training/page-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = resolve(HERE, "../eval");
const DEFAULT_STEPS = 150;
const DEFAULT_PAGES_PORT = 5050;

const arg = (name, fallback = null) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

/** Every `.html` in a page set, so a page added to the directory is captured without editing a list here. */
function pagesIn(set) {
  const dir = resolve(EVAL_ROOT, "pages", set);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""))
    .sort();
}

/** One capture, over the worker's own HTTP interface — the path production uses. */
async function captureOverWorker(url, worker, steps) {
  const response = await requestJson(`${worker}/capture`, {
    method: "POST",
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
async function captureInProcess(url, steps) {
  const { captureWithNvda } = await import("@a11y-witness/nvda-worker");
  return captureWithNvda(url, { steps, probeForms: true });
}

function report(name, result, outPath) {
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
  const set = arg("set", "tutorials");
  const only = arg("only");
  const steps = Number(arg("steps", DEFAULT_STEPS));
  const workerArg = arg("worker", process.env.A11Y_WORKER);
  const worker = workerArg ? assertWorkerUrl(workerArg, { source: "--worker" }) : null;

  const names = pagesIn(set).filter((n) => !only || n.includes(only));
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
        failed.push(`${name}: ${error.message.split("\n")[0]}`);
        process.stdout.write(`  FAILED  ${name}: ${error.message.split("\n")[0]}\n`);
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
