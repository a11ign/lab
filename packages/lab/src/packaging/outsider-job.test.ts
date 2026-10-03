/**
 * #3181 (part of #928): the outside repository's job, its generator and its verdict reader. Everything here is a pure
 * function over text or over a run-list fixture; nothing reaches GitHub. The generator's own header says what the job
 * is for and carries the two measurements the row asked for.
 *
 * Each REFUSAL below sits beside a positive control (the real README, the real committed file, a green run) so none of
 * them is a reader that refuses everything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  OUT, OUTSIDER_TARGET, NOT_COVERED, generateOutsiderJob, refuseDriftFromReadme, forbiddenReferences,
  checkCommitted, substitutionList,
} from "../../../../scripts/outsider/generate.mjs";
import { outsiderVerdict, outsiderRunTitle, WINDOW_MS } from "../../../../scripts/outsider/verdict.mjs";
import {
  README_PATH, extractDocumentedJobsBlock, extractPinnedSha, generate as generateConsumerGate,
} from "../../../../scripts/generate-consumer-gate.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";
const readme = readFileSync(README_PATH, "utf8");
const generated = generateOutsiderJob(readme, SHA);

/** @param {string} text @param {string} from @param {string} to */
function replaced(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `the fixture must contain ${JSON.stringify(from)} to mutate it`);
  return text.replace(from, to);
}

/** The README line a fence line sits on, 1-based. */
function readmeLineOf(line: string): number {
  const at = readme.split("\n").indexOf(line);
  assert.notEqual(at, -1, `README.md has no line ${JSON.stringify(line)}`);
  return at + 1;
}

// --- 1. the steps are README's, line for line, but for the ref, the url and the task ---

test("the real README fence generates, and the job it generates equals the fence but for the ref, url and task", () => {
  refuseDriftFromReadme(readme, generated);
  assert.equal(extractPinnedSha(generated), SHA);
});

test("the ref, the url and the task are the ONLY lines free to differ", () => {
  const other = replaced(replaced(replaced(generated, SHA, "f".repeat(40)),
    OUTSIDER_TARGET.url, "https://elsewhere.example/"), OUTSIDER_TARGET.task, "Do something else.");
  refuseDriftFromReadme(readme, other);
});

test("a step ADDED to README's job is refused, naming the README line it displaced", () => {
  const checkout = "      - uses: actions/checkout@v4";
  const mutated = replaced(generated, `${checkout}\n`, `${checkout}\n      - run: echo an extra step\n`);
  assert.throws(() => refuseDriftFromReadme(readme, mutated),
    new RegExp(`README\\.md line ${readmeLineOf(checkout) + 1} reads .*but the workflow has .*an extra step`));
});

