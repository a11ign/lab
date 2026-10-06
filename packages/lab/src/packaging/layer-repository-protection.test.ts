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
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ghApiRead } from "./gh-api-read.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PROJECT_FILE = ".agent-org/project.json";
const PROTECTION_FILE = "docs/code-repository-protection.json";
/** The guard that must stop naming a repository: the row's done-when 1, scanned below. */
const GUARD = "packages/lab/src/packaging/branch-protection.test.ts";
/** The one repository whose literal the guard used to carry. */
const FORMER_LITERAL = "a11ign/a11ign";

/**
 * `tokenProbe`: the workflow file that carries the `token-reach` job (#3710); absent reads the `token` cell CANNOT_TELL.
 * `tokenUnused`: INSTEAD of a probe, why the repository uses `A11IGN_BOT_TOKEN` nowhere. The live read checks it against the
 * repository's workflows, so the claim is read at each run and cannot go stale: a workflow that starts reading the token is DRIFT.
 */
type Entry = { repo: string; defaultBranch: string; requiredCheck: string; publishes: boolean; tokenProbe?: string; tokenUnused?: string };
type ProtectionFile = { repositories: Entry[] };
type ProjectFile = { code: { key: string; repo: string }[]; tracker: { repo: string }[] };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(REPO_ROOT, path), "utf8")) as T;

// --- the declaration: every listed repository has an entry ------------------------------------------------

const WORKFLOW_FILE = /^[A-Za-z0-9_.-]+\.ya?ml$/;
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
    if (typeof entry.publishes !== "boolean") problems.push(`${entry.repo} says nowhere whether it publishes: \`publishes\` must be true or false`);
    problems.push(...tokenFieldProblems(entry));
  }
  return problems;
}

