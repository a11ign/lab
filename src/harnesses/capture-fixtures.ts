// @ts-check
/**
 * Recapture eval fixtures — through the fleet job service, or in-process on the capture guest.
 *
 *     npm run eval:capture -- --label=<ticket key> --box=a11y-worker-14 --wait=30m --set=tutorials
 *     npm run eval:capture -- --label=<ticket key> --wait=30m --only=menus      # one box, whichever is free
 *     npm run eval:capture -- --collect[=<job ID>]                              # write the fixtures of a job that has finished
 *     npm run eval:capture -- --set=books            # in-process; guest only, interactive session
 *
 * FLEET MODE (A11-263): the fixtures of a set are ONE group of a fleet job, so they come from one box, in order, and the box is booked. The client records the job ID,
 * waits once if it was told to (`--wait=`, `A11Y_FLEET_WAIT`), and writes `src/eval/fixtures/<set>/<name>.json` from the job's manifest; with no wait it prints the ID and exits 75.
 * The box is a NAME (`--box=`), never an address, and `--boxes=1` when none is named.
 *
 * ## Why a worker mode exists
 *
 * This replaces `capture-books.mjs`, which could only capture in-process and therefore only on the Windows
 * guest in an interactive desktop session. `capture-check.ts` records what that costs and the argument
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

import { leasePageServer } from "../training/page-server.mjs";
import { refuseUnknownFlags, flagValue } from "@a11ign/screenreader-fleet/cli-flags";
import { refuseIfRunsReadonly, repeatCapturesRoot } from "../dataset-paths.ts";
import { fleetRequested, pagesBaseUrl, whyNoCapture } from "../fleet/fleet-job.ts";
import type { FleetCase } from "../fleet/fleet-job.ts";
import type { Collector } from "../fleet/capture-flow.ts";
import { holdingPages, runFleetClient } from "../fleet/harness-flow.ts";
import type { Loose } from "../capture/loose.ts";

/**
 * recaptures the eval fixtures. `--ff-only` appears in this file because it is passed to GIT, not
 * because it is a flag of this command.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--set=", "--only=", "--steps=", "--box=", "--boxes=", "--label=", "--wait=", "--collect", "--worker="], { entry: import.meta.url, command: "npm run eval:capture" });

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
 */
// audit §9 "argv parsing": was its own copy of the fifteen-file idiom, now the shared, tested extractor.
const arg = (name: string, fallback: string | number | null = null) => flagValue(process.argv, name) ?? fallback;

/** Every `.html` in a page set, so a page added to the directory is captured without editing a list here. */
function pagesIn(set: Loose) {
  const dir = resolve(EVAL_ROOT, "pages", set);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""))
    .sort();
}

/**
 * The body each fixture is captured with. `probeForms` ON: these are OUR pages, written to be activated, and the interaction criteria (3.3.1, 4.1.3) are structurally unreachable without
 * it. That is the same rule the Action follows and the opposite of the real-page corpus, where the page belongs to somebody else.
 */
export const fixtureBody = (steps: number): Record<string, unknown> => ({ steps, probeForms: true, probeFocus: true });

/** The fixtures of a set as the cases of ONE group: one box, in file order. A fixture is the ground truth `npm run eval` measures against, and a set from one machine is one population. */
export function fixtureCases(names: readonly string[], base: string, steps: number, set: string): FleetCase[] {
  return names.map((name) => ({ id: name, url: `${base}/${name}.html`, body: fixtureBody(steps), group: set }));
}

/** In-process, for the Windows guest. Imported lazily so this file loads on a Mac or on Linux. */
async function captureInProcess(url: Loose, steps: Loose) {
  const { captureWithNvda } = await import("@a11ign/screenreader-worker");
  return captureWithNvda(url, { steps, probeForms: true });
}

function report(name: Loose, result: Loose, outPath: Loose) {
  const i = result.interaction ?? {};
  const events = (i.stateChanges ?? []).length + (i.formChanges ?? []).length;
  process.stdout.write(`  wrote ${name.padEnd(22)} ${String(result.transcript?.length ?? 0).padStart(4)}`
    + ` phrase(s), ${events} interaction event(s)\n`);
  // Named, not counted: an empty transcript is the shape a failed capture takes, and a fixture written
  // from one would make a working page look broken for as long as nobody recaptured it.
  if (!result.transcript?.length) process.stdout.write(`  WARNING ${name}: 0 phrases — do NOT ship this fixture\n`);
  return outPath;
}

/** What this client's pending files are filed under, so `--collect` reads a fixtures job and never another client's. */
const JOB_KIND = "capture-fixtures";
const FLEET_ROOT = resolve(repeatCapturesRoot(), "capture-fixtures");

