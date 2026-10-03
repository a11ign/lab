// no-token: gh -- every test below drives pure functions or reads two committed files; the one `gh api` read
// (`ghApiRead`, in `gh-api-read.mjs`) is reached only from the live test, which returns before it unless
// `A11Y_CHECK_MAIN_RULESET=1`, and the acceptance job sets neither that nor a token.
/**
 * #3123 (ADR 0039 item 5): EVERY CODE REPOSITORY CARRIES THE REVIEW REQUIREMENT AND THE MERGE QUEUE, AND
 * THAT IS PROVABLE BEFORE ITS FIRST PUSH.
 *
 * `branch-protection.test.ts` read exactly one repository, `a11ign/a11ign`, from five literals. A second
 * code repository could therefore be unprotected -- or empty, as `a11ign/screenreader-worker` was created,
 * with no branch, no rule and no ruleset -- with every check green, and a push to a public repository is
 * published the moment it lands. This file is the part of that guard which is about the SET of repositories
 * rather than about one of them.
 *
 * ONE LIST, NOT TWO. `.agent-org/project.json`'s `code` array is the declared list of code repositories,
 * and the `agent-org` tool owns its schema. It carries `key` and `repo` only, so the two facts this guard
 * needs and the tool does not hold -- a default branch and a required check name -- live in
 * `docs/code-repository-protection.json`, KEYED BY `repo`. The ADR's own `docs/code-repositories.json` is
 * deliberately not created: item 2 landed as the `code` array, and a second list is a second place to
 * forget a repository.
 *
 * WHAT IS ASSERTED, in the order a reader needs it:
 *
 *   1. every repository in the `code` array has an entry here (a REFUSAL, naming the one that has not);
 *   2. the live read, opt-in under `A11Y_CHECK_MAIN_RULESET=1` exactly as in `branch-protection.test.ts`,
 *      reads every entry and names each missing surface. An unreadable repository is CANNOT_TELL, never a
 *      pass: `404` from these endpoints means absent OR forbidden, so only a branch that is READ as absent
 *      may be called absent, and anything else is "could not look".
 *
 * WHAT THE LIVE READ DOES NOT CLAIM. It reads the surfaces a token without admin can read (the ruleset's
 * rules) and TRIES the one it cannot (classic protection, admin-only). `PARTLY_READ` is a named verdict
 * for that case and lists what was not read, because "the rule exists" and "nobody is exempt" are different
 * claims (`.claude/rules/main-review-requirement.md`): the exemption half is `branch-protection.test.ts`'s,
 * whose instrument the creation runbook (`docs/new-code-repository.md`) says to name.
 *
 * THE ONE THING THIS DOES NOT DO is create anything. Making the ruleset and the protection is an admin's
 * act, and the first push is the one unprotected write.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ghApiRead } from "./gh-api-read.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PROJECT_FILE = ".agent-org/project.json";
const PROTECTION_FILE = "docs/code-repository-protection.json";
/** The guard that must stop naming a repository: the row's done-when 1, scanned below. */
const GUARD = "packages/lab/src/packaging/branch-protection.test.ts";
/** The one repository whose literal the guard used to carry. */
const FORMER_LITERAL = "a11ign/a11ign";

type Entry = { repo: string; defaultBranch: string; requiredCheck: string };
type ProtectionFile = { repositories: Entry[] };
type ProjectFile = { code: { key: string; repo: string }[] };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(REPO_ROOT, path), "utf8")) as T;

// --- the declaration: every listed repository has an entry ------------------------------------------------

const OWNER_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** What is wrong with the entries themselves, one sentence each; empty means every entry is usable. */
function entryProblems(entries: Entry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.repo !== "string" || !OWNER_NAME.test(entry.repo)) {
      problems.push(`an entry's \`repo\` is not owner/name: ${JSON.stringify(entry.repo)}`);
      continue;
    }
    if (seen.has(entry.repo)) problems.push(`${entry.repo} has two entries, so which default branch is read is a coin toss`);
    seen.add(entry.repo);
    for (const field of ["defaultBranch", "requiredCheck"] as const) {
      const value: unknown = entry[field];
      if (typeof value !== "string" || value.trim() === "") problems.push(`${entry.repo} has no \`${field}\``);
    }
  }
  return problems;
}

