import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_FILE, checkMjsRatchet, findBaselineRoot, type Baseline } from "@a11ign/toolchain/mjs-ratchet";

/**
 * The count of `.js`/`.mjs`/`.cjs` source files may only go down (ADR 0043; a11ign/a11ign#4243, adopted here by #4262). The rule and the reading live in `@a11ign/toolchain`;
 * what is this repository's is the committed `mjs-ratchet.baseline.json`. The baseline is found by walking up from THIS file, so the flatten (#4215) moves the test without editing it.
 */
const HERE = fileURLToPath(import.meta.url);

const baselineOf = (root: string): Baseline => JSON.parse(readFileSync(join(root, BASELINE_FILE), "utf8"));

/** A scratch tree holding one empty file per basename the real baseline lists, each in its own directory (so repeated names stay distinct), and `baseline` beside them. No `.git`, so the tool walks it. */
function treeHolding({ names, baseline }: { names: string[]; baseline: Baseline }): string {
  const root = mkdtempSync(join(tmpdir(), "mjs-ratchet-"));
  names.forEach((name, index) => {
    mkdirSync(join(root, `d${index}`));
    writeFileSync(join(root, `d${index}`, name), "");
  });
  writeFileSync(join(root, BASELINE_FILE), JSON.stringify(baseline));
  return root;
}

function checkedIn(tree: string): ReturnType<typeof checkMjsRatchet> {
  try {
    return checkMjsRatchet({ from: join(tree, "d0") });
  } finally {
    rmSync(tree, { recursive: true });
  }
}

const real = baselineOf(findBaselineRoot(HERE));

test("the repository's real tree holds no more .js/.mjs/.cjs source than its committed baseline", () => {
  const result = checkMjsRatchet({ from: HERE });
  assert.ok(result.ok, result.message);
});

test("the positive control: the baseline is a real reading, not an empty list that would pass an empty read", () => {
  assert.ok(real.files.length > 0, "an empty baseline would make every other control here vacuous");
  assert.equal(checkMjsRatchet({ from: HERE }).baselineCount, real.files.length);
});

test("a scratch tree that matches the baseline passes (so the failures below are caused by what they change)", () => {
  const result = checkedIn(treeHolding({ names: real.files, baseline: real }));
  assert.ok(result.ok, result.message);
  assert.equal(result.count, real.files.length);
});

test("a baseline with one name removed fails and NAMES the file", () => {
  const [removed, ...rest] = real.files;
  const result = checkedIn(treeHolding({ names: real.files, baseline: { ...real, files: rest } }));
  assert.equal(result.ok, false);
  assert.ok(result.message.includes(removed), `the failure must name ${removed}:\n${result.message}`);
});

test("a baseline listing a file the tree lacks passes and says it can be lowered", () => {
  const [, ...kept] = real.files;
  const result = checkedIn(treeHolding({ names: kept, baseline: real }));
  assert.ok(result.ok, result.message);
  assert.match(result.message, /can be lowered to /);
});

test("an exception with no `why` fails", () => {
  const names = ["only.mjs", ".pnpmfile.cjs"];
  const reasoned = { files: ["only.mjs"], exceptions: [{ path: "d1/.pnpmfile.cjs", why: "pnpm reads only that name" }] };
  const unreasoned = { files: reasoned.files, exceptions: [{ path: "d1/.pnpmfile.cjs", why: "" }] };
  assert.ok(checkedIn(treeHolding({ names, baseline: reasoned })).ok, "the reasoned exception is the positive control");
  const result = checkedIn(treeHolding({ names, baseline: unreasoned }));
  assert.equal(result.ok, false);
  assert.match(result.message, /has no `why`/);
});