/** The collector: writes each fixture from the job's manifest, in the shape and the place `npm run eval` reads, and says what failed. */
export function fixtureCollector(): Collector {
  return async (fetched, pending) => {
    const { set, outDir } = pending.extra as { set: string; outDir: string };
    mkdirSync(outDir, { recursive: true });
    const failed: string[] = [];
    const entries = fetched.manifest.captures.filter((c) => c.case);
    for (const entry of entries) {
      const name = entry.case as string;
      const record = fetched.record(entry);
      const result = (entry.status === "done" ? record?.capture : null) as Loose | null;
      if (!result || result.error) {
        // The worker's own fault, with its code, as the old client reported it.
        const why = result?.error ? `${result.error}${result.fault ? ` (fault: ${result.fault})` : ""}` : whyNoCapture(entry, record);
        failed.push(`${name}: ${why.split("\n")[0]}`);
        process.stdout.write(`  FAILED  ${name}: ${why.split("\n")[0]}\n`);
        continue;
      }
      const outPath = resolve(outDir, `${name}.json`);
      writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
      report(name, result, outPath);
    }
    process.stdout.write(`\n${entries.length - failed.length}/${entries.length} recaptured from ${set} on ${[...new Set(entries.map((e) => e.box))].join(", ") || "no box"}\n`);
    for (const line of failed) process.stdout.write(`  ${line}\n`);
    return { recapture: [], exit: failed.length ? 1 : 0 };
  };
}

async function main() {
  const set = String(arg("set", "tutorials"));
  const only = arg("only");
  const steps = Number(arg("steps", DEFAULT_STEPS));
  // `--box=` names a box of the fleet, so a run that gives it and no label is a fleet run that the label refusal catches, not an in-process capture that ignores the box.
  const fleet = fleetRequested(process.argv.slice(2), process.env) || process.argv.some((a) => a.startsWith("--box=") || a.startsWith("--boxes="));
  const collecting = process.argv.some((a) => a === "--collect" || a.startsWith("--collect="));

  const names = collecting ? [] : pagesIn(set).filter((n: string) => !only || n.includes(String(only)));
  if (!collecting && !names.length) {
    process.stderr.write(`no pages in ${set}${only ? ` matching --only=${only}` : ""}\n`);
    process.exit(2);
  }
  const outDir = resolve(EVAL_ROOT, "fixtures", set);

  if (fleet) {
    refuseIfRunsReadonly(FLEET_ROOT);
    process.exit(await runFleetClient({
      argv: process.argv.slice(2), root: FLEET_ROOT, kind: JOB_KIND, oneBox: {},
      hint: (job) => `npm run eval:capture -- --collect=${job}`,
      prepare: async () => {
        // Leased the same way a real run does, rather than assuming somebody left a server up — a stale manual `npx serve` is how this project once began capturing Edge's error page and
        // reporting success. The BOXES fetch the pages, so the base is the address they reach this host on.
        const lease = await leasePageServer({ root: resolve(EVAL_ROOT, "pages", set), port: DEFAULT_PAGES_PORT, probePath: `${names[0]}.html` });
        return holdingPages(lease, () => {
          const base = pagesBaseUrl(process.env, DEFAULT_PAGES_PORT);
          process.stdout.write(`Recapturing ${names.length} fixture(s) from ${set}\n  pages ${base}\n  out   ${outDir}\n\n`);
          return { cases: fixtureCases(names, base, steps, set), groups: { [set]: {} }, extra: { set, outDir } };
        });
      },
      collect: fixtureCollector(),
    }));
  }

  mkdirSync(outDir, { recursive: true });
  const base = pathToFileURL(resolve(EVAL_ROOT, "pages", set)).href;
  process.stdout.write(`Recapturing ${names.length} fixture(s) from ${set}\n`
    + `  via   in-process NVDA (this machine)\n  pages ${base}\n  out   ${outDir}\n\n`);

  const failed = [];
  for (const name of names) {
    const url = `${base}/${name}.html`;
    try {
      const result = await captureInProcess(url, steps);
      const outPath = resolve(outDir, `${name}.json`);
      writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
      report(name, result, outPath);
    } catch (error) {
      failed.push(`${name}: ${(error as Error).message.split("\n")[0]}`);
      process.stdout.write(`  FAILED  ${name}: ${(error as Error).message.split("\n")[0]}\n`);
    }
  }

  process.stdout.write(`\n${names.length - failed.length}/${names.length} recaptured\n`);
  for (const line of failed) process.stdout.write(`  ${line}\n`);
  process.exit(failed.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