/** The declared repositories that no entry covers. A repository nobody can read is not a protected one. */
function uncovered(declared: string[], entries: Entry[]): string[] {
  const covered = new Set(entries.map((e) => e.repo));
  return declared.filter((repo) => !covered.has(repo));
}

const declaredRepositories = (): string[] => readJson<ProjectFile>(PROJECT_FILE).code.map((c) => c.repo);
const protectionEntries = (): Entry[] => readJson<ProtectionFile>(PROTECTION_FILE).repositories;

test("#3123 ANTI-VACUITY: the declared list is non-empty, so the coverage assertion below has something to cover", () => {
  // THE POSITIVE CONTROL for every emptiness assertion in this file: `uncovered(...) === []` passes just as
  // well when the declared list was read as empty. This one fails on that, and so does the fixture below.
  assert.ok(declaredRepositories().length >= 1, `${PROJECT_FILE} declares no code repository, or the read is broken`);
  assert.ok(protectionEntries().length >= 1, `${PROTECTION_FILE} has no entry, or the read is broken`);
});

test("#3123: every code repository in `.agent-org/project.json` has an entry with a default branch and a check", () => {
  const entries = protectionEntries();
  assert.deepEqual(uncovered(declaredRepositories(), entries), [],
    `a code repository has no entry in ${PROTECTION_FILE}: the live read would have nothing to read, and the nightly `
    + "would skip it silently. Add its default branch and its required check name");
  assert.deepEqual(entryProblems(entries), []);
});

test("#3123 POSITIVE CONTROL: a declared repository with no entry is REFUSED, and the refusal names it", () => {
  const fixtureEntries: Entry[] = [{ repo: "a11ign/has-an-entry", defaultBranch: "main", requiredCheck: "gate" }];
  const missing = uncovered(["a11ign/has-an-entry", "a11ign/has-none"], fixtureEntries);
  assert.deepEqual(missing, ["a11ign/has-none"]);
  // And the control is not a spelling of the real assertion passing: the real list against the fixture fails.
  assert.notDeepEqual(uncovered(declaredRepositories(), fixtureEntries), []);
});

test("#3123: a malformed or duplicated entry is a problem, each one named", () => {
  const entries = [
    { repo: "a11ign/twice", defaultBranch: "main", requiredCheck: "gate" },
    { repo: "a11ign/twice", defaultBranch: "main", requiredCheck: "gate" },
    { repo: "a11ign/no-check", defaultBranch: "main", requiredCheck: "" },
    { repo: "not-owner-name", defaultBranch: "main", requiredCheck: "gate" },
  ] as Entry[];
  const problems = entryProblems(entries);
  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /a11ign\/twice has two entries/);
  assert.match(problems.join("\n"), /a11ign\/no-check has no `requiredCheck`/);
  assert.match(problems.join("\n"), /not-owner-name/);
});

// --- done-when 1: the guard names no repository -----------------------------------------------------------

/** The row's own scan: a line that is not a comment line and carries the literal. */
function literalLines(text: string, literal: string): string[] {
  return text.split("\n").filter((line) => line.includes(literal) && !/^\s*(\*|\/\/|\/\*)/.test(line));
}

test("#3123 POSITIVE CONTROL: the literal scan sees a code line and skips a comment line", () => {
  const fixture = [` * prose naming ${FORMER_LITERAL}`, `// ${FORMER_LITERAL}`,
    `  gh(["api", "repos/${FORMER_LITERAL}/branches/main"]);`].join("\n");
  assert.deepEqual(literalLines(fixture, FORMER_LITERAL), [`  gh(["api", "repos/${FORMER_LITERAL}/branches/main"]);`]);
});

