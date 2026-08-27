/**
 * `promote:model` must REFUSE when a previous promotion is still uncommitted.
 *
 * This is the WIRING half of `promote:gated`, which is `candidate:gate && promote:model`. Its decision
 * half — `releasability()` — is proven in `releasability.test.ts`; the register used to say the wiring
 * was not covered, and it was right.
 *
 * Two documents said it already did. `lab-job.yml`: "it stops at an uncommitted working tree, exactly as
 * `promote-model.mjs` does". CLAUDE.md's command table: "Stops at an uncommitted tree". Measured
 * 2026-08-27 — that file did not import `node:child_process`, so it could never have looked at git. A
 * fact asserted in two places and true in neither, about a guard.
 *
 * What it cost the same day: the lab checkout was dirty with a promotion nobody had committed — weights,
 * both reports and a changeset — so `run-job.yml` correctly declined to pull and every later job ran at
 * the pre-promotion commit or refused. And the promotion that produced that state had already overwritten
 * an earlier one's release note. Nothing stopped the second promotion starting on top of the first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { dirtyTargets, promotionBlockedBy } from "./promotion-targets.mjs";

test("an UNSTAGED modification is found, which is what a stale promotion leaves", () => {
  // ` M path` — the status letters are two columns and the first is a SPACE for an unstaged change. A
  // parser splitting on the first space loses exactly this line, and it is the only one that matters.
  const dirty = dirtyTargets(" M packages/scorer/models/screenreader-scorer/model.safetensors\n");
  assert.deepEqual(dirty, ["packages/scorer/models/screenreader-scorer/model.safetensors"]);
});

test("staged, untracked and renamed entries are all reported by their CURRENT path", () => {
  const dirty = dirtyTargets([
    "M  packages/scorer/models/screenreader-scorer/training-report.json",
    "?? .changeset/promote-candidate-a1b2c3d4.md",
    "R  .changeset/old.md -> .changeset/new.md",
  ].join("\n"));
  assert.deepEqual(dirty, [
    "packages/scorer/models/screenreader-scorer/training-report.json",
    ".changeset/promote-candidate-a1b2c3d4.md",
    ".changeset/new.md",
  ]);
});

test("a clean tree blocks nothing", () => {
  // THE CONTROL. Without it every assertion here is satisfied by a guard that refuses everything, which
  // is the failure mode that gets a guard deleted rather than fixed.
  assert.equal(promotionBlockedBy(dirtyTargets("")), null);
  assert.equal(promotionBlockedBy([]), null);
});

test("the refusal NAMES the files and says where the originals are", () => {
  const message = promotionBlockedBy([
    "packages/scorer/models/screenreader-scorer/model.safetensors",
    ".changeset/promote-candidate-6.md",
  ]);
  assert.ok(message);
  assert.match(message, /model\.safetensors/, "a refusal that does not name the file is a wall");
  assert.match(message, /promote-candidate-6\.md/);
  // The weights exist on ONE machine and `runs/` is gitignored, so "commit or discard" is not advice a
  // reader can act on safely. The fetch command is the part that makes this recoverable.
  assert.match(message, /lab:fetch/, "it must say how to rescue what is already there");
  assert.match(message, /refuse to pull/, "and why a dirty checkout matters beyond this command");
});

/**
 * Tier 2: the COMMAND, against a real git repository planted in a temp directory.
 *
 * The decision above and the wiring fail independently, and this repo's most expensive shape is a correct
 * decision on a path nothing reaches. That is not hypothetical here — the whole defect is that two
 * documents described this guard while no code ran it.
 *
 * `docs/proving-a-gate.md` step 1 is to disbelieve "this needs the lab". It needs `git init` and four
 * small files.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** A repo with a committed shipped model and a candidate ready to promote. */
