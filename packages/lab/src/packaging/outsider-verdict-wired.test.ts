/**
 * THE SWAP IS ATOMIC (#3184, ADR 0042 decision 6): the rehearsal marker stopped blocking a publish and the outsider job's verdict took its
 * place in ONE pull request. Five things are pinned here, each with the fixture that must be REFUSED beside the one that must pass:
 *
 *   1. `package.json`: neither gate chain names `release:rehearsal-check`, and BOTH still name `release:provenance` and `scorer:verify`, so
 *      the swap cannot have removed more than it meant to.
 *   2. `registry-consumer-gate.yml` has a job that runs the verdict reader on `schedule`, `workflow_run` and `workflow_dispatch`, holds
 *      `issues: write` and nothing broader, and reads no secret (a planted `A11IGN_BOT_TOKEN` is refused).
 *   3. The job's DECISION: `red` and `absent` past the window fail it, `green` and `pending` inside the window pass, and the filing of
 *      the `regression` row is idempotent per version. The positive control for "the marker no longer refuses" is here: the same
 *      staleness that exits 0 from `release:rehearsal-check` (`rehearsal-currency-gate.test.ts`) exits non-zero from a `red` verdict.
 *   4. The outside repository's name is declared ONCE, in `scripts/outsider/repository.json`, and appears in no workflow literally.
 *   5. RELEASE.md's rehearsal section says what the swap made true.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { outsiderVerdict, outsiderRunTitle } from "../../../../scripts/outsider/verdict.mjs";
import {
  filingPlan, jobDecision, readOutsiderRepository, regressionBody, regressionTitle, REGRESSION_LABEL,
} from "../../../../scripts/outsider/verdict-job.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(resolve(REPO, path), "utf8");
const SCRIPTS: Record<string, string> = JSON.parse(read("package.json")).scripts;
const WORKFLOWS = ".github/workflows";
const GATE_WORKFLOW = `${WORKFLOWS}/registry-consumer-gate.yml`;
const DRIVER = "scripts/outsider/verdict-job.mjs";

// ---- 1. the chains ---------------------------------------------------------------------------------------

const RETIRED = "release:rehearsal-check";
const KEPT = ["release:provenance", "scorer:verify"];
const CHAINS = ["release:gate:ci", "release:gate"];

/** The npm scripts a shell chain runs, in order. */
const stagesOf = (chain: string) => [...chain.matchAll(/pnpm(?:\.mjs)? run ([a-z0-9:_-]+)/g)].map((m) => m[1]);

/** What is wrong with `scripts`'s two gate chains, as the swap leaves them. `[]` means nothing is wrong. */
function chainProblems(scripts: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const name of CHAINS) {
    const stages = stagesOf(scripts[name] ?? "");
    if (stages.length === 0) problems.push(`${name} runs no stages at all`);
    if (stages.includes(RETIRED)) problems.push(`${name} still runs ${RETIRED}`);
    for (const kept of KEPT) if (!stages.includes(kept)) problems.push(`${name} no longer runs ${kept}`);
  }
  const elsewhere = Object.entries(scripts)
    .filter(([name, value]) => !CHAINS.includes(name) && stagesOf(value).includes(RETIRED)).map(([name]) => name);
  if (elsewhere.length > 0) problems.push(`${elsewhere.join(", ")} runs ${RETIRED}, which publishes nothing and gates nothing`);
  return problems;
}

test("#3184: neither gate chain names release:rehearsal-check, and both still name provenance and the scorer's verify", () => {
  assert.deepEqual(chainProblems(SCRIPTS), []);
  assert.ok(SCRIPTS[RETIRED], "the command KEEPS its name and becomes a reading, so it is still a script");
});

test("#3184: a chain with the rehearsal check still in it, or with a kept stage gone, is REFUSED (positive control for the line above)", () => {
  const stillThere = { ...SCRIPTS, "release:gate": `${SCRIPTS["release:gate"]} && node scripts/pnpm.mjs run ${RETIRED}` };
  assert.match(chainProblems(stillThere).join("\n"), /release:gate still runs release:rehearsal-check/);
  const swapped = { ...SCRIPTS, "release:gate:ci": SCRIPTS["release:gate:ci"].replace(" && node scripts/pnpm.mjs run release:provenance", "") };
  assert.match(chainProblems(swapped).join("\n"), /release:gate:ci no longer runs release:provenance/);
  const verifyGone = { ...SCRIPTS, "release:gate": SCRIPTS["release:gate"].replace("node scripts/pnpm.mjs run scorer:verify && ", "") };
  assert.match(chainProblems(verifyGone).join("\n"), /release:gate no longer runs scorer:verify/);
  const aThirdChain = { ...SCRIPTS, "release:publish": `node scripts/pnpm.mjs run ${RETIRED}` };
  assert.match(chainProblems(aThirdChain).join("\n"), /release:publish runs release:rehearsal-check/);
});