test("a step ADDED at the very end of README's job is refused as a line the fence does not have", () => {
  const mutated = replaced(generated, "  # <<< README's job ends", "      - run: echo trailing\n  # <<< README's job ends");
  assert.throws(() => refuseDriftFromReadme(readme, mutated), /has a line README\.md's fence does not.*trailing/);
});

test("a step REMOVED from README's job is refused, naming its README line", () => {
  const upload = "      - uses: actions/upload-artifact@v4";
  const mutated = replaced(generated, `${upload}\n`, "");
  assert.throws(() => refuseDriftFromReadme(readme, mutated), new RegExp(`README\\.md line ${readmeLineOf(upload)} reads`));
});

test("the Action's own step REMOVED is refused too, not read as nothing to compare", () => {
  const mutated = generated.split("\n").filter((line) => !line.includes("uses: a11ign/a11ign@")).join("\n");
  assert.throws(() => refuseDriftFromReadme(readme, mutated), /cannot be read the way README's fence is/);
});

test("a key RENAMED in README's job is refused, naming its README line", () => {
  const id = "        id: a11ign";
  const mutated = replaced(generated, id, "        identifier: a11ign");
  assert.throws(() => refuseDriftFromReadme(readme, mutated),
    new RegExp(`README\\.md line ${readmeLineOf(id)} reads .*"        id: a11ign".*identifier`));
});

test("a job that lost the pin check's `needs:` is refused rather than gating nothing", () => {
  assert.throws(() => refuseDriftFromReadme(readme, replaced(generated, "    needs: [pin]\n", "")), /gates nothing/);
});

test("a fence with one extra step generates a workflow the REAL README refuses", () => {
  const fence = extractDocumentedJobsBlock(readme);
  const changed = readme.replace(fence, replaced(fence, "      - uses: actions/checkout@v4", "      - uses: actions/checkout@v4\n      - run: echo hi"));
  assert.throws(() => refuseDriftFromReadme(readme, generateOutsiderJob(changed, SHA)), /echo hi/);
});

test("a short sha is refused: `uses:` accepts only a full one", () => {
  assert.throws(() => generateOutsiderJob(readme, SHA.slice(0, 7)), /not a full 40-character commit sha/);
});

// --- 2. nothing a reader's own copy could not carry ---

test("the real file carries nothing forbidden, and README's own checkout of the reader's repository is not one", () => {
  assert.deepEqual(forbiddenReferences(generated), []);
  assert.match(generated, /uses: actions\/checkout@v4/, "positive control: README's checkout IS in the file, and is allowed");
  assert.deepEqual(forbiddenReferences(readFileSync(OUT, "utf8")), []);
});

test("a planted secret, repository_dispatch, pull_request_target and foreign checkout are each refused", () => {
  const planted = [
    ["secrets.A11IGN_BOT_TOKEN", replaced(generated, "          GH_REPO:", "          T: ${{ secrets.A11IGN_BOT_TOKEN }}\n          GH_REPO:"), /line \d+ .*secrets\.A11IGN_BOT_TOKEN/],
    ["repository_dispatch", replaced(generated, "on:\n", "on:\n  repository_dispatch:\n"), /line \d+ .*repository_dispatch/],
    ["pull_request_target", replaced(generated, "on:\n", "on:\n  pull_request_target:\n"), /line \d+ .*pull_request_target/],
    ["a checkout of a11ign", replaced(generated, "      - uses: actions/checkout@v4\n", "      - uses: actions/checkout@v4\n        with:\n          repository: a11ign/a11ign\n"), /checkout of a repository other than the one running/],
  ] as const;
  for (const [name, text, expected] of planted) {
    assert.match(forbiddenReferences(text).join("\n"), expected, `${name} must be refused`);
  }
});

test("the run's own token is not a secret this file refuses, so the refusal is not blanket", () => {
  const withOwnToken = replaced(generated, "          GH_REPO:", "          T: ${{ secrets.GITHUB_TOKEN }}\n          GH_REPO:");
  assert.deepEqual(forbiddenReferences(withOwnToken), []);
});

// --- the committed file, the target and the names three things must agree on ---

test("the committed outsider-job.yml is what README generates, pin aside", () => {
  const committed = readFileSync(OUT, "utf8");
  refuseDriftFromReadme(readme, committed);
  assert.deepEqual(checkCommitted(readme, committed), { ok: true });
});

test("the page is the one consumer-gate.yml already uses", () => {
  const consumerGate = generateConsumerGate(readme, SHA);
  assert.ok(consumerGate.includes(OUTSIDER_TARGET.url) && consumerGate.includes(OUTSIDER_TARGET.task));
});

test("the run-name, the poll's title and the reader's title are one string", () => {
  const release = { version: "1.2.3", sha: SHA };
  const runName = /^run-name: \$\{\{ .*format\('(outsider v\{0\} \{1\})'/m.exec(generated)?.[1];
  assert.equal(runName?.replace("{0}", release.version).replace("{1}", release.sha), outsiderRunTitle(release));
  const pollTitle = /^ +title="(.*)"$/m.exec(generated)?.[1];
  assert.equal(pollTitle?.replace("${version}", release.version).replace("${tag_sha}", release.sha), outsiderRunTitle(release));
});

// --- done-when 2: the summary says what it did not cover, and prints the substitution list ---

test("the summary step names every route it did not run, and each document it names exists", () => {
  for (const { document, route } of NOT_COVERED) {
    assert.ok(generated.includes(`- ${document}: ${route}`), `the summary must name ${document}`);
    assert.ok(existsSync(`${REPO}${document}`), `${document} must exist, or the summary names a route nobody can read`);
  }
  assert.equal(NOT_COVERED.length, 3, "README and the other two documents it sends a reader to");
});

test("the summary prints every substituted line by README line, and each README line number is true", () => {
  const fence = extractDocumentedJobsBlock(readme);
  const lines = substitutionList({ readmeText: readme, fence, targeted: extractDocumentedJobsBlock(readme).replace(/^(\s*url:\s*).*$/m, "$1X") });
  assert.equal(lines.length, 2, "one changed line and the generator's own addition");
  const named = /^README\.md line (\d+): `(.*)` became/.exec(lines[0]);
  assert.equal(readme.split("\n")[Number(named?.[1]) - 1].trim(), named?.[2], "positive control: the number points at the line");
  const summary = generated.slice(generated.indexOf("### Substitutions"));
  for (const what of ["uses: a11ign/a11ign@v0.1.0", "url: https://example.com/contact", "task: Send an enquiry"]) {
    assert.ok(summary.includes(`\`- ${what}\``) || summary.includes(`\`${what}\``), `the summary must show ${what} being replaced`);
  }
  assert.match(summary, /- added: `needs: \[pin\]`/);
});

// --- 4. --check ---

test("--check passes on the committed file and exits 0", () => {
  const run = spawnSync("node", ["scripts/outsider/generate.mjs", "--check"], { cwd: REPO, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^OK /);
});

test("--check fails when the committed file differs from what README generates, and prints a diff", () => {
  const drifted = replaced(generated, "timeout-minutes: 20", "timeout-minutes: 45");
  const result = checkCommitted(readme, drifted);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && /^-.*timeout-minutes: 45/m.test(result.diff) && /^\+.*timeout-minutes: 20/m.test(result.diff), "the diff shows both sides");
});

test("--check fails on a missing committed file, and a command line it does not read is refused", () => {
  assert.equal(checkCommitted(readme, "").ok, false);
  const run = spawnSync("node", ["scripts/outsider/generate.mjs", "--chek"], { cwd: REPO, encoding: "utf8" });
  assert.notEqual(run.status, 0);
});

// --- 3. the verdict: green only for a COMPLETED, SUCCESSFUL run named for THIS release ---

const NOW = "2026-10-03T12:00:00Z";
const FRESH = "2026-10-03T10:00:00Z";
const STALE = "2026-10-02T12:00:00Z";
const release = { latest: "0.2.0", tagSha: SHA };
const title = (version: string, sha = SHA) => outsiderRunTitle({ version, sha });
const run = (displayTitle: string, status: string, conclusion: string | null, createdAt = "2026-10-03T10:30:00Z") =>
  ({ displayTitle, status, conclusion, createdAt });
const verdictOf = (runs: ReturnType<typeof run>[], publishedAt = FRESH) =>
  outsiderVerdict({ ...release, publishedAt, now: NOW, runs }).verdict;

test("a completed, successful run for the current version is green, so the refusals are not a reader that never says it", () => {
  assert.equal(verdictOf([run(title("0.2.0"), "completed", "success")]), "green");
});

test("a green run for the PREVIOUS version is never green: pending while the version is young, absent once it is old", () => {
  const previous = [run(title("0.1.0"), "completed", "success")];
  assert.equal(verdictOf(previous), "pending");
  assert.equal(verdictOf(previous, STALE), "absent");
});

test("a run still in progress is pending, even once the version is older than the window", () => {
  assert.equal(verdictOf([run(title("0.2.0"), "in_progress", null)]), "pending");
  assert.equal(verdictOf([run(title("0.2.0"), "queued", null)], STALE), "pending");
});

test("a cancelled run never answered: pending, then absent", () => {
  const cancelled = [run(title("0.2.0"), "completed", "cancelled")];
  assert.equal(verdictOf(cancelled), "pending");
  assert.equal(verdictOf(cancelled, STALE), "absent");
});

test("no run is pending inside the window and absent past it, and absent is never green", () => {
  assert.equal(verdictOf([]), "pending");
  assert.equal(verdictOf([], STALE), "absent");
  assert.ok(Date.parse(NOW) - Date.parse(STALE) > WINDOW_MS && Date.parse(NOW) - Date.parse(FRESH) < WINDOW_MS, "the fixtures straddle the window");
});

test("a failed run is red, and the newest run for the release decides", () => {
  const red = run(title("0.2.0"), "completed", "failure", "2026-10-03T09:00:00Z");
  const green = run(title("0.2.0"), "completed", "success", "2026-10-03T11:00:00Z");
  assert.equal(verdictOf([red]), "red");
  assert.equal(verdictOf([red, green]), "green", "a rerun that fixed it");
  assert.equal(verdictOf([green, { ...red, createdAt: "2026-10-03T11:30:00Z" }]), "red", "a rerun that broke it");
});

test("a run named for the right version but another sha, or a longer version, is not this release's answer", () => {
  assert.equal(verdictOf([run(title("0.2.0", "f".repeat(40)), "completed", "success")]), "pending");
  assert.equal(outsiderVerdict({ latest: "0.2.0", tagSha: SHA, publishedAt: FRESH, now: NOW,
    runs: [run(title("0.2.00"), "completed", "success")] }).verdict, "pending");
  assert.equal(outsiderVerdict({ latest: "0.2.1", tagSha: SHA, publishedAt: FRESH, now: NOW,
    runs: [run(title("0.2.10"), "completed", "success")] }).verdict, "pending");
});

test("green holds for exactly one shape, over every status, conclusion, name and age", () => {
  const statuses = ["queued", "in_progress", "waiting", "completed"];
  const conclusions = [null, "success", "failure", "cancelled", "skipped", "neutral", "timed_out", "stale", "action_required", "startup_failure"];
  const names = [title("0.2.0"), title("0.1.9"), title("0.2.0", "f".repeat(40)), "outsider poll"];
  const cases = statuses.flatMap((status) => conclusions.flatMap((conclusion) => names.flatMap((name) =>
    [FRESH, STALE].map((publishedAt) => ({ status, conclusion, name, publishedAt })))));
  const greens = cases.filter(({ status, conclusion, name, publishedAt }) => {
    const verdict = verdictOf([run(name, status, conclusion)], publishedAt);
    const shouldBeGreen = status === "completed" && conclusion === "success" && name === title("0.2.0");
    assert.equal(verdict === "green", shouldBeGreen, `${status}/${conclusion}/${name}/${publishedAt} read ${verdict}`);
    return verdict === "green";
  });
  assert.equal(greens.length, 2, "positive control: the one shape IS green, at both ages");
});

test("a fact the reader cannot read throws rather than guessing a verdict", () => {
  const facts = { ...release, publishedAt: FRESH, now: NOW, runs: [] };
  assert.throws(() => outsiderVerdict({ ...facts, latest: "latest" }), /not a version/);
  assert.throws(() => outsiderVerdict({ ...facts, tagSha: "abc1234" }), /full 40-character sha/);
  assert.throws(() => outsiderVerdict({ ...facts, publishedAt: "yesterday" }), /not a date/);
  assert.equal(outsiderVerdict(facts).verdict, "pending", "positive control: the same facts, readable");
});