test("#3123: `branch-protection.test.ts` carries no repository literal on a non-comment line", () => {
  assert.deepEqual(literalLines(readFileSync(join(REPO_ROOT, GUARD), "utf8"), FORMER_LITERAL), [],
    `${GUARD} names ${FORMER_LITERAL} in code again: it must take its repository from ${PROTECTION_FILE}`);
});

// --- the live read: a verdict per repository, naming each missing surface ---------------------------------

/** One endpoint's answer. `refused` is a 403/404, which means absent OR forbidden and decides nothing alone. */
type Read<T> = { kind: "ok"; value: T } | { kind: "refused" } | { kind: "unreadable"; why: string };
type BranchRule = {
  type: string;
  parameters?: { required_approving_review_count?: number; required_status_checks?: { context: string }[] };
};
type ClassicBody = {
  required_pull_request_reviews?: { required_approving_review_count?: number };
  enforce_admins?: { enabled?: boolean };
  required_status_checks?: { contexts?: string[]; checks?: { context: string }[] };
};
type RepoRead = { branch: Read<unknown>; rules: Read<BranchRule[]>; classic: Read<ClassicBody> };

const STATE = { PRESENT: "PRESENT", ABSENT: "ABSENT", NOT_READ: "NOT_READ" } as const;
type State = (typeof STATE)[keyof typeof STATE];
type Surface = { name: string; state: State; detail: string };

/** A separate vocabulary from `branch-protection.test.ts`'s: none of these is `REQUIRED`, which needs admin. */
const REPO_VERDICT = {
  /** Every surface was read and present. */
  PROTECTED: "PROTECTED",
  /** Every readable surface is present and some were not readable by this identity: said, not hidden. */
  PARTLY_READ: "PARTLY_READ",
  /** At least one surface was READ as absent. Each is named. */
  MISSING: "MISSING",
  /** A read failed for a reason other than the documented absence. Never a pass. */
  CANNOT_TELL: "CANNOT_TELL",
} as const;
type RepoVerdictCode = (typeof REPO_VERDICT)[keyof typeof REPO_VERDICT];

const surface = (name: string, state: State, detail: string): Surface => ({ name, state, detail });

function checkNames(read: RepoRead): { rulesetChecks: string[] | null; classicChecks: string[] | null } {
  const rsc = read.rules.kind === "ok" ? read.rules.value.find((r) => r.type === "required_status_checks") : undefined;
  const classic = read.classic.kind === "ok" ? read.classic.value.required_status_checks : undefined;
  return {
    rulesetChecks: rsc ? (rsc.parameters?.required_status_checks ?? []).map((c) => c.context) : null,
    classicChecks: read.classic.kind === "ok"
      ? [...(classic?.contexts ?? []), ...(classic?.checks ?? []).map((c) => c.context)] : null,
  };
}

function rulesetSurfaces(rules: BranchRule[]): Surface[] {
  const pr = rules.find((r) => r.type === "pull_request");
  const approvals = pr?.parameters?.required_approving_review_count ?? 0;
  return [
    surface("ruleset `pull_request` rule", approvals >= 1 ? STATE.PRESENT : STATE.ABSENT,
      pr ? `requires ${approvals} approval(s)` : "no `pull_request` rule applies to the default branch"),
    surface("ruleset `merge_queue` rule", rules.some((r) => r.type === "merge_queue") ? STATE.PRESENT : STATE.ABSENT,
      rules.some((r) => r.type === "merge_queue") ? "applies" : "no `merge_queue` rule applies to the default branch"),
  ];
}