test("no workflow runs release:rehearsal-check either: release.yml reaches the gate through `release:gate:ci` and nothing else", () => {
  const offenders = readdirSync(resolve(REPO, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f))
    // The parsed strings, so a header comment that says the check was RETIRED is not one that runs it.
    .filter((f) => strings(parseYaml(read(`${WORKFLOWS}/${f}`))).some((text) => text.includes(RETIRED)));
  assert.deepEqual(offenders, []);
  assert.ok(readdirSync(resolve(REPO, WORKFLOWS)).includes("release.yml"), "the scan found the release workflow it exists to read");
});

// ---- 2. the job in the workflow --------------------------------------------------------------------------

type Step = { run?: string; env?: Record<string, string> };
type Job = { permissions?: Record<string, string>; steps?: Step[] };
type Doc = { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> };
const gateWorkflow = (): Doc => parseYaml(read(GATE_WORKFLOW)) as Doc;

/** Every string a parsed workflow holds, so a comment that MENTIONS a secret is not one that reads it. */
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object") return Object.values(node).flatMap(strings);
  return [];
}

const WIDEST_ALLOWED = { contents: "read", issues: "write" };

/** What is wrong with the verdict job in `doc`. `[]` means nothing is. */
function jobProblems(doc: Doc): string[] {
  const problems: string[] = [];
  const triggers = Object.keys(doc.on);
  for (const wanted of ["schedule", "workflow_run", "workflow_dispatch"]) {
    if (!triggers.includes(wanted)) problems.push(`the workflow is not triggered by ${wanted}`);
  }
  const job = doc.jobs.outsider;
  if (!job) return [...problems, "the workflow has no `outsider` job"];
  const runs = (job.steps ?? []).map((step) => step.run ?? "").join("\n");
  if (!/outsider:verdict|scripts\/outsider\/verdict-job\.mjs/.test(runs)) problems.push("the `outsider` job never runs the verdict reader");
  const granted = (job.permissions ?? {}) as Record<string, string>;
  if (granted.issues !== "write") problems.push("the `outsider` job does not hold `issues: write`, which filing the row needs");
  for (const [scope, level] of Object.entries(granted)) {
    if (WIDEST_ALLOWED[scope as keyof typeof WIDEST_ALLOWED] !== level) problems.push(`the \`outsider\` job holds \`${scope}: ${level}\`, broader than it needs`);
  }
  for (const [scope, level] of Object.entries(doc.permissions ?? {})) {
    if (level !== "read") problems.push(`the workflow's own permissions hold \`${scope}: ${level}\`: the one write scope belongs to the job`);
  }
  const secrets = [...new Set(strings(doc).flatMap((text) => [...text.matchAll(/secrets\.[A-Za-z0-9_]+/g)].map((m) => m[0])))];
  if (secrets.length > 0) problems.push(`the workflow reads ${secrets.join(", ")}: no \`secrets.\` reference is allowed, \`github.token\` only`);
  return problems;
}

test("#3184: registry-consumer-gate.yml has a job that runs the verdict reader on schedule, workflow_run and dispatch, with issues: write and no secret", () => {
  assert.deepEqual(jobProblems(gateWorkflow()), []);
});