/** What is wrong with an entry's two token fields: a probe file that is no file name, an unused claim with no reason, or both at once. */
function tokenFieldProblems(entry: Entry): string[] {
  const problems: string[] = [];
  if (entry.tokenProbe !== undefined && !WORKFLOW_FILE.test(entry.tokenProbe)) problems.push(`${entry.repo}'s \`tokenProbe\` is not a workflow file name: ${JSON.stringify(entry.tokenProbe)}`);
  if (entry.tokenUnused !== undefined && (typeof entry.tokenUnused !== "string" || entry.tokenUnused.trim() === "")) problems.push(`${entry.repo}'s \`tokenUnused\` must say why the token is unused here`);
  if (entry.tokenUnused !== undefined && entry.tokenProbe !== undefined) problems.push(`${entry.repo} declares both \`tokenProbe\` and \`tokenUnused\`: a repository either uses the token (and probes it) or does not`);
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

/**
 * Repositories that are PROTECTED and have an entry but are not yet in `.agent-org/project.json`'s `code` array,
 * because declaring one is a host act (a `host.json` clone) and not this file's. The coverage assertion above
 * reads only the declared list, so without this one deleting such an entry would stay green (#3176 review).
 * Remove a name from here when `code` declares it: the assertion above covers it from then on.
 */
const protectedBeforeDeclared = ["a11ign/screenreader-worker"];

test("#3176: a repository protected before it is declared still has its entry, with a default branch and a check", () => {
  const entries = protectionEntries();
  assert.deepEqual(uncovered(protectedBeforeDeclared, entries), [],
    `a repository that was seeded and protected has no entry in ${PROTECTION_FILE}: the read-back returns CANNOT_TELL`);
  const covered = entries.filter((e) => protectedBeforeDeclared.includes(e.repo));
  assert.equal(covered.length, protectedBeforeDeclared.length);
  assert.deepEqual(entryProblems(covered), []);
});

test("#3176 POSITIVE CONTROL: the protected-before-declared list is non-empty and is refused against an entry-less file", () => {
  assert.ok(protectedBeforeDeclared.length >= 1, "the list is empty, so the assertion above covers nothing");
  const withoutIt: Entry[] = [{ repo: "a11ign/a11ign", defaultBranch: "main", requiredCheck: "gate", publishes: false }];
  assert.deepEqual(uncovered(protectedBeforeDeclared, withoutIt), protectedBeforeDeclared);
});

test("#3123 POSITIVE CONTROL: a declared repository with no entry is REFUSED, and the refusal names it", () => {
  const fixtureEntries: Entry[] = [{ repo: "a11ign/has-an-entry", defaultBranch: "main", requiredCheck: "gate", publishes: false }];
  const missing = uncovered(["a11ign/has-an-entry", "a11ign/has-none"], fixtureEntries);
  assert.deepEqual(missing, ["a11ign/has-none"]);
  // And the control is not a spelling of the real assertion passing: the real list against the fixture fails.
  assert.notDeepEqual(uncovered(declaredRepositories(), fixtureEntries), []);
});

test("#3123: a malformed or duplicated entry is a problem, each one named", () => {
  const entries = [
    { repo: "a11ign/twice", defaultBranch: "main", requiredCheck: "gate", publishes: false },
    { repo: "a11ign/twice", defaultBranch: "main", requiredCheck: "gate", publishes: false },
    { repo: "a11ign/no-check", defaultBranch: "main", requiredCheck: "", publishes: false },
    { repo: "not-owner-name", defaultBranch: "main", requiredCheck: "gate", publishes: false },
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
    `  readApi(["api", "repos/${FORMER_LITERAL}/branches/main"]);`].join("\n");
  assert.deepEqual(literalLines(fixture, FORMER_LITERAL), [`  readApi(["api", "repos/${FORMER_LITERAL}/branches/main"]);`]);
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

const GATE: Entry = { repo: "a11ign/fixture", defaultBranch: "main", requiredCheck: "gate", publishes: false };
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
  return [{ repo: only, defaultBranch: branch, requiredCheck: (entries[0] as Entry).requiredCheck, publishes: false }];
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

// --- #3705: the settings the page's steps 1, 1b and 8 name, one table of a cell per repository per setting -----

/**
 * `layer-repository-protection`'s surfaces decide whether a merge needs review. They do NOT decide whether a
 * repository can be armed and released, and `toolchain`'s first release run (`release` 37356801652, #3578)
 * died on exactly that, after two settings had been found wrong by hand one at a time. So this is ONE reading
 * of every declared repository against `docs/new-code-repository.md`, each cell `OK`, `DRIFT <read vs the
 * page>` or `CANNOT_TELL <why>`, and a cell that is not `OK` fails. A repository with no row fails too.
 *
 * THE TOKEN'S REACH IS READ FROM A PROBE THAT RAN, NEVER FROM THE TOKEN'S SCOPE (#3710). The org secret and the PAT's
 * scope need an org admin (403 as `a11ign-ai-leads`, read 2026-10-05), and the first reading built on what is
 * visible (a pull request the token's identity once opened or armed) was evidence of a past act and never of
 * current reach. Each repository's `token-reach` job asks the token itself, on the WRITE side, and the cell reads
 * that job's latest run on the default branch. A ref read is no instrument: every code repository is public.
 */
type CellState = "OK" | "DRIFT" | "CANNOT_TELL";
type Cell = { state: CellState; detail: string };
type Row = { repo: string; cells: Record<string, Cell> };

const ok = (detail: string): Cell => ({ state: "OK", detail });
const drift = (detail: string): Cell => ({ state: "DRIFT", detail });
const cannotTell = (detail: string): Cell => ({ state: "CANNOT_TELL", detail });

/** Why a read did not answer, in a sentence: a refusal is absent OR forbidden and decides nothing alone. */
const unreadWhy = (read: Read<unknown>): string =>
  read.kind === "unreadable" ? read.why : "refused (403/404: absent OR forbidden)";

type RepoSettings = Partial<Record<"allow_auto_merge" | "allow_merge_commit" | "allow_squash_merge"
  | "allow_rebase_merge" | "delete_branch_on_merge" | "has_issues", boolean>>;

/** Step 1: auto-merge on, merge commits only, delete branch on merge, Issues off (the tracker keeps them on). */
const SETTING_COLUMNS = [
  { column: "auto-merge", field: "allow_auto_merge", wanted: true },
  { column: "merge-commit", field: "allow_merge_commit", wanted: true },
  { column: "squash", field: "allow_squash_merge", wanted: false },
  { column: "rebase", field: "allow_rebase_merge", wanted: false },
  { column: "delete-branch", field: "delete_branch_on_merge", wanted: true },
] as const;

/** One boolean against the page. A field GitHub did not return is CANNOT_TELL, never read as `false`. */
function flagCell(settings: RepoSettings, field: keyof RepoSettings, wanted: boolean): Cell {
  const got = settings[field];
  if (typeof got !== "boolean") return cannotTell(`\`${field}\` is not in the answer`);
  return got === wanted ? ok(`${field} ${got}`) : drift(`${field} is ${got}, the page says ${wanted}`);
}

function settingsCells(read: Read<RepoSettings>, isTracker: boolean): Record<string, Cell> {
  const wanted = [...SETTING_COLUMNS, { column: "issues", field: "has_issues", wanted: isTracker }] as const;
  return Object.fromEntries(wanted.map(({ column, field, wanted: want }) => [column,
    read.kind === "ok" ? flagCell(read.value, field, want) : cannotTell(`repos/<repo>: ${unreadWhy(read)}`)]));
}

function protectionCell(read: RepoRead, entry: Entry): Cell {
  const v = repoVerdict(read, entry);
  if (v.code === REPO_VERDICT.CANNOT_TELL) return cannotTell(v.why);
  if (v.code === REPO_VERDICT.MISSING) return drift(v.why);
  return ok(`${v.code}: ${v.why}`);
}

const PUBLISH_ENV = "npm-publish";
type Environment = { name: string; deployment_branch_policy?: { custom_branch_policies?: boolean } | null };
type EnvironmentList = { environments?: Environment[] };
type PolicyList = { branch_policies?: { name: string; type?: string }[] };

function policyCell(env: Environment, policies: Read<PolicyList> | null, branch: string): Cell {
  const custom = env.deployment_branch_policy?.custom_branch_policies;
  if (custom !== true) return drift(`\`${PUBLISH_ENV}\` is not restricted to selected branches (custom_branch_policies ${String(custom)}); the page says only ${branch}`);
  if (policies === null || policies.kind !== "ok") return cannotTell(`the branch policies: ${policies === null ? "not asked" : unreadWhy(policies)}`);
  const names = (policies.value.branch_policies ?? []).map((p) => `${p.type ?? "branch"}:${p.name}`);
  return names.length === 1 && names[0] === `branch:${branch}`
    ? ok(`restricted to ${branch}`) : drift(`\`${PUBLISH_ENV}\` is restricted to [${names.join(", ")}]; the page says only branch:${branch}`);
}

/** Where a repository publishes, `npm-publish` exists and is restricted to its default branch; elsewhere it does not exist. */
function publishCell(entry: Entry, envs: Read<EnvironmentList>, policies: Read<PolicyList> | null): Cell {
  // The LIST is read, not the one environment: a 404 on `environments/npm-publish` is absent OR forbidden, and a
  // readable list that lacks it is absence.
  if (envs.kind !== "ok") return cannotTell(`environments: ${unreadWhy(envs)}`);
  const env = (envs.value.environments ?? []).find((e) => e.name === PUBLISH_ENV);
  if (!env) {
    return entry.publishes ? drift(`publishes, and no \`${PUBLISH_ENV}\` environment exists (the list was readable)`)
      : ok("does not publish, and no environment exists");
  }
  if (!entry.publishes) return drift(`declared not to publish (\`publishes\` false in ${PROTECTION_FILE}) yet \`${PUBLISH_ENV}\` exists`);
  return policyCell(env, policies, entry.defaultBranch);
}

type TeamRepo = { name: string; role_name?: string; permissions?: { admin?: boolean } };
/** One page of `orgs/a11ign/teams/bots/repos`; a full page may be a truncated one, so its absences are not read. */
const BOTS_PAGE = 100;

/** Step 1b / 7: `bots` is attached at `push` (GitHub's `write`), `admin` false. */
function botsCell(repo: string, read: Read<TeamRepo[]>): Cell {
  if (read.kind !== "ok") return cannotTell(`orgs/a11ign/teams/bots/repos: ${unreadWhy(read)}`);
  const found = read.value.find((t) => `a11ign/${t.name}` === repo);
  if (!found) {
    return read.value.length >= BOTS_PAGE ? cannotTell(`not on the first ${BOTS_PAGE} of the team's repositories, and there may be more`)
      : drift("`bots` is not attached to this repository (step 1b)");
  }
  const level = found.role_name ?? "unknown";
  return level === "write" && found.permissions?.admin === false
    ? ok("bots at write, admin false") : drift(`bots is at ${level}, admin ${String(found.permissions?.admin)}; the page says write, admin false`);
}

/** The job every code repository's token probe is named, in the workflow `tokenProbe` names (#3710). */
const TOKEN_JOB = "token-reach";
/** Recent default-branch runs walked for one that ran the job: a run that skipped it, or is still going, is no reading. */
const PROBE_RUNS_WINDOW = 10;
type ProbeRun = { runId: number; at: string; conclusion: "success" | "failure"; annotations: string[] };
/** `null`: no run in the window ran the job, which is "not probed yet" or "the workflow lacks the probe", never a pass. */
type ProbeRead = Read<ProbeRun | null>;
const TOKEN_LINE = /^TOKEN-REACH (\S+): (.+)$/;

/** A failed probe is DRIFT only when it says why in a `TOKEN-REACH <this repo>: <cause>` line; anything else is not a reading of the token. */
function failedProbeCell(repo: string, run: ProbeRun): Cell {
  const named = run.annotations.map((m) => TOKEN_LINE.exec(m)).find((m) => m !== null);
  const at = `run ${run.runId} (${run.at})`;
  if (!named) return cannotTell(`${at}: \`${TOKEN_JOB}\` failed with no TOKEN-REACH line, so the failure is not a reading of the token`);
  const [, namedRepo, cause = ""] = named;
  if (namedRepo !== repo) return cannotTell(`${at}: the TOKEN-REACH line names ${namedRepo ?? "?"}, not ${repo}: a copied probe asked about another repository`);
  return cause.startsWith("CANNOT_TELL") ? cannotTell(`${at}: ${cause}`) : drift(`${at}: ${cause}`);
}

/** The names of the workflow files whose live lines (not comments) read `secrets.A11IGN_BOT_TOKEN`; `secrets: inherit` is NOT counted, which the page says. */
type TokenUse = Read<string[]>;
const TOKEN_READ = /secrets\s*(\.|\[\s*['"])A11IGN_BOT_TOKEN\b/;

function workflowsReadingToken(files: { name: string; text: string }[]): string[] {
  return files.filter((f) => f.text.split("\n").some((line) => !line.trimStart().startsWith("#") && TOKEN_READ.test(line))).map((f) => f.name);
}

/** A repository that declares the token unused: OK only while no workflow in it reads the secret. Not a probe, so it names no run. */
function unusedTokenCell(entry: Entry, use: TokenUse | null): Cell {
  if (use === null || use.kind !== "ok") return cannotTell(`the workflows of ${entry.repo}: ${use === null ? "not asked" : unreadWhy(use)}`);
  if (use.value.length > 0) return drift(`${PROTECTION_FILE} says ${entry.repo} uses the token nowhere, but ${use.value.join(", ")} reads secrets.A11IGN_BOT_TOKEN: give it a \`tokenProbe\` instead`);
  return ok(`not applicable: ${entry.tokenUnused ?? ""} (no workflow of ${entry.repo} reads secrets.A11IGN_BOT_TOKEN, read now)`);
}

/**
 * Step 8: does the token reach THIS repository on the write side, as of the latest probe run. A reading at a
 * moment, per run, never a standing certificate: the cell says which run and when.
 */
function tokenCell(entry: Entry, probe: ProbeRead, use: TokenUse | null = null): Cell {
  if (entry.tokenUnused !== undefined) return unusedTokenCell(entry, use);
  const { tokenProbe } = entry;
  if (tokenProbe === undefined) return cannotTell(`no \`tokenProbe\` for ${entry.repo} in ${PROTECTION_FILE}: nothing probes the token's reach here`);
  if (probe.kind !== "ok") return cannotTell(`${tokenProbe}: ${unreadWhy(probe)}`);
  if (probe.value === null) {
    return cannotTell(`no run of a \`${TOKEN_JOB}\` job in the last ${PROBE_RUNS_WINDOW} ${entry.defaultBranch} runs of ${tokenProbe}: not probed yet, or the workflow lacks the probe`);
  }
  if (probe.value.conclusion === "failure") return failedProbeCell(entry.repo, probe.value);
  return ok(`run ${probe.value.runId} (${probe.value.at}): \`${TOKEN_JOB}\` passed`);
}

// --- #3718: the release shape, read from the workflow's STRUCTURE ---------------------------------------------

/**
 * The chairman's direction (#928, 2026-10-05) is one per-merge release workflow and no version pull request
 * anywhere. This reads which a repository has, from its `release.yml` on the default branch, PARSED: agent-org's
 * own file describes the version pull request it used to open, at length, in comments, and a grep for the
 * phrase reads it as the thing it replaced. The rule, in the order it is applied:
 *
 *   DRIFT        any job uses `changesets/action`, is NAMED `version-pr`, requests `pull-requests: write`
 *                (job or workflow level; a job that calls the local consumer-gate workflow is excused the grant, below),
 *                runs `gh pr create`, or pushes a BRANCH (`git push` that is not a tag push);
 *   OK           otherwise, a job calls the reusable per-merge workflow, or a step pushes the merge's TAG;
 *   CANNOT_TELL  the file could not be read or parsed, or it is neither (nothing releases, or only a local
 *                composite action does, and that is not followed).
 *
 * A tag push is `--tags` or a refspec under `refs/tags/`: agent-org, control and lab push `HEAD:refs/tags/$TAG`,
 * which is the merge being tagged and not a branch being offered for review. The three DRIFT signals are the
 * row's; `version-pr` as a job name and `gh pr create` are added because `a11ign`'s version job carries neither
 * the action nor the permission (its script pushes the branch, out of this file's sight).
 */
const RELEASE_COLUMN = "release-shape";
const RELEASE_WORKFLOW = ".github/workflows/release.yml";
const VERSION_PR_JOB = "version-pr";
/**
 * The reusable per-merge workflow lives in `a11ign/toolchain` (#3712). NOT VERIFIED: that row has not named the
 * file, no repository calls it yet (read 2026-10-05), so this matches any `release*` workflow there. When #3712
 * names it, tighten this to the name.
 */
const PER_MERGE_CALL = /^a11ign\/toolchain\/\.github\/workflows\/[^@]*release[^@]*\.ya?ml@/;

type WorkflowStep = { uses?: unknown; run?: unknown };
type WorkflowJob = { uses?: unknown; permissions?: unknown; steps?: WorkflowStep[] };
type Workflow = { permissions?: unknown; jobs?: Record<string, WorkflowJob> };
type ContentsAnswer = { content?: string; encoding?: string };

/**
 * #3777: the local consumer-gate workflow is generated from the README's Quickstart fence, which asks for
 * `pull-requests: write` for the Action's optional PR-comment step, and a called workflow may not request more than
 * its caller grants, so the caller carries it. That grant comments on a pull request and opens none, so on THIS call
 * it is not the version pull request's signal. Only this call: any other job with the grant still reads DRIFT, and
 * so does the same job by its name or by anything its steps do (a `uses:` job has none).
 */
const CONSUMER_GATE_CALL = /^\.\/\.github\/workflows\/consumer-gate\.ya?ml$/;
const callsConsumerGate = (job: WorkflowJob): boolean => typeof job.uses === "string" && CONSUMER_GATE_CALL.test(job.uses);

const grantsPullRequestWrite = (permissions: unknown): boolean =>
  permissions === "write-all"
  || (typeof permissions === "object" && permissions !== null && (permissions as Record<string, unknown>)["pull-requests"] === "write");

/** The shell commands of one `run:` block, comment lines dropped and `\` continuations joined. */
const shellCommands = (run: unknown): string[] => typeof run !== "string" ? []
  : run.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n").replace(/\\\n/g, " ").split("\n");

/** The arguments of every `git push` on a line, up to the next command separator. */
const gitPushArguments = (command: string): string[] =>
  [...command.matchAll(/\bgit\s+push\b([^;&|\n]*)/g)].map((m) => m[1] ?? "");

const pushesTag = (args: string): boolean => /--tags\b|refs\/tags\//.test(args);

function stepSignals(step: WorkflowStep): string[] {
  const found: string[] = [];
  if (typeof step.uses === "string" && /^changesets\/action(@|$)/.test(step.uses)) found.push("uses `changesets/action`");
  for (const command of shellCommands(step.run)) {
    if (/\bgh\s+pr\s+create\b/.test(command)) found.push("runs `gh pr create`");
    if (gitPushArguments(command).some((args) => !pushesTag(args))) found.push("pushes a branch (`git push` that is not a tag push)");
  }
  return found;
}

function jobSignals(id: string, job: WorkflowJob): string[] {
  const found = (id === VERSION_PR_JOB ? [`has the version pull request job's name, \`${VERSION_PR_JOB}\``] : [])
    .concat(grantsPullRequestWrite(job.permissions) && !callsConsumerGate(job) ? ["requests `pull-requests: write`"] : [])
    .concat((job.steps ?? []).flatMap(stepSignals));
  return found.map((what) => `job \`${id}\` ${what}`);
}

const versionPrSignals = (workflow: Workflow): string[] => [
  ...(grantsPullRequestWrite(workflow.permissions) ? ["the workflow requests `pull-requests: write`"] : []),
  ...Object.entries(workflow.jobs ?? {}).flatMap(([id, job]) => jobSignals(id, job)),
];

/** What makes a workflow per-merge: a call to the reusable one, or a step that tags the merge itself. */
function perMergeEvidence(workflow: Workflow): string | null {
  for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
    if (typeof job.uses === "string" && PER_MERGE_CALL.test(job.uses)) return `job \`${id}\` calls ${job.uses}`;
    const tags = (job.steps ?? []).some((s) => shellCommands(s.run).some((c) => gitPushArguments(c).some(pushesTag)));
    if (tags) return `job \`${id}\` pushes the merge's tag`;
  }
  return null;
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Why the walk below cannot be trusted to dereference this workflow, or null when it can. A file can parse and still
 * be unusable (`release: null`, `steps: "make"`, a step that is a bare string); skipping such an entry would hide a
 * DRIFT signal inside it, so it is CANNOT_TELL, not a crash and not a pass.
 */
function structuralProblem(jobs: Record<string, unknown>): string | null {
  for (const [id, job] of Object.entries(jobs)) {
    if (!isMapping(job)) return `job \`${id}\` is not a mapping`;
    if (job.steps === undefined) continue;
    if (!Array.isArray(job.steps) || !job.steps.every(isMapping)) return `job \`${id}\` has \`steps\` that are not a list of mappings`;
  }
  return null;
}

function releaseShapeOfText(text: string): Cell {
  let workflow: Workflow | null;
  try {
    workflow = parseYaml(text) as Workflow | null;
  } catch (cause) {
    return cannotTell(`${RELEASE_WORKFLOW} does not parse: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`);
  }
  if (typeof workflow !== "object" || workflow === null || typeof workflow.jobs !== "object" || workflow.jobs === null) {
    return cannotTell(`${RELEASE_WORKFLOW} parses and has no \`jobs\`, so there is no release to read`);
  }
  if (Array.isArray(workflow.jobs)) return cannotTell(`${RELEASE_WORKFLOW} has \`jobs\` as a list, not a mapping of job ids`);
  const problem = structuralProblem(workflow.jobs);
  if (problem !== null) return cannotTell(`${RELEASE_WORKFLOW} parses but cannot be read: ${problem}`);
  const signals = versionPrSignals(workflow);
  if (signals.length > 0) return drift(`opens a version pull request: ${signals.join("; ")}`);
  const evidence = perMergeEvidence(workflow);
  return evidence === null
    ? cannotTell(`${RELEASE_WORKFLOW} reads as neither shape: no version-pull-request signal, no call to the reusable per-merge workflow and no tag push`)
    : ok(`releases per merge: ${evidence}`);
}

/** The contents endpoint answers base64 wrapped at 60 columns; a directory answers an array and a big file no content. */
function releaseShapeCell(read: Read<ContentsAnswer>): Cell {
  if (read.kind !== "ok") return cannotTell(`${RELEASE_WORKFLOW}: ${unreadWhy(read)}`);
  const { content, encoding } = read.value;
  if (typeof content !== "string" || encoding !== "base64") {
    return cannotTell(`${RELEASE_WORKFLOW} came back without base64 content (a directory, or over the API's 1 MB): not a pass`);
  }
  return releaseShapeOfText(Buffer.from(content, "base64").toString("utf8"));
}

/** Every column of a row. `tableProblems` fails a row that lacks one, so a new cell cannot be dropped silently. */
const TABLE_COLUMNS = [...SETTING_COLUMNS.map((s) => s.column), "issues", "protection", PUBLISH_ENV, "bots", "token", RELEASE_COLUMN];

type RepoReads = {
  settings: Read<RepoSettings>; protection: RepoRead; envs: Read<EnvironmentList>;
  policies: Read<PolicyList> | null; probe: ProbeRead; tokenUse: TokenUse | null;
  workflow: Read<ContentsAnswer>;
};
type OrgReads = { bots: Read<TeamRepo[]>; trackers: string[] };

function tableRow(entry: Entry, reads: RepoReads, org: OrgReads): Row {
  return {
    repo: entry.repo,
    cells: {
      ...settingsCells(reads.settings, org.trackers.includes(entry.repo)),
      protection: protectionCell(reads.protection, entry),
      [PUBLISH_ENV]: publishCell(entry, reads.envs, reads.policies),
      bots: botsCell(entry.repo, org.bots),
      token: tokenCell(entry, reads.probe, reads.tokenUse),
      [RELEASE_COLUMN]: releaseShapeCell(reads.workflow),
    },
  };
}

/** Every failure, one line each: a declared repository with no row, a row with no cell for a column, then every cell that is not `OK`. */
function tableProblems(rows: Row[], declared: string[]): string[] {
  const shown = new Set(rows.map((r) => r.repo));
  const unrowed = declared.filter((repo) => !shown.has(repo)).map((repo) => `${repo}: DECLARED and has no row in the table`);
  const uncelled = rows.flatMap((r) => TABLE_COLUMNS.filter((column) => r.cells[column] === undefined)
    .map((column) => `${r.repo} ${column}: NO CELL, the table did not read it`));
  const bad = rows.flatMap((r) => Object.entries(r.cells).filter(([, c]) => c.state !== "OK")
    .map(([column, c]) => `${r.repo} ${column}: ${c.state} ${c.detail}`));
  return [...unrowed, ...uncelled, ...bad];
}

/** The matrix, then the detail of each cell that is not `OK`. */
function renderTable(rows: Row[]): string[] {
  const columns = Object.keys(rows[0]?.cells ?? {});
  const width = Math.max(...rows.map((r) => r.repo.length), "repository".length);
  const cellWidth = (column: string): number => Math.max("CANNOT_TELL".length, column.length);
  const header = `${"repository".padEnd(width)}  ${columns.map((c) => c.padEnd(cellWidth(c))).join("  ")}`;
  const lines = rows.map((r) => `${r.repo.padEnd(width)}  ${columns.map((c) => (r.cells[c]?.state ?? "NO CELL").padEnd(cellWidth(c))).join("  ")}`);
  return [header, ...lines];
}

// --- fixtures: a repository that satisfies the page, and the same one drifting --------------------------------

const PUBLISHER: Entry = { repo: "a11ign/fixture-publisher", defaultBranch: "main", requiredCheck: "gate", publishes: true, tokenProbe: "auto-arm.yml" };
const NO_ORG: OrgReads = { bots: { kind: "ok", value: [{ name: "fixture-publisher", role_name: "write", permissions: { admin: false } }] }, trackers: [] };
const GOOD_SETTINGS: RepoSettings = { allow_auto_merge: true, allow_merge_commit: true, allow_squash_merge: false,
  allow_rebase_merge: false, delete_branch_on_merge: true, has_issues: false };
const RESTRICTED_ENV: Read<EnvironmentList> = { kind: "ok", value: { environments: [{ name: PUBLISH_ENV, deployment_branch_policy: { custom_branch_policies: true } }] } };
const MAIN_ONLY: Read<PolicyList> = { kind: "ok", value: { branch_policies: [{ name: "main", type: "branch" }] } };
const PASSED: ProbeRead = { kind: "ok", value: { runId: 11, at: "2026-10-05T23:00:00Z", conclusion: "success", annotations: [] } };
/** A `release.yml` as the contents endpoint returns it: base64, wrapped at 60 columns. */
const releaseFile = (yaml: string): Read<ContentsAnswer> =>
  ({ kind: "ok", value: { encoding: "base64", content: Buffer.from(yaml).toString("base64").replace(/(.{60})/g, "$1\n") } });
const PER_MERGE_CALLER = releaseFile(`name: release
on: { push: { branches: [main] } }
jobs:
  release:
    uses: a11ign/toolchain/.github/workflows/release.yml@v1
    secrets: inherit
`);
const GOOD_READS: RepoReads = { settings: { kind: "ok", value: GOOD_SETTINGS }, protection: withClassic({ kind: "ok", value: FULL_CLASSIC }),
  envs: RESTRICTED_ENV, policies: MAIN_ONLY, probe: PASSED, tokenUse: null, workflow: PER_MERGE_CALLER };
const columnsNotOk = (row: Row, state: CellState): string[] => Object.entries(row.cells).filter(([, c]) => c.state === state).map(([k]) => k);

test("#3705: a repository that satisfies the page reads OK in every cell -- the table can be green", () => {
  const row = tableRow(PUBLISHER, GOOD_READS, NO_ORG);
  assert.deepEqual(tableProblems([row], [PUBLISHER.repo]), []);
  assert.deepEqual(Object.keys(row.cells).sort(), [...TABLE_COLUMNS].sort(), "the columns the page's steps 1, 1b, 4, 8 and 9 name, and the `issues` line of step 1");
});

test("#3705 POSITIVE CONTROL: a repository whose settings DRIFT prints DRIFT for exactly those cells", () => {
  // Squash allowed, `allow_auto_merge` false and `npm-publish` unrestricted: the three the row names. An emptiness
  // assertion over the problems would pass on a table that read nothing, so this names what must be there.
  const reads: RepoReads = { ...GOOD_READS,
    settings: { kind: "ok", value: { ...GOOD_SETTINGS, allow_squash_merge: true, allow_auto_merge: false } },
    envs: { kind: "ok", value: { environments: [{ name: PUBLISH_ENV, deployment_branch_policy: { custom_branch_policies: false } }] } } };
  const row = tableRow(PUBLISHER, reads, NO_ORG);
  assert.deepEqual(columnsNotOk(row, "DRIFT"), ["auto-merge", "squash", PUBLISH_ENV]);
  assert.deepEqual(columnsNotOk(row, "CANNOT_TELL"), []);
  assert.match(row.cells.squash?.detail ?? "", /allow_squash_merge is true, the page says false/);
  assert.equal(tableProblems([row], [PUBLISHER.repo]).length, 3);
});

test("#3705: each merge setting drifts on its own, in both directions the page cares about", () => {
  for (const { column, field, wanted } of SETTING_COLUMNS) {
    const wrong = { kind: "ok", value: { ...GOOD_SETTINGS, [field]: !wanted } } as Read<RepoSettings>;
    assert.deepEqual(columnsNotOk(tableRow(PUBLISHER, { ...GOOD_READS, settings: wrong }, NO_ORG), "DRIFT"), [column]);
  }
  // `issues` is off everywhere but the tracker, which IS the tracker.
  const withIssues = { kind: "ok", value: { ...GOOD_SETTINGS, has_issues: true } } as Read<RepoSettings>;
  assert.deepEqual(columnsNotOk(tableRow(PUBLISHER, { ...GOOD_READS, settings: withIssues }, NO_ORG), "DRIFT"), ["issues"]);
  assert.deepEqual(columnsNotOk(tableRow(PUBLISHER, { ...GOOD_READS, settings: withIssues }, { ...NO_ORG, trackers: [PUBLISHER.repo] }), "DRIFT"), []);
});

test("#3705: a setting GitHub did not return, or a read that failed, is CANNOT_TELL and never OK", () => {
  const partial = { kind: "ok", value: { allow_auto_merge: true } } as Read<RepoSettings>;
  const row = tableRow(PUBLISHER, { ...GOOD_READS, settings: partial }, NO_ORG);
  assert.deepEqual(columnsNotOk(row, "CANNOT_TELL"), ["merge-commit", "squash", "rebase", "delete-branch", "issues"]);
  const refused = tableRow(PUBLISHER, { ...GOOD_READS, settings: { kind: "refused" }, envs: { kind: "unreadable", why: "HTTP 502" } }, { ...NO_ORG, bots: { kind: "refused" } });
  assert.deepEqual(columnsNotOk(refused, "CANNOT_TELL"), [...SETTING_COLUMNS.map((s) => s.column), "issues", PUBLISH_ENV, "bots"]);
  assert.equal(refused.cells[RELEASE_COLUMN]?.state, "OK", "the release shape is its own read: the workflow was readable here");
});

test("#3705: the protection cell reuses the existing verdict: MISSING is DRIFT, unreadable is CANNOT_TELL, PARTLY_READ is OK and says so", () => {
  const cell = (protection: RepoRead): Cell => tableRow(PUBLISHER, { ...GOOD_READS, protection }, NO_ORG).cells.protection as Cell;
  assert.equal(cell(EMPTY_REPO).state, "DRIFT");
  assert.match(cell(EMPTY_REPO).detail, /MISSING ruleset `pull_request` rule/);
  assert.equal(cell({ ...EMPTY_REPO, rules: { kind: "refused" } }).state, "CANNOT_TELL");
  const partly = cell(withClassic({ kind: "refused" }));
  assert.equal(partly.state, "OK", "as the live read above accepts it: a non-admin cannot read classic protection");
  assert.match(partly.detail, /^PARTLY_READ: .*NOT READ classic branch protection/);
});

test("#3705: an entry that does not say whether it publishes is a problem, because the `npm-publish` cell reads it", () => {
  const entries = [{ repo: "a11ign/silent", defaultBranch: "main", requiredCheck: "gate" }] as Entry[];
  assert.match(entryProblems(entries).join("\n"), /a11ign\/silent says nowhere whether it publishes/);
  assert.ok(protectionEntries().every((e) => typeof e.publishes === "boolean"), "the committed file is complete");
});

test("#3705: `npm-publish` -- a publisher needs it restricted to its default branch, and a non-publisher needs none", () => {
  const none: Read<EnvironmentList> = { kind: "ok", value: { environments: [] } };
  assert.equal(publishCell(PUBLISHER, none, null).state, "DRIFT", "a publisher with no environment");
  assert.equal(publishCell({ ...PUBLISHER, publishes: false }, none, null).state, "OK", "a non-publisher with none: absent is right");
  assert.equal(publishCell({ ...PUBLISHER, publishes: false }, RESTRICTED_ENV, MAIN_ONLY).state, "DRIFT", "a non-publisher carrying one");
  assert.equal(publishCell(PUBLISHER, { kind: "refused" }, null).state, "CANNOT_TELL", "a refused list is not absence");
  const wider: Read<PolicyList> = { kind: "ok", value: { branch_policies: [{ name: "main", type: "branch" }, { name: "v*", type: "tag" }] } };
  assert.match(publishCell(PUBLISHER, RESTRICTED_ENV, wider).detail, /branch:main, tag:v\*/);
  assert.equal(publishCell(PUBLISHER, RESTRICTED_ENV, { kind: "ok", value: { branch_policies: [] } }).state, "DRIFT", "custom policies with none listed restrict nothing the page names");
  assert.equal(publishCell(PUBLISHER, RESTRICTED_ENV, { kind: "refused" }).state, "CANNOT_TELL");
});

test("#3705: `bots` -- write with admin false is OK; absent, admin or read is DRIFT; an unreadable team is CANNOT_TELL", () => {
  const team = (t: Partial<TeamRepo>): Read<TeamRepo[]> => ({ kind: "ok", value: [{ name: "fixture-publisher", role_name: "write", permissions: { admin: false }, ...t }] });
  assert.equal(botsCell(PUBLISHER.repo, team({})).state, "OK");
  assert.equal(botsCell(PUBLISHER.repo, team({ role_name: "admin", permissions: { admin: true } })).state, "DRIFT");
  assert.equal(botsCell(PUBLISHER.repo, team({ role_name: "read" })).state, "DRIFT");
  assert.equal(botsCell(PUBLISHER.repo, team({ name: "someone-else" })).state, "DRIFT");
  assert.equal(botsCell(PUBLISHER.repo, { kind: "refused" }).state, "CANNOT_TELL");
  const full: Read<TeamRepo[]> = { kind: "ok", value: Array.from({ length: BOTS_PAGE }, (_, i) => ({ name: `r${i}`, role_name: "write", permissions: { admin: false } })) };
  assert.equal(botsCell(PUBLISHER.repo, full).state, "CANNOT_TELL", "a full page may hide the repository");
});

const probeFailed = (...annotations: string[]): ProbeRead =>
  ({ kind: "ok", value: { runId: 12, at: "2026-10-05T23:30:00Z", conclusion: "failure", annotations } });
const NOT_PUSHABLE = `TOKEN-REACH ${PUBLISHER.repo}: the token cannot push here: the push service answered HTTP 403`;

test("#3710: the token cell reads OK from a passed probe run, and says which run and when", () => {
  const cell = tokenCell(PUBLISHER, PASSED);
  assert.equal(cell.state, "OK");
  assert.match(cell.detail, /run 11 \(2026-10-05T23:00:00Z\)/, "a reading at a moment names the moment");
});

test("#3710 POSITIVE CONTROL: a failed probe run with a cause prints DRIFT for exactly the token cell, and no run prints CANNOT_TELL", () => {
  // The drift list being empty proves nothing (it is also empty for a table that read nothing), so each state
  // names the one column it must land in, over a row where every other cell is OK.
  const drifting = tableRow(PUBLISHER, { ...GOOD_READS, probe: probeFailed("Process completed with exit code 1.", NOT_PUSHABLE) }, NO_ORG);
  assert.deepEqual(columnsNotOk(drifting, "DRIFT"), ["token"]);
  assert.deepEqual(columnsNotOk(drifting, "CANNOT_TELL"), []);
  assert.match(drifting.cells.token?.detail ?? "", /cannot push here: the push service answered HTTP 403/, "the cause is carried verbatim");
  const unprobed = tableRow(PUBLISHER, { ...GOOD_READS, probe: { kind: "ok", value: null } }, NO_ORG);
  assert.deepEqual(columnsNotOk(unprobed, "CANNOT_TELL"), ["token"]);
  assert.match(unprobed.cells.token?.detail ?? "", /not probed yet, or the workflow lacks the probe/);
  assert.deepEqual(tableProblems([drifting], [PUBLISHER.repo]).map((p) => p.split(":")[0]), [`${PUBLISHER.repo} token`], "either state fails the table");
});

const UNUSED: Entry = { repo: "a11ign/fixture-publisher", defaultBranch: "main", requiredCheck: "gate", publishes: true, tokenUnused: "no workflow of it uses the token" };
const workflowFile = (name: string, text: string) => ({ name, text });
/** What `documents`'s own `release.yml` says today: the token named only in a comment that says it has none. */
const COMMENT_ONLY = "# This repository has no secrets.A11IGN_BOT_TOKEN: the release hands none over.\njobs:\n  release:\n    uses: a11ign/toolchain/.github/workflows/release-per-merge.yml@v1\n    secrets: inherit\n";
const READS_IT = "jobs:\n  arm:\n    steps:\n      - run: gh pr merge --auto\n        env:\n          GH_TOKEN: ${{ secrets.A11IGN_BOT_TOKEN }}\n";

test("#3710: a repository declaring the token unused reads not-applicable, and DRIFT the day a workflow starts reading it", () => {
  const unusedRow = (files: { name: string; text: string }[]) =>
    tableRow(UNUSED, { ...GOOD_READS, tokenUse: { kind: "ok", value: workflowsReadingToken(files) } }, NO_ORG);
  const none = unusedRow([workflowFile("release.yml", COMMENT_ONLY), workflowFile("ci.yml", "jobs: {}\n")]);
  assert.equal(none.cells.token?.state, "OK", "a comment naming the token, and `secrets: inherit`, are not a read of it");
  assert.match(none.cells.token?.detail ?? "", /^not applicable: no workflow of it uses the token/);
  assert.deepEqual(columnsNotOk(none, "DRIFT"), []);
  // POSITIVE CONTROL for the emptiness above: the same scan DOES find a live read, in exactly the token cell.
  const used = unusedRow([workflowFile("release.yml", COMMENT_ONLY), workflowFile("auto-arm.yml", READS_IT)]);
  assert.deepEqual(columnsNotOk(used, "DRIFT"), ["token"]);
  assert.deepEqual(columnsNotOk(used, "CANNOT_TELL"), []);
  assert.match(used.cells.token?.detail ?? "", /auto-arm\.yml reads secrets\.A11IGN_BOT_TOKEN: give it a `tokenProbe`/);
  assert.deepEqual(workflowsReadingToken([workflowFile("a.yml", "x: ${{ secrets['A11IGN_BOT_TOKEN'] }}\n")]), ["a.yml"], "the bracket spelling reads it too");
  assert.deepEqual(workflowsReadingToken([workflowFile("a.yml", "x: ${{ secrets.A11IGN_BOT_TOKEN_OLD }}\n")]), [], "a longer name is another secret");
});

test("#3710: a token-unused claim that could not be checked is CANNOT_TELL, and an entry cannot be both unused and probed", () => {
  for (const [why, use] of [["not asked", null], ["refused", { kind: "refused" }], ["unreadable", { kind: "unreadable", why: "ENOBUFS" }]] as [string, TokenUse | null][]) {
    assert.equal(tokenCell(UNUSED, PASSED, use).state, "CANNOT_TELL", why);
  }
  assert.deepEqual(entryProblems([UNUSED]), []);
  assert.match(entryProblems([{ ...UNUSED, tokenProbe: "auto-arm.yml" }]).join("\n"), /declares both `tokenProbe` and `tokenUnused`/);
  assert.match(entryProblems([{ ...UNUSED, tokenUnused: " " }]).join("\n"), /must say why the token is unused/);
});

test("#3710: everything that is not a TOKEN-REACH reading is CANNOT_TELL, never a pass and never a drift", () => {
  const cases: [string, Entry, ProbeRead, RegExp][] = [
    ["no tokenProbe declared", { ...PUBLISHER, tokenProbe: undefined }, PASSED, /no `tokenProbe` for a11ign\/fixture-publisher/],
    ["the runs could not be read", PUBLISHER, { kind: "unreadable", why: "ENOBUFS" }, /auto-arm\.yml: ENOBUFS/],
    ["a refusal", PUBLISHER, { kind: "refused" }, /absent OR forbidden/],
    ["the job failed for another reason", PUBLISHER, probeFailed("Process completed with exit code 1."), /failed with no TOKEN-REACH line/],
    ["a copied probe names another repository", PUBLISHER, probeFailed("TOKEN-REACH a11ign/other: the token cannot push here"), /names a11ign\/other, not a11ign\/fixture-publisher/],
    ["the probe could not ask", PUBLISHER, probeFailed(`TOKEN-REACH ${PUBLISHER.repo}: CANNOT_TELL the probe could not ask (push 000, pulls 000)`), /CANNOT_TELL the probe could not ask/],
  ];
  for (const [why, entry, probe, detail] of cases) {
    const cell = tokenCell(entry, probe);
    assert.equal(cell.state, "CANNOT_TELL", why);
    assert.match(cell.detail, detail, why);
  }
});

// --- #3710: the probe itself, run as the workflow runs it, against a `curl` that answers with chosen statuses ---

type ProbeWorkflow = { jobs?: Record<string, { needs?: string | string[]; steps?: { run?: string }[] }> };
/** #3717: the probe left `release.yml` with the last read of the bot token there, and lives in a file of its own. */
const TOKEN_REACH_WORKFLOW = ".github/workflows/token-reach.yml";
const probeWorkflow = (): ProbeWorkflow => parseYaml(readFileSync(join(REPO_ROOT, TOKEN_REACH_WORKFLOW), "utf8")) as ProbeWorkflow;
const PROBE_SECRET = "ghp_probe-secret-must-never-be-printed";

/** The step's script, run under `bash -e` like Actions does, with a `curl` that answers the push probe and the pulls probe separately. */
function runProbe(answers: { push: string; pulls: string }, token = PROBE_SECRET): { code: number | null; out: string } {
  const script = probeWorkflow().jobs?.[TOKEN_JOB]?.steps?.find((step) => step.run !== undefined)?.run ?? "";
  assert.notEqual(script, "", `${TOKEN_REACH_WORKFLOW} has no ${TOKEN_JOB} job with a script: the probe does not exist`);
  const dir = mkdtempSync(join(tmpdir(), "token-reach-"));
  const curl = join(dir, "curl");
  writeFileSync(curl, '#!/bin/sh\nfor a in "$@"; do case "$a" in *git-receive-pack*) printf %s "$STUB_PUSH"; exit 0;; esac; done\nprintf %s "$STUB_PULLS"\n');
  chmodSync(curl, 0o755);
  const run = spawnSync("bash", ["-e", "-c", script], { encoding: "utf8", env: {
    PATH: `${dir}:${process.env.PATH ?? ""}`, A11IGN_BOT_TOKEN: token, GITHUB_REPOSITORY: PUBLISHER.repo,
    STUB_PUSH: answers.push, STUB_PULLS: answers.pulls } });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

/** The `::error::` line the probe printed, as the annotation GitHub would hold: the cell reads these. */
const annotationOf = (out: string): string => out.split("\n").find((l) => l.startsWith("::error::"))?.slice("::error::".length) ?? "";

test("#3710: the probe passes only on push 200 and pull-request create 422, and each failure names its cause", () => {
  const passed = runProbe({ push: "200", pulls: "422" });
  assert.equal(passed.code, 0);
  assert.match(passed.out, /TOKEN-REACH a11ign\/fixture-publisher: ok/);
  const failures: [string, { push: string; pulls: string }, RegExp, CellState][] = [
    ["rejected", { push: "401", pulls: "401" }, /cannot push here.*HTTP 401/, "DRIFT"],
    ["read-only or not reached", { push: "403", pulls: "403" }, /cannot push here.*HTTP 403/, "DRIFT"],
    ["no pull-request write", { push: "200", pulls: "403" }, /cannot open or arm pull requests here.*HTTP 403/, "DRIFT"],
    ["could not ask", { push: "000", pulls: "000" }, /CANNOT_TELL the probe could not ask/, "CANNOT_TELL"],
    ["GitHub erred", { push: "200", pulls: "502" }, /CANNOT_TELL the probe could not ask/, "CANNOT_TELL"],
  ];
  for (const [why, answers, cause, state] of failures) {
    const result = runProbe(answers);
    assert.equal(result.code, 1, why);
    assert.match(annotationOf(result.out), cause, why);
    assert.equal(tokenCell(PUBLISHER, probeFailed(annotationOf(result.out))).state, state, `${why}: the cell reads the line the probe wrote`);
  }
});

test("#3710: an unset secret fails with its own cause, and no run ever prints the token", () => {
  const unset = runProbe({ push: "200", pulls: "422" }, "");
  assert.equal(unset.code, 1);
  assert.match(annotationOf(unset.out), /^TOKEN-REACH a11ign\/fixture-publisher: A11IGN_BOT_TOKEN is not set/);
  for (const answers of [{ push: "200", pulls: "422" }, { push: "403", pulls: "403" }]) {
    assert.ok(!runProbe(answers).out.includes(PROBE_SECRET), "the secret must reach no log line");
  }
});

test("#3710/#3717: the probe is a separate job named for the cell, in a file of its own that no release job reads the token from, and nothing waits on it", () => {
  const jobs = probeWorkflow().jobs ?? {};
  assert.ok(jobs[TOKEN_JOB], `${TOKEN_REACH_WORKFLOW} has no \`${TOKEN_JOB}\` job`);
  assert.equal(jobs[TOKEN_JOB]?.needs, undefined, "the probe waits on nothing");
  const waiting = Object.entries(jobs).filter(([, job]) => [job.needs ?? []].flat().includes(TOKEN_JOB)).map(([name]) => name);
  assert.deepEqual(waiting, [], "no job may need the probe: the arm step keeps its GITHUB_TOKEN fallback");
  assert.equal(protectionEntries().find((e) => e.repo === FORMER_LITERAL)?.tokenProbe, "token-reach.yml", "the declaration points where the job lives");
  assert.doesNotMatch(readFileSync(join(REPO_ROOT, RELEASE_WORKFLOW), "utf8").split("\n").filter((line) => !line.trim().startsWith("#")).join("\n"), /A11IGN_BOT_TOKEN/,
    "release.yml reads the bot token on no live line: the version pull request that needed it is gone (#3717), and the probe lives in its own file");
});

test("#3705: a declared repository with no row is a failure, and the table renders a cell for every column", () => {
  const row = tableRow(PUBLISHER, GOOD_READS, NO_ORG);
  assert.deepEqual(tableProblems([row], [PUBLISHER.repo]), []);
  assert.deepEqual(tableProblems([row], [PUBLISHER.repo, "a11ign/has-no-row"]), ["a11ign/has-no-row: DECLARED and has no row in the table"]);
  assert.deepEqual(tableProblems([], ["a11ign/has-no-row"]).length, 1, "no rows at all is a failure and not a pass");
  const [header, line] = renderTable([row]);
  assert.match(header ?? "", /repository +auto-merge +merge-commit +squash/);
  assert.match(line ?? "", /^a11ign\/fixture-publisher +OK/);
});

// --- #3718: a release workflow of each shape, and what the reading does with it ---------------------------------

const shapeOf = (yaml: string): Cell => releaseShapeCell(releaseFile(yaml));

/** `screenreader-worker`'s shape, 2026-10-05: a `plan` job, a `version-pr` job that runs the action, a `publish` job that pushes tags. */
const ACTION_STEP = `name: release
on: { push: { branches: [main] } }
jobs:
  version-pr:
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@v7
      - uses: changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51
        with: { commit-message: "Version packages" }
`;
/** `a11ign`'s: the job opens the pull request itself, so no action and no permission names it; only the job and the command do. */
const VERSION_PR_JOB_ONLY = `name: release
on: { push: { branches: [main] } }
jobs:
  version-pr:
    steps:
      - run: pnpm run release:version
`;
/** `agent-org`'s: the comments say, at length, everything a grep would read as DRIFT; the structure is a tag push on the merge. */
const COMMENTS_DESCRIBE_A_VERSION_PR = `# Releases on every merge. It used to open a version pull request with changesets/action, which needed
# pull-requests: write and ran git push origin release/version-packages. It does none of those now.
name: release
on: { push: { branches: [main] } }
permissions: { contents: read }
jobs:
  release:
    permissions: { contents: write }
    steps:
      - name: Tag the merge
        run: |
          # was: git push origin release/version-packages, and gh pr create
          git push origin "HEAD:refs/tags/$TAG"
`;

test("#3718 POSITIVE CONTROLS: the action step reads DRIFT, a `version-pr` job reads DRIFT, the per-merge call reads OK, comments describing a version pull request read OK", () => {
  const action = shapeOf(ACTION_STEP);
  assert.equal(action.state, "DRIFT");
  assert.match(action.detail, /job `version-pr` uses `changesets\/action`/);
  const jobOnly = shapeOf(VERSION_PR_JOB_ONLY);
  assert.equal(jobOnly.state, "DRIFT");
  assert.match(jobOnly.detail, /job `version-pr` has the version pull request job's name/);
  assert.doesNotMatch(jobOnly.detail, /changesets/, "this fixture has no action step: the job name alone reads it");
  assert.equal(releaseShapeCell(PER_MERGE_CALLER).state, "OK");
  assert.match(releaseShapeCell(PER_MERGE_CALLER).detail, /calls a11ign\/toolchain\/\.github\/workflows\/release\.yml@v1/);
  const commented = shapeOf(COMMENTS_DESCRIBE_A_VERSION_PR);
  assert.equal(commented.state, "OK", commented.detail);
  assert.match(commented.detail, /pushes the merge's tag/);
});

test("#3718 POSITIVE CONTROL OF THE COMMENT FIXTURE: a grep over its words reads every DRIFT marker, so only the parse can have read it as OK", () => {
  for (const words of [/changesets\/action/, /pull-requests: write/, /git push origin release\/version-packages/, /gh pr create/, /version pull request/]) {
    assert.match(COMMENTS_DESCRIBE_A_VERSION_PR, words);
  }
});

test("#3718: each DRIFT signal fires on its own, and a tag push is not a branch push", () => {
  const job = (body: string): string => `jobs:\n  release:\n${body}`;
  const permission = shapeOf(job("    permissions: { pull-requests: write }\n    uses: a11ign/toolchain/.github/workflows/release.yml@v1\n"));
  assert.equal(permission.state, "DRIFT", "a per-merge call that also asks for pull-requests: write is not per-merge");
  assert.match(permission.detail, /requests `pull-requests: write`/);
  assert.match(shapeOf(`permissions: write-all\n${job("    steps:\n      - run: git push origin --tags\n")}`).detail, /the workflow requests/);
  const branch = shapeOf(job("    steps:\n      - run: git tag v1 && git push origin HEAD:release/next\n"));
  assert.equal(branch.state, "DRIFT");
  assert.match(branch.detail, /pushes a branch/);
  assert.equal(shapeOf(job("    steps:\n      - run: git push\n")).state, "DRIFT", "a bare push offers the current branch");
  assert.match(shapeOf(job("    steps:\n      - run: gh pr create --title x\n")).detail, /runs `gh pr create`/);
  assert.equal(shapeOf(job("    steps:\n      - run: git push origin --tags\n")).state, "OK");
  assert.equal(shapeOf(job("    steps:\n      - run: |\n          git push origin \\\n            \"HEAD:refs/tags/$TAG\"\n")).state, "OK", "a continued line is one command");
});

/** `a11ign`'s `release.yml` as #3772 left it: the consumer gate called with the grant its Quickstart fence asks for, beside the per-merge call. */
const CONSUMER_GATE_WITH_GRANT = `name: release
on: { push: { branches: [main] } }
jobs:
  consumer-gate:
    uses: ./.github/workflows/consumer-gate.yml
    permissions:
      contents: read
      pull-requests: write
  release:
    uses: a11ign/toolchain/.github/workflows/release-per-merge.yml@5ea3fc027eb0891d6329e6a02c2d4ed1c679178a
`;

test("#3777 POSITIVE CONTROL: the consumer gate called with its PR-comment grant reads OK, because the grant opens nothing", () => {
  const cell = shapeOf(CONSUMER_GATE_WITH_GRANT);
  assert.equal(cell.state, "OK", cell.detail);
  assert.match(cell.detail, /calls a11ign\/toolchain\/\.github\/workflows\/release-per-merge\.yml@/);
});

test("#3777: only the call to the local consumer gate is excused the grant; every other signal still reads DRIFT beside it", () => {
  const gate = "  consumer-gate:\n    uses: ./.github/workflows/consumer-gate.yml\n    permissions: { pull-requests: write }\n";
  const perMerge = "  release:\n    uses: a11ign/toolchain/.github/workflows/release-per-merge.yml@v1\n";
  const wrap = (jobs: string, head = ""): string => `${head}jobs:\n${jobs}`;
  const withAction = shapeOf(wrap(`${gate}${perMerge}  version:\n    steps:\n      - uses: changesets/action@v1\n`));
  assert.equal(withAction.state, "DRIFT", "the action in another job is still the version pull request");
  assert.match(withAction.detail, /job `version` uses `changesets\/action`/);
  assert.doesNotMatch(withAction.detail, /consumer-gate/, "the excused grant is not what it names");
  assert.match(shapeOf(wrap(`${gate}${perMerge}`, "permissions: { pull-requests: write }\n")).detail, /the workflow requests/, "a workflow-level grant is not excused by calling the gate");
  const other = shapeOf(wrap(`${perMerge}  lint:\n    uses: ./.github/workflows/lint.yml\n    permissions: { pull-requests: write }\n`));
  assert.equal(other.state, "DRIFT", "a different local workflow with the grant is not the consumer gate");
  assert.match(other.detail, /job `lint` requests `pull-requests: write`/);
  const named = shapeOf(wrap(`${perMerge}  version-pr:\n    uses: ./.github/workflows/consumer-gate.yml\n    permissions: { pull-requests: write }\n`));
  assert.equal(named.state, "DRIFT", "a job NAMED for the version pull request is read by its name, whatever it calls");
  assert.match(named.detail, /has the version pull request job's name/);
  assert.doesNotMatch(named.detail, /requests `pull-requests: write`/, "the grant on a consumer-gate call is not what makes it DRIFT");
});

test("#3777: the cell for `a11ign` reads OK on the committed release.yml, which still carries the consumer gate's grant", () => {
  const text = readFileSync(join(REPO_ROOT, RELEASE_WORKFLOW), "utf8");
  const live = text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  assert.match(live, /pull-requests: write/, "positive control: the grant this test excuses is still on a live line, so OK is the rule's doing");
  const cell = releaseShapeOfText(text);
  assert.equal(cell.state, "OK", cell.detail);
});

test("#3718: a workflow that is neither shape, or cannot be read, is CANNOT_TELL and never OK", () => {
  const neither = shapeOf("jobs:\n  publish:\n    steps:\n      - run: npm publish\n");
  assert.equal(neither.state, "CANNOT_TELL");
  assert.match(neither.detail, /neither shape/);
  assert.equal(shapeOf("jobs:\n  release:\n    uses: ./.github/workflows/local.yml\n").state, "CANNOT_TELL", "a local call is not the reusable per-merge workflow");
  assert.equal(shapeOf("jobs:\n  release:\n    uses: a11ign/toolchain/.github/workflows/test.yml@v1\n").state, "CANNOT_TELL", "another toolchain workflow is not the release");
  assert.equal(shapeOf("jobs: [unclosed\n").state, "CANNOT_TELL");
  assert.match(shapeOf("jobs: [unclosed\n").detail, /does not parse/);
  assert.match(shapeOf("name: release\n").detail, /no `jobs`/);
  assert.match(shapeOf("").detail, /no `jobs`/, "an empty file is not a release");
  for (const read of [{ kind: "refused" }, { kind: "unreadable", why: "HTTP 502" }, { kind: "ok", value: {} },
    { kind: "ok", value: { encoding: "none", content: "" } }] as Read<ContentsAnswer>[]) {
    assert.equal(releaseShapeCell(read).state, "CANNOT_TELL", JSON.stringify(read));
  }
});

test("#3718: a workflow that parses but is structurally unusable is CANNOT_TELL, not a crash (reviewer-3722)", () => {
  const unusable: Record<string, string> = {
    "a null job": "jobs:\n  release: null\n",
    "a job that is a string": "jobs:\n  release: make\n",
    "a job that is a list": "jobs:\n  release:\n    - uses: x\n",
    "steps that are a string": "jobs:\n  release:\n    steps: make\n",
    "a null step": "jobs:\n  release:\n    steps:\n      - null\n",
    "a step that is a bare string": "jobs:\n  release:\n    steps:\n      - git push --tags\n",
    "jobs as a list": "jobs:\n  - run: git push --tags\n",
    "a null job beside a good one": "jobs:\n  release:\n    steps:\n      - run: git push origin --tags\n  other: null\n",
  };
  for (const [what, text] of Object.entries(unusable)) {
    const cell = shapeOf(text);
    assert.equal(cell.state, "CANNOT_TELL", `${what}: ${JSON.stringify(cell)}`);
    assert.match(cell.detail, /cannot be read|not a mapping/, what);
  }
  assert.equal(shapeOf("jobs:\n  release:\n    steps:\n      - run: git push origin --tags\n").state, "OK", "positive control: the same shape, well formed, reads OK");
  assert.equal(shapeOf("jobs:\n  release:\n    runs-on: ubuntu-latest\n").state, "CANNOT_TELL", "a job with no steps and no uses is still read, as neither shape");
});

test("#3718: a declared repository with no release-shape cell is a failure, and DRIFT or CANNOT_TELL in it fail the table", () => {
  const row = tableRow(PUBLISHER, GOOD_READS, NO_ORG);
  assert.deepEqual(tableProblems([row], [PUBLISHER.repo]), []);
  const without = Object.fromEntries(Object.entries(row.cells).filter(([column]) => column !== RELEASE_COLUMN));
  assert.deepEqual(tableProblems([{ ...row, cells: without }], [PUBLISHER.repo]), [`${PUBLISHER.repo} ${RELEASE_COLUMN}: NO CELL, the table did not read it`]);
  for (const [workflow, state] of [[releaseFile(ACTION_STEP), "DRIFT"], [{ kind: "refused" }, "CANNOT_TELL"]] as [Read<ContentsAnswer>, CellState][]) {
    const failing = tableRow(PUBLISHER, { ...GOOD_READS, workflow }, NO_ORG);
    assert.deepEqual(columnsNotOk(failing, state), [RELEASE_COLUMN]);
    assert.equal(tableProblems([failing], [PUBLISHER.repo]).length, 1);
  }
  const [header] = renderTable([row]);
  assert.match(header ?? "", /token +release-shape$/, "the header is as wide as its longest name, so the columns stay aligned");
});

// --- the live table, over every declared repository -------------------------------------------------------

type WorkflowRuns = { workflow_runs?: { id: number; created_at?: string }[] };
type RunJobs = { jobs?: { id: number; name: string; conclusion: string | null }[] };
type Annotations = { message?: string }[];

/** One run's probe job, or `ok(null)` when this run did not conclude it (skipped, still going, or absent). */
function probeOfRun(repo: string, run: { id: number; created_at?: string }): ProbeRead {
  const jobs = ghRead<RunJobs>(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
  if (jobs.kind !== "ok") return jobs;
  const job = (jobs.value.jobs ?? []).find((j) => j.name === TOKEN_JOB && (j.conclusion === "success" || j.conclusion === "failure"));
  if (job === undefined) return { kind: "ok", value: null };
  const at = run.created_at ?? "unknown time";
  if (job.conclusion === "success") return { kind: "ok", value: { runId: run.id, at, conclusion: "success", annotations: [] } };
  const notes = ghRead<Annotations>(`repos/${repo}/check-runs/${job.id}/annotations`);
  if (notes.kind !== "ok") return notes;
  return { kind: "ok", value: { runId: run.id, at, conclusion: "failure", annotations: notes.value.map((n) => n.message ?? "") } };
}

/** The latest default-branch run that concluded the probe job, newest first (a `workflow_dispatch` on the branch counts). */
function readProbe(entry: Entry): ProbeRead {
  if (entry.tokenProbe === undefined) return { kind: "ok", value: null };
  const runs = ghRead<WorkflowRuns>(`repos/${entry.repo}/actions/workflows/${entry.tokenProbe}/runs?branch=${entry.defaultBranch}&per_page=${PROBE_RUNS_WINDOW}`);
  if (runs.kind !== "ok") return runs;
  for (const run of runs.value.workflow_runs ?? []) {
    const found = probeOfRun(entry.repo, run);
    if (found.kind !== "ok" || found.value !== null) return found;
  }
  return { kind: "ok", value: null };
}

type DirEntry = { name?: string; type?: string }[];

/** Every workflow file of the repository that reads the secret, or why that could not be told. Asked only of a repository declaring the token unused. */
function readTokenUse(entry: Entry): TokenUse | null {
  if (entry.tokenUnused === undefined) return null;
  const dir = ghRead<DirEntry>(`repos/${entry.repo}/contents/.github/workflows?ref=${entry.defaultBranch}`);
  if (dir.kind !== "ok") return dir;
  const files: { name: string; text: string }[] = [];
  for (const f of dir.value.filter((d) => d.type === "file" && WORKFLOW_FILE.test(d.name ?? ""))) {
    const body = ghRead<ContentsAnswer>(`repos/${entry.repo}/contents/.github/workflows/${f.name}?ref=${entry.defaultBranch}`);
    if (body.kind !== "ok") return body;
    if (typeof body.value.content !== "string" || body.value.encoding !== "base64") return { kind: "unreadable", why: `${f.name} came back without base64 content` };
    files.push({ name: f.name ?? "", text: Buffer.from(body.value.content, "base64").toString("utf8") });
  }
  return { kind: "ok", value: workflowsReadingToken(files) };
}

function readRepo(entry: Entry): RepoReads {
  const envs = ghRead<EnvironmentList>(`repos/${entry.repo}/environments`);
  const hasEnv = envs.kind === "ok" && (envs.value.environments ?? []).some((e) => e.name === PUBLISH_ENV);
  return {
    settings: ghRead(`repos/${entry.repo}`),
    protection: liveRead(entry),
    envs,
    policies: hasEnv ? ghRead(`repos/${entry.repo}/environments/${PUBLISH_ENV}/deployment-branch-policies`) : null,
    probe: readProbe(entry),
    tokenUse: readTokenUse(entry),
    workflow: ghRead(`repos/${entry.repo}/contents/${RELEASE_WORKFLOW}?ref=${entry.defaultBranch}`),
  };
}

test("#3705 LIVE: every code repository is read against docs/new-code-repository.md, one table, DRIFT and CANNOT_TELL fail", () => {
  // OPT-IN under the same switch as the read above, for the same reason. It reads EVERY declared repository, so
  // `A11Y_PROTECTION_REPO` (one repository, possibly not yet declared) does not narrow it.
  if (process.env.A11Y_CHECK_MAIN_RULESET !== "1") {
    console.log("  NOT RUN: the live settings table is opt-in -- `A11Y_CHECK_MAIN_RULESET=1` asks GitHub about every declared "
      + "repository (settings, environments, the bots team, pull requests, a search). Nothing here read one.");
    return;
  }
  const declared = declaredRepositories();
  const entries = protectionEntries();
  const org: OrgReads = { bots: ghRead(`orgs/a11ign/teams/bots/repos?per_page=${BOTS_PAGE}`), trackers: readJson<ProjectFile>(PROJECT_FILE).tracker.map((t) => t.repo) };
  const rows = entries.filter((e) => declared.includes(e.repo)).map((entry) => tableRow(entry, readRepo(entry), org));
  assert.ok(rows.length >= 1, "no repository to read: the declared list was empty, and an empty read certifies nothing");
  const lines = renderTable(rows);
  console.log(lines.join("\n"));
  for (const r of rows) console.log(`  ${RELEASE_COLUMN} ${r.repo}: ${r.cells[RELEASE_COLUMN]?.state ?? "NO CELL"} ${r.cells[RELEASE_COLUMN]?.detail ?? ""}`);
  const problems = tableProblems(rows, declared);
  for (const p of problems) console.log(`  ${p}`);
  assert.deepEqual(problems, [], "a repository drifts from docs/new-code-repository.md, or a setting could not be read: neither is a pass");
});