function classicSurface(read: RepoRead): Surface {
  const name = "classic branch protection";
  if (read.branch.kind === "refused") return surface(name, STATE.ABSENT, "the branch does not exist, so there is nothing to attach it to (measured: 404)");
  if (read.classic.kind === "refused") {
    return surface(name, STATE.NOT_READ, "the endpoint answered 403/404 for a branch that exists: ABSENT or FORBIDDEN, and this identity cannot tell which");
  }
  if (read.classic.kind !== "ok") return surface(name, STATE.NOT_READ, "could not be asked");
  const reviews = read.classic.value.required_pull_request_reviews?.required_approving_review_count ?? 0;
  const admins = read.classic.value.enforce_admins?.enabled === true;
  const ok = reviews >= 1 && admins;
  return surface(name, ok ? STATE.PRESENT : STATE.ABSENT,
    `requires ${reviews} approval(s); enforce_admins ${admins ? "on" : "OFF"} (its exemption list is branch-protection.test.ts's read)`);
}

function checkSurface(read: RepoRead, required: string): Surface {
  const name = `required check \`${required}\``;
  const { rulesetChecks, classicChecks } = checkNames(read);
  if ((rulesetChecks ?? []).includes(required) || (classicChecks ?? []).includes(required)) return surface(name, STATE.PRESENT, "named");
  if (rulesetChecks !== null || classicChecks !== null) return surface(name, STATE.ABSENT, "a readable surface lists checks and this is not among them");
  return read.branch.kind === "refused"
    ? surface(name, STATE.ABSENT, "no branch and no rule, so nothing requires it")
    : surface(name, STATE.NOT_READ, "the ruleset carries no required-checks rule and classic protection was not readable");
}

/** The first read that failed for a reason other than absence, or null. `rules` has no benign refusal. */
function firstUnreadable(read: RepoRead): string | null {
  if (read.branch.kind === "unreadable") return `branches/<default>: ${read.branch.why}`;
  if (read.rules.kind !== "ok") return `rules/branches/<default>: ${read.rules.kind === "unreadable" ? read.rules.why : "refused (absent OR forbidden)"}`;
  if (read.classic.kind === "unreadable") return `branches/<default>/protection: ${read.classic.why}`;
  return null;
}

function repoVerdict(read: RepoRead, entry: Entry): { code: RepoVerdictCode; surfaces: Surface[]; why: string } {
  const failed = firstUnreadable(read);
  if (failed !== null || read.rules.kind !== "ok") {
    return { code: REPO_VERDICT.CANNOT_TELL, surfaces: [], why: `${failed ?? "unreadable"} -- not a pass` };
  }
  const surfaces = [...rulesetSurfaces(read.rules.value), classicSurface(read), checkSurface(read, entry.requiredCheck)];
  const missing = surfaces.filter((s) => s.state === STATE.ABSENT).map((s) => s.name);
  const unread = surfaces.filter((s) => s.state === STATE.NOT_READ).map((s) => s.name);
  if (missing.length > 0) return { code: REPO_VERDICT.MISSING, surfaces, why: `MISSING ${missing.join("; ")}` };
  if (unread.length > 0) return { code: REPO_VERDICT.PARTLY_READ, surfaces, why: `present where readable; NOT READ ${unread.join("; ")}` };
  return { code: REPO_VERDICT.PROTECTED, surfaces, why: "every surface read and present" };
}

// --- fixtures: shapes the live endpoints returned, 2026-10-03 -----------------------------------------------

const GATE: Entry = { repo: "a11ign/fixture", defaultBranch: "main", requiredCheck: "gate" };
/** `a11ign/screenreader-worker` as created: `branches/main` 404 and `rules/branches/main` an empty list. */
const EMPTY_REPO: RepoRead = { branch: { kind: "refused" }, rules: { kind: "ok", value: [] }, classic: { kind: "refused" } };
/** `rules/branches/main` of `a11ign/a11ign`, parameters elided to what is read. */
const BOTH_RULES: BranchRule[] = [{ type: "merge_queue" }, { type: "pull_request", parameters: { required_approving_review_count: 1 } }];
const FULL_CLASSIC: ClassicBody = { required_pull_request_reviews: { required_approving_review_count: 1 },
  enforce_admins: { enabled: true }, required_status_checks: { contexts: ["gate"] } };