test("#3184: the job is REFUSED when a trigger, the reader, the scope or the token is wrong (positive controls for the line above)", () => {
  const withMutation = (change: (doc: Doc) => void): string => {
    const doc = gateWorkflow();
    change(doc);
    return jobProblems(doc).join("\n");
  };
  assert.match(withMutation((d) => { delete d.on.schedule; }), /not triggered by schedule/);
  assert.match(withMutation((d) => { delete d.on.workflow_run; }), /not triggered by workflow_run/);
  assert.match(withMutation((d) => { delete d.on.workflow_dispatch; }), /not triggered by workflow_dispatch/);
  assert.match(withMutation((d) => { delete d.jobs.outsider; }), /no `outsider` job/);
  assert.match(withMutation((d) => { d.jobs.outsider.steps = [{ run: "echo nothing" }]; }), /never runs the verdict reader/);
  assert.match(withMutation((d) => { d.jobs.outsider.permissions = { contents: "read" }; }), /does not hold `issues: write`/);
  assert.match(withMutation((d) => { d.jobs.outsider.permissions!.contents = "write"; }), /`contents: write`, broader than it needs/);
  assert.match(withMutation((d) => { d.jobs.outsider.permissions!["pull-requests"] = "write"; }), /`pull-requests: write`, broader/);
  assert.match(withMutation((d) => { d.permissions = { contents: "read", issues: "write" }; }), /workflow's own permissions hold `issues: write`/);
  const planted = withMutation((d) => { d.jobs.outsider.steps!.at(-1)!.env!.GH_TOKEN = "${{ secrets.A11IGN_BOT_TOKEN }}"; });
  assert.match(planted, /secrets\.A11IGN_BOT_TOKEN/, "a planted bot token is REFUSED");
});

// ---- 3. the job's decision -------------------------------------------------------------------------------

const SHA = "b373d1d7d0f830175bbef30decee214ea64594b7";
const VERSION = "0.1.1";
const HOUR_MS = 3_600_000;
const NOW = Date.parse("2026-10-04T00:00:00Z");
const run = (conclusion: string | null, status = "completed") =>
  ({ displayTitle: outsiderRunTitle({ version: VERSION, sha: SHA }), status, conclusion, createdAt: "2026-10-03T14:00:00Z" });
const facts = (runs: ReturnType<typeof run>[], hoursSincePublish: number) => ({
  latest: VERSION, tagSha: SHA, publishedAt: new Date(NOW - hoursSincePublish * HOUR_MS).toISOString(), now: new Date(NOW).toISOString(), runs,
});

const FIXTURES = {
  green: facts([run("success")], 12),
  red: facts([run("failure")], 12),
  pendingInsideWindow: facts([], 2),
  absentPastWindow: facts([], 30),
};

test("#3184: a fixture `red` and a fixture `absent`-past-window each FAIL the job's decision and owe a row", () => {
  for (const name of ["red", "absentPastWindow"] as const) {
    const decision = jobDecision(outsiderVerdict(FIXTURES[name]));
    assert.deepEqual({ fails: decision.fails, files: decision.files }, { fails: true, files: true }, name);
  }
});

test("#3184: `green` and `pending` inside the window PASS, and the pending one says which version and how old", () => {
  const green = jobDecision(outsiderVerdict(FIXTURES.green));
  assert.deepEqual(green, { fails: false, files: false, notice: null });
  const pending = jobDecision(outsiderVerdict(FIXTURES.pendingInsideWindow));
  assert.equal(pending.fails, false);
  assert.equal(pending.files, false);
  assert.match(pending.notice ?? "", new RegExp(`v${VERSION.replace(/\./g, "\\.")}`), "the notice names the version");
  assert.match(pending.notice ?? "", /published 2\.0 h ago/, "and its age");
});

test("an unknown verdict THROWS: a decision that guessed would be the one that passes on a bad day", () => {
  assert.throws(() => jobDecision({ verdict: "maybe", reason: "?" } as never), /unknown verdict/);
});

test("#3184: the regression row is filed ONCE per version: a second call for the same version files nothing", () => {
  const first = filingPlan({ version: VERSION, existingTitles: [] });
  assert.equal(first.file, true);
  const second = filingPlan({ version: VERSION, existingTitles: [first.title] });
  assert.equal(second.file, false, "the row the first call filed is what stops the second");
  assert.match(second.reason, /already exists/);
  assert.equal(filingPlan({ version: "0.1.2", existingTitles: [first.title] }).file, true, "a DIFFERENT version is a different row");
  assert.notEqual(regressionTitle("0.1.1"), regressionTitle("0.1.10"), "the title never matches a longer version by prefix");
});

test("the regression row says the version is already published, that no publish is refused, and names the run; it is labelled `regression`", () => {
  const result = outsiderVerdict(FIXTURES.red);
  const body = regressionBody({ version: VERSION, tagSha: SHA, result, outsiderRepository: "owner/repo", runUrl: "https://example.invalid/runs/1" });
  assert.match(body, /already on the registry/);
  assert.match(body, /does not stop the next publish/);
  assert.match(body, /https:\/\/example\.invalid\/runs\/1/);
  assert.match(body, /^## Region\n\nnone --/m, "born valid under the filing contract");
  assert.equal(REGRESSION_LABEL, "regression");
});

/** The command itself, driven from a fixture of the four facts: it never reaches the network and never files. */
function runDriver(fixture: object): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "outsider-verdict-wired-"));
  try {
    const file = join(dir, "facts.json");
    writeFileSync(file, JSON.stringify(fixture));
    const out = execFileSync(process.execPath, [resolve(REPO, DRIVER)], { encoding: "utf8", env: { ...process.env, A11Y_OUTSIDER_FACTS: file } });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("#3184 acceptance 1's positive control: the command EXITS non-zero on `red` and on `absent`, and 0 on `green` and `pending`", () => {
  const results = Object.fromEntries(Object.entries(FIXTURES).map(([name, fixture]) => [name, runDriver(fixture).code]));
  // Exact, not "0 or 1": a command that exited 0 for everything, or 1 for everything, would satisfy the looser form.
  assert.deepEqual(results, { green: 0, red: 1, pendingInsideWindow: 0, absentPastWindow: 1 });
  const red = runDriver(FIXTURES.red);
  assert.match(red.out, /would file: Outsider job did not pass for a11ign v0\.1\.1/, "a fixture prints the filing and never makes one");
  assert.match(red.out, /does not refuse a publish/);
});

test("the command's exit is 1 for a fact it cannot read, never 0: a malformed version is not a green", () => {
  const { code, out } = runDriver({ ...FIXTURES.green, latest: "not-a-version" });
  assert.equal(code, 1);
  assert.match(out, /could not be read/);
});

// ---- 4. the repository's name, declared once -------------------------------------------------------------

const REPOSITORY_FILE = "scripts/outsider/repository.json";

test("#3184: the outside repository is declared ONCE, in repository.json, and no workflow names it literally", () => {
  const declared = JSON.parse(read(REPOSITORY_FILE));
  assert.deepEqual(Object.keys(declared), ["repository"], "one key: a second field is a second place to drift");
  assert.equal(declared.repository, "a11ign-labs/a11ign-consumer-check", "the repository #3182 stood up");
  assert.equal(readOutsiderRepository(resolve(REPO, REPOSITORY_FILE)), declared.repository);
  const driver = read(DRIVER);
  assert.ok(driver.includes("repository.json"), "the reader the job runs takes the name from the file");
  assert.ok(!driver.includes(declared.repository), "and does not restate it");
  const workflows = readdirSync(resolve(REPO, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(workflows.length > 0, "the scan found workflows to read");
  assert.ok(workflows.includes("registry-consumer-gate.yml"), "the scan reaches the workflow that runs the job");
  const offenders = workflows.filter((f) => read(`${WORKFLOWS}/${f}`).includes(declared.repository));
  assert.deepEqual(offenders, []);
});

test("a name that is not an owner/name is REFUSED rather than read as some other repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "outsider-repository-"));
  try {
    for (const bad of ['{"repository": "just-a-name"}', '{"repository": "a/b/c"}', '{"repository": 7}', "{}"]) {
      const file = join(dir, "repository.json");
      writeFileSync(file, bad);
      assert.throws(() => readOutsiderRepository(file), /owner\/name/, bad);
    }
    writeFileSync(join(dir, "good.json"), '{"repository": "owner/name"}');
    assert.equal(readOutsiderRepository(join(dir, "good.json")), "owner/name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 5. RELEASE.md ---------------------------------------------------------------------------------------

/** The rehearsal section: from its heading to the next `## ` heading. */
function rehearsalSection(releaseMd: string): string {
  const start = releaseMd.indexOf("### The V1 rehearsal");
  assert.ok(start >= 0, "RELEASE.md has a V1 rehearsal section");
  const end = releaseMd.indexOf("\n## ", start);
  return releaseMd.slice(start, end === -1 ? undefined : end);
}

test("#3184: RELEASE.md's rehearsal section no longer frames the rehearsal as a step before a publish, and links the ADR and the weekly review", () => {
  const section = rehearsalSection(read("RELEASE.md"));
  assert.doesNotMatch(section, /publish-for-real/);
  assert.doesNotMatch(section, /Owner: whoever/, "nothing is typed and nothing waits, so nobody owns a wait");
  assert.doesNotMatch(section, /the release waits on the reading/);
  assert.match(section, /docs\/adr\/0042-the-v1-rehearsal-splits-into-an-automated-outsider-job-and-a-weekly-review\.md/);
  const links = [...section.matchAll(/\]\((docs\/[^)#]+|scripts\/[^)#]+)\)/g)].map((m) => m[1]);
  for (const target of ["docs/weekly-review.md", "scripts/weekly-review.mjs"]) {
    assert.ok(links.includes(target), `the section links ${target}`);
  }
  for (const link of links) assert.ok(existsSync(resolve(REPO, link)), `${link} is a file that exists`);
});

test("#3184: the NOT verified entry says what a release now claims, and never 'rehearsed'", () => {
  const releaseMd = read("RELEASE.md");
  // Whitespace folded: the entry is hard-wrapped, and a phrase that breaks across a line is still the phrase.
  const notVerified = releaseMd.slice(releaseMd.indexOf("## NOT verified"), releaseMd.indexOf("## Known limitations")).replace(/\s+/g, " ");
  assert.match(notVerified, /released with the outsider job's verdict on this version read as/);
  assert.match(notVerified, /judgement review last read `N` days ago/);
  assert.doesNotMatch(notVerified, /release:rehearsal-check/, "the old entry's REFUSES claim about the command is gone");
});

test("the marker stays in RELEASE.md as the record of the last hand rehearsal, and still parses", () => {
  assert.match(read("RELEASE.md"), /<!-- REHEARSAL:COMMIT [0-9a-f]{40} -->/);
});
