/**
 * A STAND-IN `fleet` COMMAND FOR TESTS (A11-263): a script the tests write and point `FLEET` at, so a lab client is driven end to end against a stubbed service and
 * nothing reaches the control plane.
 *
 * It does what the real command's contract says and nothing more:
 *
 * - `capture submit --cases <file> --boxes <b> --label <l>` and `job recapture <id> --cases <a,b> --label <l>` print the next job ID from the config, ahead of the hint the
 *   real command prints on stderr for a person at a terminal;
 * - `job wait <id> --timeout <d>` exits with the code the config gives that job (0 by default);
 * - `job fetch <id> --to <dir>` copies the fixture results directory the config names for that job into `<dir>/<id>/`, which is what the real command's tar stream does;
 * - every call is appended to a log as one JSON line, and the cases file of a submit is kept beside it, so a test can say exactly what was asked.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StubConfig = {
  /** The IDs `capture submit` and `job recapture` print, in order. */
  ids: string[];
  /** `job wait` exits with this for a job; absent means 0. */
  waitCodes?: Record<string, number>;
  /** The results directory `job fetch` copies for a job. */
  fixtures?: Record<string, string>;
  /** A job ID `capture submit` and `job recapture` refuse with this message instead of printing. */
  refuse?: string;
};

export type StubCall = { argv: string[]; at: string };

const SCRIPT = `#!${process.execPath}
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const config = JSON.parse(readFileSync(process.env.STUB_CONFIG, "utf8"));
const dir = process.env.STUB_DIR;
const argv = process.argv.slice(2);
const log = join(dir, "calls.jsonl");
let before = "";
try { before = readFileSync(log, "utf8"); } catch {}
writeFileSync(log, before + JSON.stringify({ argv, at: new Date().toISOString() }) + "\\n");
const state = join(dir, "state.json");
let used = 0;
try { used = JSON.parse(readFileSync(state, "utf8")).used; } catch {}
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const next = () => {
  if (config.refuse) { process.stderr.write(config.refuse + "\\n"); process.exit(2); }
  const id = config.ids[used];
  if (!id) { process.stderr.write("the stub has no more job IDs\\n"); process.exit(2); }
  writeFileSync(state, JSON.stringify({ used: used + 1 }));
  return id;
};
const [group, sub, id] = argv;
if (group === "capture" && sub === "submit") {
  const job = next();
  writeFileSync(join(dir, "cases-" + job + ".json"), readFileSync(flag("--cases")));
  process.stdout.write(job + "\\n");
  process.stderr.write("submitted as " + job + "; follow it with: fleet job wait " + job + " --timeout 30m\\n");
} else if (group === "job" && sub === "recapture") {
  const job = next();
  writeFileSync(join(dir, "recapture-" + job + ".json"), JSON.stringify({ source: id, cases: flag("--cases").split(","), label: flag("--label") }));
  process.stdout.write(job + "\\n");
} else if (group === "job" && sub === "wait") {
  process.exit(config.waitCodes?.[id] ?? 0);
} else if (group === "job" && sub === "fetch") {
  const fixture = config.fixtures?.[id];
  if (!fixture) { process.stderr.write("no fixture for " + id + "\\n"); process.exit(2); }
  const to = join(flag("--to"), id);
  mkdirSync(to, { recursive: true });
  cpSync(fixture, to, { recursive: true });
  process.stdout.write(to + "\\n");
} else {
  process.stderr.write("the stub does not know: " + argv.join(" ") + "\\n");
  process.exit(2);
}
`;

/** Write the stub into `dir` and return what a test needs: the path to put in `FLEET`, the env that makes it find its config, and readers for what it was asked. */
export function stubFleet(dir: string, config: StubConfig) {
  mkdirSync(dir, { recursive: true });
  const script = join(dir, "fleet");
  const configFile = join(dir, "config.json");
  writeFileSync(script, SCRIPT, "utf8");
  chmodSync(script, 0o755);
  writeFileSync(configFile, JSON.stringify(config), "utf8");
  return {
    script,
    env: { FLEET: script, STUB_CONFIG: configFile, STUB_DIR: dir } as Record<string, string>,
    calls: (): StubCall[] => {
      try { return readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as StubCall); } catch { return []; }
    },
    submittedCases: (job: string) => JSON.parse(readFileSync(join(dir, `cases-${job}.json`), "utf8")) as { cases: { id: string; url: string; body: Record<string, unknown>; group?: string }[]; groups: Record<string, unknown> },
    recaptured: (job: string) => JSON.parse(readFileSync(join(dir, `recapture-${job}.json`), "utf8")) as { source: string; cases: string[]; label: string },
  };
}

/** A manifest in the shape the service writes for a job of cases (control `manifest.ts`): enough of it for a client to read, and no more. */
export function manifestFixture(
  { job, recaptureOf = null, state = "done", boxes, captures }:
  {
    job: string; recaptureOf?: string | null; state?: string;
    boxes: { name: string; workerCode?: string | null; environment?: Record<string, unknown> | null }[];
    captures: { case: string; group: string; url: string; box: string; status?: "done" | "failed" | "skipped"; attempt?: number; error?: string | null; body?: Record<string, unknown> }[];
  },
) {
  return {
    version: 2, job, label: "A11-263", state, reason: null, submittedAt: "2026-10-25T00:00:00.000Z", startedAt: "2026-10-25T00:00:01.000Z", finishedAt: "2026-10-25T00:10:00.000Z",
    pages: [], passes: 1, body: {}, recaptureOf,
    cases: captures.map((c) => ({ id: c.case, url: c.url, group: c.group, body: c.body ?? {}, attempt: c.attempt ?? 1 })),
    freeze: null, pins: {},
    boxes: boxes.map((b) => ({
      name: b.name, workerCode: b.workerCode ?? null, windowsBuild: null, edge: null, nvda: null, read: true,
      environment: b.environment === undefined ? { browser: "Edge", browserVersion: "151" } : b.environment,
    })),
    dropped: [], agreement: { consistent: true, mismatches: [], reportedOnly: [], compared: 0 }, notes: [],
    captures: captures.map((c) => ({
      page: c.url, pass: 1, case: c.case, group: c.group, attempt: c.attempt ?? 1, file: `${c.case}.a${c.attempt ?? 1}.json`, box: c.box, status: c.status ?? "done",
      startedAt: null, finishedAt: null, httpStatus: c.status === "failed" ? 0 : c.status === "skipped" ? null : 200, error: c.error ?? null, note: c.status === "skipped" ? "environment matches skipWhen" : null,
    })),
  };
}

/** Write a results directory as `fleet job fetch` leaves it: `manifest.json` and one record per capture that has one. */
export function writeResults(dir: string, manifest: ReturnType<typeof manifestFixture>, capturesByCase: Record<string, unknown>): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  for (const entry of manifest.captures) {
    if (entry.status === "skipped") continue;
    const capture = capturesByCase[entry.case as string];
    writeFileSync(join(dir, entry.file), `${JSON.stringify({
      capturedAt: "2026-10-25T00:05:00.000Z", worker: entry.box, status: entry.status === "done" ? 200 : 0,
      capture: entry.status === "failed" ? { error: entry.error ?? "failed" } : capture,
    })}\n`, "utf8");
  }
  return dir;
}