function plantedRepo(): string {
  // REALPATH, and this is not tidiness. On macOS `/var` is a symlink to `/private/var`, so a script
  // resolving its root from `import.meta.url` (realpath) while its entry guard compares
  // `process.argv[1]` (as given) never matches — `main` does not run, nothing is printed and the exit
  // code is 0. A test written without this reports "the guard did not fire" about a script that never
  // started, which is the same class of wrong answer the guard itself exists to prevent.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "a11y-promote-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");

  // The real script, so this exercises the file that ships — not a copy of its logic.
  for (const rel of ["packages/lab/scripts", "packages/lab/src/packaging",
                     "packages/scorer/models/screenreader-scorer", "runs/model-candidate", ".changeset"]) {
    mkdirSync(join(root, rel), { recursive: true });
  }
  for (const rel of ["packages/lab/scripts/promote-model.mjs",
                     "packages/lab/src/packaging/releasability.mjs",
                     "packages/lab/src/packaging/promotion-targets.mjs"]) {
    cpSync(join(REPO, rel), join(root, rel));
  }
  cpSync(join(REPO, "node_modules"), join(root, "node_modules"), { recursive: true, dereference: false });

  const report = {
    dataset: { records: 2000 },
    outOfDistribution: { inDistributionFloor: 0.7, derivedFloor: 0.55, floorSource: "calibration-set" },
    representation: { encoder: "abc" },
    criteria: {
      "4.1.2": { subtypes: { "4.1.2:state-change-silent": {
        head: "h", threshold: 0.85,
        development: { records: 10, positive: 5, precision: 1, recall: 1, falsePositive: 0 },
      } } },
    },
  };
  const acceptance = { passed: true, evaluated: 10, falsePositive: 0, falseNegative: 0 };
  for (const dir of ["runs/model-candidate", "packages/scorer/models/screenreader-scorer"]) {
    writeFileSync(join(root, dir, "training-report.json"), JSON.stringify(report));
    writeFileSync(join(root, dir, "acceptance-report.json"), JSON.stringify(acceptance));
    // DIFFERENT BYTES on each side, or the copy is invisible to `git status` and the control below
    // passes having proved nothing about whether the weights moved.
    writeFileSync(join(root, dir, "model.safetensors"),
      dir.startsWith("runs/") ? "candidate weights" : "shipped weights");
  }
  writeFileSync(join(root, ".changeset/config.json"), "{}");
  git("add", "-A", "--", "packages", ".changeset");
  git("commit", "-qm", "base");
  return root;
}

const runPromote = (root: string) => {
  try {
    const out = execFileSync(process.execPath,
      [join(root, "packages/lab/scripts/promote-model.mjs"), "--from=candidate"],
      { cwd: root, encoding: "utf8" });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

test("the COMMAND refuses when a previous promotion is still uncommitted", () => {
  const root = plantedRepo();
  try {
    // Exactly the state the lab was found in: promoted weights, uncommitted.
    writeFileSync(join(root, "packages/scorer/models/screenreader-scorer/model.safetensors"), "newer");
    const { code, out } = runPromote(root);
    assert.equal(code, 3, `expected the dirty-tree refusal; got ${code}: ${out}`);
    assert.match(out, /previous promotion is still uncommitted/);
    assert.match(out, /model\.safetensors/, "and it must name what is in the way");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("THE CONTROL: a clean tree promotes, writing the weights and the changeset", () => {
  // Without this the refusal above is satisfied by a command that refuses everything — and it also proves
  // the other half of the wiring the register called unproven: that the weights are actually COPIED.
  const root = plantedRepo();
  try {
    const { code, out } = runPromote(root);
    assert.equal(code, 0, `a clean tree must promote; got ${code}: ${out}`);
    assert.match(out, /Promoted candidate/);
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    assert.match(status, /\.changeset\/promote-candidate-[0-9a-f]{8}\.md/,
      "the changeset must land, under the content-derived name");
    assert.match(status, /packages\/scorer\/models\/screenreader-scorer\//,
      "and the weights must actually be copied, which is the wiring half nothing had watched");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
