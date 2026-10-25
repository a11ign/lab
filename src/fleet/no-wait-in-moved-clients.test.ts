/**
 * A moved capture client waits ONE way, and runs no capture (A11-263).
 *
 * A11-229 slept for 11 hours on `until ! pgrep -f capture_fleet.py`, which matched its own command line, and A11-229 and A11-230 captured on the same boxes at once because
 * nothing booked them. The lab's capture clients now submit to the fleet job service, which books the boxes, and wait with `fleet job wait <id> --timeout <d>` once, which always ends.
 * So the property to keep is an ABSENCE, and an absence is only a check if the scan can be shown to see what it is looking for. The scan strips comments (these files explain
 * the loops they replaced, in words that would otherwise trip it) and its positive control seeds each pattern into a source and requires the scan to find it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LAB = fileURLToPath(new URL("../../", import.meta.url));

/** The clients that moved onto the service, and the modules they are built from. */
const MOVED = [
  "src/training/capture-screenreader-dataset.mjs",
  "src/training/capture-real-pages.mjs",
  "src/training/dataset-fleet.ts",
  "scripts/evidence-check.ts",
  "src/fleet/fleet-job.ts",
  "src/fleet/capture-flow.ts",
  "src/training/wait-for-capture.mjs",
  "src/training/capture-status.mjs",
];

/** What a moved file must not contain, and why each is a wait or a capture the service owns. */
const FORBIDDEN: [string, RegExp][] = [
  ["pgrep", /\bpgrep\b/],
  ["a sleep", /\bsleep\s*\(/],
  ["a timer-driven poll", /\bset(?:Timeout|Interval)\s*\(/],
  ["a file watch", /\b(?:fs\.)?watch\s*\(|watchFile\s*\(/],
  ["a POST to /capture", /["'`][^"'`]*\/capture["'`][^]{0,120}?method:\s*["']POST["']/],
  ["captureTolerantly", /\bcaptureTolerantly\s*\(/],
  ["the pool the clients used to drain", /\bdrainAcrossPool\b|\bwaitForWorker\b|\bacquireDatasetWorkers\b/],
  ["a worker's /health read", /requestJson\s*\(/],
];

/** Code only: comments and string-free prose do not count. Line comments and block comments are removed; a `//` inside a string is rare enough here to leave. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function found(source: string): string[] {
  const code = codeOf(source);
  return FORBIDDEN.filter(([, pattern]) => pattern.test(code)).map(([what]) => what);
}

test("the scan sees each thing it is looking for: seeded into a source, it is found", () => {
  const seeds: Record<string, string> = {
    pgrep: "execSync('pgrep -x capture')",
    "a sleep": "await sleep(1000)",
    "a timer-driven poll": "setInterval(check, 30)",
    "a file watch": "watch(ROOT, () => check())",
    "a POST to /capture": 'fetch(`${worker}/capture`, { method: "POST" })',
    captureTolerantly: "await captureTolerantly({ worker })",
    "the pool the clients used to drain": "await drainAcrossPool({})",
    "a worker's /health read": "await requestJson(url)",
  };
  assert.deepEqual(Object.keys(seeds).sort(), FORBIDDEN.map(([what]) => what).sort(), "every pattern has a seed");
  for (const [what, source] of Object.entries(seeds)) assert.deepEqual(found(source), [what], `the scan must see ${what}`);
  assert.deepEqual(found("// we used to sleep(1000) and pgrep here\n/* setTimeout(x) */\nconst fine = 1;"), [], "and a comment that names them is not code");
});

test("no moved client contains a wait, a poll, a pgrep, a capture of its own or a pool", () => {
  assert.ok(MOVED.length >= 8, "the list this loop walks is the population");
  for (const file of MOVED) {
    const source = readFileSync(join(LAB, file), "utf8");
    assert.ok(source.length > 0, `${file} does not exist`);
    assert.deepEqual(found(source), [], `${file} waits or captures on its own. Submit a job and wait once with \`fleet job wait\` through fleet-job.ts (waitOnce); the service books the boxes.`);
  }
});

test("`fleet job wait` is spelled in ONE lab file, and `waitOnce` is called from one place", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(LAB, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(path); continue; }
      if (/\.(mjs|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(path);
    }
  };
  walk("src"); walk("scripts");
  const spelled = files.filter((file) => /["']job["']\s*,\s*["']wait["']/.test(codeOf(readFileSync(join(LAB, file), "utf8"))));
  assert.deepEqual(spelled, [join("src", "fleet", "fleet-job.ts")], "only the shared client runs `fleet job wait`");
  const callers = files.filter((file) => /\bwaitOnce\s*\(/.test(codeOf(readFileSync(join(LAB, file), "utf8"))) && !file.endsWith("fleet-job.ts"));
  assert.deepEqual(callers, [join("src", "fleet", "capture-flow.ts")], "and only the flow calls it, so a client cannot grow a second wait of its own");
});