const withClassic = (classic: Read<ClassicBody>): RepoRead => ({ branch: { kind: "ok", value: {} }, rules: { kind: "ok", value: BOTH_RULES }, classic });

test("#3123: a repository created empty reads MISSING, and the verdict names every surface that is not there", () => {
  const v = repoVerdict(EMPTY_REPO, GATE);
  assert.equal(v.code, REPO_VERDICT.MISSING);
  for (const name of ["ruleset `pull_request` rule", "ruleset `merge_queue` rule", "classic branch protection", "required check `gate`"]) {
    assert.match(v.why, new RegExp(name.replace(/[`.]/g, "\\$&")), `the verdict did not name ${name}`);
  }
});

test("#3123: both surfaces and the check present reads PROTECTED -- the verdict can be green", () => {
  const v = repoVerdict(withClassic({ kind: "ok", value: FULL_CLASSIC }), GATE);
  assert.equal(v.code, REPO_VERDICT.PROTECTED, v.why);
});

test("#3123: classic protection not readable by this identity is PARTLY_READ and says what was not read, never PROTECTED", () => {
  const v = repoVerdict(withClassic({ kind: "refused" }), GATE);
  assert.equal(v.code, REPO_VERDICT.PARTLY_READ);
  assert.notEqual(v.code, REPO_VERDICT.PROTECTED, "a 404 on the admin endpoint is absent OR forbidden, so it certifies nothing");
  assert.match(v.why, /NOT READ classic branch protection; required check `gate`/);
});

test("#3123: classic protection READ as weak is MISSING even where the ruleset is fine", () => {
  const weak: ClassicBody = { ...FULL_CLASSIC, enforce_admins: { enabled: false } };
  const v = repoVerdict(withClassic({ kind: "ok", value: weak }), GATE);
  assert.equal(v.code, REPO_VERDICT.MISSING);
  assert.match(v.why, /classic branch protection/);
});

test("#3123: a `pull_request` rule that asks for 0 approvals is not the requirement", () => {
  const rules: BranchRule[] = [{ type: "merge_queue" }, { type: "pull_request", parameters: { required_approving_review_count: 0 } }];
  const v = repoVerdict({ ...withClassic({ kind: "ok", value: FULL_CLASSIC }), rules: { kind: "ok", value: rules } }, GATE);
  assert.equal(v.code, REPO_VERDICT.MISSING);
  assert.match(v.why, /ruleset `pull_request` rule/);
});

test("#3123: the required check is read from the ruleset's own rule where classic is not readable", () => {
  // `a11ign/agent-org` carries `gate` as a `required_status_checks` rule, so a non-admin can confirm it.
  const rules: BranchRule[] = [...BOTH_RULES,
    { type: "required_status_checks", parameters: { required_status_checks: [{ context: "gate" }] } }];
  const read: RepoRead = { ...withClassic({ kind: "refused" }), rules: { kind: "ok", value: rules } };
  assert.match(repoVerdict(read, GATE).why, /NOT READ classic branch protection$/);
  const wrong = repoVerdict(read, { ...GATE, requiredCheck: "some-other-check" });
  assert.equal(wrong.code, REPO_VERDICT.MISSING);
  assert.match(wrong.why, /required check `some-other-check`/);
});

test("#3123: an unreadable repository is CANNOT_TELL -- a 404 on `rules` is absent OR forbidden, never 'no rules'", () => {
  for (const [label, read] of [
    ["rules refused", { ...EMPTY_REPO, rules: { kind: "refused" } }],
    ["rules unreadable", { ...EMPTY_REPO, rules: { kind: "unreadable", why: "HTTP 502" } }],
    ["branch unreadable", { ...EMPTY_REPO, branch: { kind: "unreadable", why: "HTTP 500" } }],
    ["classic unreadable", { ...withClassic({ kind: "unreadable", why: "network" }) }],
  ] as [string, RepoRead][]) {
    const v = repoVerdict(read, GATE);
    assert.equal(v.code, REPO_VERDICT.CANNOT_TELL, `${label} must not read as a verdict about the repository`);
    assert.match(v.why, /not a pass/);
  }
});

test("#3123: the four verdicts are genuinely distinct, and none is a spelling of branch-protection's REQUIRED", () => {
  assert.equal(new Set(Object.values(REPO_VERDICT)).size, 4);
  assert.equal((Object.values(REPO_VERDICT) as string[]).includes("REQUIRED"), false);
});

// --- the live read, over every entry ----------------------------------------------------------------------

const ghRead = <T>(path: string): Read<T> => ghApiRead(path) as Read<T>;

function liveRead({ repo, defaultBranch }: Entry): RepoRead {
  return {
    branch: ghRead(`repos/${repo}/branches/${defaultBranch}`),
    rules: ghRead(`repos/${repo}/rules/branches/${defaultBranch}`),
    classic: ghRead(`repos/${repo}/branches/${defaultBranch}/protection`),
  };
}

/**
 * Every declared entry, or ONE repository when `A11Y_PROTECTION_REPO` names it. A repository with no entry --
 * which is what a repository about to be created is -- needs `A11Y_PROTECTION_BRANCH` as well and reads
 * against the first entry's required check, so the read-back can run BEFORE the declaration exists.
 */
function liveTargets(): Entry[] {
  const entries = protectionEntries();
  const only = process.env.A11Y_PROTECTION_REPO;
  if (!only) return entries.filter((e) => declaredRepositories().includes(e.repo));
  const known = entries.find((e) => e.repo === only);
  if (known) return [known];
  const branch = process.env.A11Y_PROTECTION_BRANCH;
  if (!branch) throw new Error(`CANNOT_TELL: ${only} has no entry in ${PROTECTION_FILE}; set A11Y_PROTECTION_BRANCH to read it anyway`);
  return [{ repo: only, defaultBranch: branch, requiredCheck: (entries[0] as Entry).requiredCheck }];
}

test("#3123 LIVE: every code repository carries the review requirement and the merge queue, asked of GitHub", () => {
  // OPT-IN under the SAME switch as `branch-protection.test.ts`'s no-admin read, for the same reason: a test
  // that spawns `gh` whenever a token happens to be present asks GitHub on every local run.
  if (process.env.A11Y_CHECK_MAIN_RULESET !== "1") {
    console.log("  NOT RUN: the live per-repository read is opt-in -- `A11Y_CHECK_MAIN_RULESET=1 npx rstest run --config "
      + "scripts/rstest/rstest.config.mjs --include packages/lab/src/packaging/layer-repository-protection.test.ts "
      + "--disableConsoleIntercept` asks GitHub about every declared repository. Nothing here read one.");
    return;
  }
  const targets = liveTargets();
  assert.ok(targets.length >= 1, "no repository to read: the declared list was empty, and an empty read certifies nothing");
  const bad: string[] = [];
  for (const entry of targets) {
    const v = repoVerdict(liveRead(entry), entry);
    console.log(`  ${v.code} ${entry.repo}@${entry.defaultBranch}: ${v.why}`);
    for (const s of v.surfaces) console.log(`    ${s.state.padEnd(8)} ${s.name} -- ${s.detail}`);
    if (v.code !== REPO_VERDICT.PROTECTED && v.code !== REPO_VERDICT.PARTLY_READ) bad.push(`${entry.repo}: ${v.why}`);
  }
  assert.deepEqual(bad, [], "a repository without both surfaces, or one that could not be read, is not protected");
  console.log(`  LIVE PASS (per-repository) over ${targets.length} repository(ies): ${targets.map((t) => t.repo).join(", ")}`);
});
