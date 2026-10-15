/**
 * The lab's copy of `refuseUnknownFlags` must refuse what the shared one refuses (a11ign/lab#127; row a11ign/a11ign#5516).
 *
 * `scripts/refuse-unknown-flags.ts` is a deliberate copy: the nightly unit runs the release scripts from a checkout with no
 * `node_modules`, where `@a11ign/screenreader-fleet/cli-flags` does not resolve. Nothing else ties the two together, so a change
 * to one that the other does not follow would pass every test here. Each argument vector runs in its own child process, because
 * the function calls `process.exit`, and the exit code and stderr are compared.
 *
 * One difference exists today: the shared function names the nearest known flag (`— did you mean --json?`) and the copy does
 * not. It is a known divergence, reported on the row rather than fixed here, so it is ASSERTED BY NAME on the cases that
 * trigger it: the hint must be exactly the one listed, and the copy's stderr must equal the shared stderr with that hint
 * removed. Any other difference, or the hint changing, appearing on the copy, or disappearing from the shared function, fails.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SHARED = pathToFileURL(createRequire(import.meta.url).resolve("@a11ign/screenreader-fleet/cli-flags")).href;
const COPY = new URL("../../scripts/refuse-unknown-flags.ts", import.meta.url).href;

// The known divergence: the shared function's did-you-mean hint, which the copy does not print.
const DID_YOU_MEAN = / — did you mean \S+\?/g;
const HINT_TO_JSON = " — did you mean --json?";

type Case = {
  name: string;
  argv: string[];
  exit: number;
  known?: string[];
  elsewhere?: boolean;
  // The hints the shared function prints on this argv, which the copy does not; listed so a change to them is a failure.
  hints?: string[];
};

const KNOWN = ["--json", "--timeout="];
// `exit` is pinned for the shared function too, so two copies that agree on something wrong (both exiting 0) still fail.
const CASES: Case[] = [
  { name: "no flags", argv: [], exit: 0 },
  { name: "a known flag", argv: ["--json"], exit: 0 },
  { name: "a known --name=value", argv: ["--timeout=30"], exit: 0 },
  { name: "an unknown long flag", argv: ["--nope"], exit: 2, hints: [HINT_TO_JSON] },
  { name: "an unknown short flag", argv: ["-x"], exit: 2 },
  { name: "the -- terminator alone", argv: ["--"], exit: 0 },
  { name: "an unknown flag after --", argv: ["--", "--nope"], exit: 2, hints: [HINT_TO_JSON] },
  { name: "a script that takes no flags", argv: ["--nope"], known: [], exit: 2 },
  { name: "an unknown flag when entry is not the invoked file", argv: ["--nope"], elsewhere: true, exit: 0 },
];

// The driver is the entry point, so its `entry` is its own URL, as a real command passes `import.meta.url`. Both copies run
// under the file name `driver.mjs`, which the default `command` prints, so that name cannot be the difference.
const driverSource = (moduleUrl: string): string => [
  `import { refuseUnknownFlags } from ${JSON.stringify(moduleUrl)};`,
  "const { known, elsewhere } = JSON.parse(process.env.CASE);",
  'refuseUnknownFlags(known, { entry: elsewhere ? "file:///not-the-invoked-file.mjs" : import.meta.url });',
].join("\n");

function runDriver(root: string, label: string, moduleUrl: string, testCase: Case) {
  const dir = join(root, label);
  mkdirSync(dir);
  const driver = join(dir, "driver.mjs");
  writeFileSync(driver, driverSource(moduleUrl));
  const env = {
    ...process.env,
    CASE: JSON.stringify({ known: testCase.known ?? KNOWN, elsewhere: testCase.elsewhere === true }),
  };
  const result = spawnSync(process.execPath, [driver, ...testCase.argv], { env, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

function runBoth(testCase: Case) {
  const root = mkdtempSync(join(tmpdir(), "refuse-copy-"));
  try {
    return {
      shared: runDriver(root, "shared", SHARED, testCase),
      copy: runDriver(root, "copy", COPY, testCase),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const testCase of CASES) {
  test(`${testCase.name}: the copy refuses as the shared refuseUnknownFlags does`, () => {
    const { shared, copy } = runBoth(testCase);
    const argv = JSON.stringify(testCase.argv);
    assert.equal(shared.status, testCase.exit,
      `the shared function's exit on argv ${argv}; its stderr was:\n${shared.stderr}`);
    assert.deepEqual(shared.stderr.match(DID_YOU_MEAN) ?? [], testCase.hints ?? [],
      `the shared function's did-you-mean hint on argv ${argv} is not the known one (row a11ign/a11ign#5516)`);
    assert.deepEqual(
      { status: copy.status, stderr: copy.stderr },
      { status: shared.status, stderr: shared.stderr.replace(DID_YOU_MEAN, "") },
      `the copy diverges from the shared refuseUnknownFlags on argv ${argv}`,
    );
  });
}
