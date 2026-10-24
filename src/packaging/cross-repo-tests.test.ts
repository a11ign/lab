import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { crossRepoReasons, crossRepoTests, rstestSelection, testFiles } from "../../scripts/cross-repo-tests.ts";
import { workflowCode } from "./workflow-code.ts";

// The fixtures are built from pieces: a literal `new URL("../../` or a tool call in THIS file would make it a cross-repo test itself, and the classifier's own test must run in the required leg.
const readAbove = (up: string) => ["const ROOT = ", "new", " URL(", `"${up}"`, ", import.meta.url);"].join("");
const toolCall = ["await tool", "Module(", '"src/x.mjs"', ");"].join("");

test("a path read above the lab root is cross-repo, one inside it is not (a11ign/a11ign#4588)", () => {
  // src/packaging/x.test.ts is two levels below the lab root: "../../" is the root, "../../../" is the core's packages directory.
  assert.deepEqual(crossRepoReasons(readAbove("../../../../"), "src/packaging/x.test.ts", "/lab"), ["reads ../../../../"]);
  assert.deepEqual(crossRepoReasons(readAbove("../../"), "src/packaging/x.test.ts", "/lab"), [], "the lab root itself is the lab's own tree");
  assert.deepEqual(crossRepoReasons(readAbove("../../scripts/x.ts"), "src/packaging/x.test.ts", "/lab"), []);
});

test("an import of the pinned core's code is not a read of its tree, and a use of the tool is", () => {
  // Built from pieces for the same reason as `readAbove`: a literal `from "../../../guards/src/y.ts"` in this file is an import the layer-edge walk reads as a real reach into the core.
  const importOfTheCore = ["import { x } from ", '"', "../../../guards/src/y.ts", '"', ";"].join("");
  assert.deepEqual(crossRepoReasons(importOfTheCore, "src/packaging/x.test.ts", "/lab"), []);
  assert.deepEqual(crossRepoReasons(toolCall, "src/packaging/x.test.ts", "/lab"), ["uses the tool"]);
});

test("the real tree: both populations exist, and the tests that went red on a moving tree are in the cross-repo one", () => {
  const all = testFiles();
  const cross = crossRepoTests();
  // POSITIVE CONTROL for the emptiness reads below: neither side is vacuous.
  assert.ok(cross.length > 0 && cross.length < all.length, `cross-repo ${cross.length} of ${all.length}: both legs must have tests`);
  // The tests that read the core's tree were retired under a11ign/a11ign#4425 phase 3 (#5435), so they cannot be named here.
  for (const known of ["layer-edges", "acceptance-reads-the-live-body"]) {
    assert.ok(cross.includes(`src/packaging/${known}.test.ts`), `${known} reads another tree and must not block a pull request`);
  }
  assert.ok(!cross.includes("src/packaging/cross-repo-tests.test.ts"), "the classifier's own test stays in the required leg");
});

test("the two legs partition the tests: `own` excludes exactly what `cross-repo` includes", () => {
  const own = rstestSelection("own");
  const crossLeg = rstestSelection("cross-repo");
  assert.deepEqual(own.slice(0, 2), ["--include", "packages/lab/**/*.test.ts"]);
  assert.deepEqual(own.slice(2).filter((_, at) => at % 2 === 1).sort(), crossLeg.filter((_, at) => at % 2 === 1).sort());
  assert.equal(own.slice(2).filter((_, at) => at % 2 === 0).every((flag) => flag === "--exclude"), true);
});

test("ci.yml runs both legs, only `cross-repo` may fail without failing the job, and it also runs on push and nightly", () => {
  const ci = workflowCode("ci.yml");
  assert.match(ci, /scope: \[own, cross-repo\]/);
  assert.match(ci, /continue-on-error: \$\{\{ matrix\.scope == 'cross-repo' \}\}/);
  assert.match(ci, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.match(ci, /^ {2}schedule:\n {4}- cron: "[^"]+"$/m);
  assert.match(ci, /cross-repo-tests\.ts --scope=\$\{\{ matrix\.scope \}\}/);
  assert.match(readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"), /read -ra selection/);
});

type Job = { needs?: string[]; steps?: { run?: string }[] };
const ciJobs = (): Record<string, Job> => (parse(readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8")) as { jobs: Record<string, Job> }).jobs;

// Read from the parsed workflow, not from its text: the retirement is a fact about which jobs exist and what `gate` waits for and reads (A11-127), and a comment or a renamed step must not move it.
test("ci.yml: `refusalOwners` is retired, `gate` waits for exactly the jobs it reads, and reads every one of them", () => {
  const jobs = ciJobs();
  const gate = jobs["gate"];
  assert.ok(gate, "control: `gate` is found, so the reads below are not over an empty workflow");
  assert.ok(!("refusalOwners" in jobs), "the refusal-owner job is retired with the old gate: rows live in Linear, so it could only fail");
  assert.deepEqual(gate.needs, ["changeset", "checks", "release-dry-run"], "the required check waits for `checks` and for the release dry run (a11ign/a11ign#5063), and for nothing retired");
  for (const need of gate.needs ?? []) assert.ok(need in jobs, `\`gate\` waits for \`${need}\`, which is not a job of ci.yml`);
  const run = (gate.steps ?? []).map((step) => step.run ?? "").join("\n");
  const read = [...run.matchAll(/needs\.([A-Za-z0-9_-]+)\.result/g)].map((match) => match[1]).sort();
  assert.deepEqual([...new Set(read)], [...(gate.needs ?? [])].sort(), "`gate` reads the result of every job it waits for and of no other: a job it needs and never reads is excused by its own failure, and a read of a job it does not need is always empty");
});
