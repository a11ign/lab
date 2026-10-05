/**
 * #3124: THE LIVE HALF OF `layer-repository-access.test.ts` -- `repos/<r>/collaborators`, READ BACK AGAINST
 * `docs/repository-access.json` AND EACH DIFFERENCE NAMED.
 *
 * It is its own file for `auto-arm-token-live.test.ts`'s reason: it spawns `gh`, and the declaration test is a
 * row's Acceptance command, run by an acceptance job that has no token. The declaration's pins live there.
 *
 * ASKED, THE READ MUST ANSWER. Whoever sets `A11Y_CHECK_REPO_ACCESS=1` is asking on purpose, so only PASS
 * answers it: a difference and a repository that could not be read (`CANNOT_TELL`) are both red. NOT RUN (no
 * opt-in) is the only quiet exit, and it says so. It is EXPECTED to be red on `screenreader-worker` until the
 * chairman has downgraded the `bots` team (`docs/repository-access.md`); that is the finding, not a defect.
 *
 * #3631: THE TEAM'S OWN LEVEL. `repos/<r>/collaborators` lists the four agent ACCOUNTS and never the team that grants
 * them the level, and `repos/<r>/teams`, which does, answers 404 to a token without admin. `orgs/a11ign/teams/bots/repos`
 * answers a non-admin with the `admin`/`push` booleans per repository, so that is the instrument here, and a 404 from
 * it is `CANNOT_TELL` for THAT TOKEN, never a pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Role = string;
type Declaration = { repositories: Record<string, Record<string, Role>>; teams: { bots: { layer: Role } } };

const declaration = (): Declaration =>
  JSON.parse(readFileSync(new URL("../../../../docs/repository-access.json", import.meta.url), "utf8"));

type Verdict = "PASS" | "FAIL" | "CANNOT_TELL";

/** Compares what GitHub lists to what is declared, by account. An account GitHub does not list holds `none`. */
function differences(repo: string, held: Record<string, Role>, observed: Map<string, Role>): string[] {
  const found: string[] = [];
  for (const [account, role] of Object.entries(held)) {
    const actual = observed.get(account) ?? "none";
    if (actual !== role) found.push(`${repo}: ${account} holds ${actual}, declared ${role}`);
  }
  for (const [account, actual] of observed) {
    if (!(account in held)) found.push(`${repo}: ${account} holds ${actual} and is not declared`);
  }
  return found;
}

/** One repository's reading: the differences, or CANNOT_TELL when `gh` could not list its collaborators. */
function readRepository(repo: string, held: Record<string, Role>, list: (repo: string) => string): { verdict: Verdict; lines: string[] } {
  let text: string;
  try {
    text = list(repo);
  } catch (cause) {
    return { verdict: "CANNOT_TELL", lines: [`${repo}: collaborators could not be read (${(cause as Error).message.split("\n")[0]})`] };
  }
  const observed = new Map(text.split("\n").filter(Boolean).map((line) => line.split(":") as [string, Role]));
  const lines = differences(repo, held, observed);
  return { verdict: lines.length > 0 ? "FAIL" : "PASS", lines };
}

const listCollaborators = (repo: string): string =>
  execFileSync("gh", ["api", `repos/${repo}/collaborators`, "--paginate", "--jq", '.[]|.login+":"+.role_name'], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

test("#3124: the live read names each difference, and a repository it cannot read is CANNOT_TELL, never PASS", () => {
  const held = declaration().repositories["a11ign/screenreader-worker"];
  const admins = () => Object.keys(held).map((account) => `${account}:admin`).join("\n");
  const today = readRepository("a11ign/screenreader-worker", held, admins);
  assert.equal(today.verdict, "FAIL");
  assert.ok(today.lines.includes("a11ign/screenreader-worker: a11ign-ai-workers holds admin, declared write"));
  assert.ok(today.lines.includes("a11ign/screenreader-worker: Cemmaw holds none, declared none") === false, "agreement is not a difference");

  const exact = () => Object.entries(held).filter(([, role]) => role !== "none").map(([account, role]) => `${account}:${role}`).join("\n");
  assert.equal(readRepository("a11ign/screenreader-worker", held, exact).verdict, "PASS");

  const stranger = () => `${exact()}\nsomeone-else:write`;
  assert.deepEqual(readRepository("a11ign/screenreader-worker", held, stranger).lines,
    ["a11ign/screenreader-worker: someone-else holds write and is not declared"]);

  const unreadable = () => { throw new Error("HTTP 404"); };
  assert.equal(readRepository("a11ign/screenreader-worker", held, unreadable).verdict, "CANNOT_TELL");
});

test("#3124 LIVE: every code repository gives each account the role declared, asked of GitHub", () => {
  // OPT-IN, for `auto-arm-token-live.test.ts`'s reason: a test that spawns `gh` whenever a token happens to be
  // present asks GitHub on every local run. An agent asks deliberately.
  if (process.env.A11Y_CHECK_REPO_ACCESS !== "1") {
    console.log("  NOT RUN: the live repository-access read is opt-in -- `A11Y_CHECK_REPO_ACCESS=1 pnpm exec tsx --test "
      + "packages/lab/src/packaging/layer-repository-access.test.ts` reads `repos/<r>/collaborators` for each declared "
      + "repository. The logic above ran against synthetic listings; nothing here read GitHub.");
    return;
  }
  const readings = Object.entries(declaration().repositories).map(([repo, held]) => readRepository(repo, held, listCollaborators));
  for (const { verdict, lines } of readings) {
    for (const line of lines) console.log(`  REPOSITORY ACCESS ${verdict}: ${line}`);
  }
  const verdicts = new Set(readings.map((reading) => reading.verdict));
  const overall: Verdict = verdicts.has("FAIL") ? "FAIL" : verdicts.has("CANNOT_TELL") ? "CANNOT_TELL" : "PASS";
  console.log(`  REPOSITORY ACCESS: ${overall} across ${readings.length} repositories`);
  assert.equal(overall, "PASS", "a difference or an unreadable repository is not a pass");
});

type TeamRepository = { repo: string; level: string };

/** GitHub's `permissions` booleans, highest first: the team's level on a repository is the first one that is true. */
const LEVELS = ["admin", "maintain", "push", "triage", "pull"] as const;

/** One `full_name<TAB>admin<TAB>maintain<TAB>push<TAB>triage<TAB>pull` line per repository, as `listTeamRepositories` emits. */
function parseTeamListing(text: string): TeamRepository[] {
  return text.split("\n").filter(Boolean).map((line) => {
    const [repo, ...flags] = line.split("\t");
    return { repo, level: LEVELS.find((_, index) => flags[index] === "true") ?? "none" };
  });
}

/**
 * The rule: `bots` holds `admin` NOWHERE it reaches, and `push` on every repository the file declares. A repository the
 * team reaches that the file does not declare is named only when the level is `admin`, in the collaborators read's wording.
 */
function teamDifferences(declared: string[], pushLevel: Role, reached: TeamRepository[]): string[] {
  const found: string[] = [];
  const held = new Map(reached.map(({ repo, level }) => [repo, level]));
  for (const repo of declared) {
    const actual = held.get(repo) ?? "none";
    if (actual !== pushLevel) found.push(`${repo}: the bots team holds ${actual}, declared ${pushLevel}`);
  }
  for (const { repo, level } of reached) {
    if (!declared.includes(repo) && level === "admin") found.push(`${repo}: the bots team holds ${level} and is not declared`);
  }
  return found;
}

/** The team's reading: the differences, or CANNOT_TELL when `gh` could not list the team's repositories (a non-admin 404). */
function readTeam(
  declaration: Pick<Declaration, "teams"> & { declared: string[] },
  list: () => string,
): { verdict: Verdict; lines: string[] } {
  let text: string;
  try {
    text = list();
  } catch (cause) {
    return { verdict: "CANNOT_TELL", lines: [`the bots team's repositories could not be read (${(cause as Error).message.split("\n")[0]})`] };
  }
  const lines = teamDifferences(declaration.declared, declaration.teams.bots.layer, parseTeamListing(text));
  return { verdict: lines.length > 0 ? "FAIL" : "PASS", lines };
}

const listTeamRepositories = (): string =>
  execFileSync("gh", ["api", "orgs/a11ign/teams/bots/repos", "--paginate", "--jq",
    '.[]|[.full_name,.permissions.admin,.permissions.maintain,.permissions.push,.permissions.triage,.permissions.pull]|@tsv'], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** A listing line as GitHub reports it: every boolean at or below `level` is true. */
const teamLine = (repo: string, level: (typeof LEVELS)[number]): string =>
  `${repo}\t${LEVELS.map((_, index) => String(index >= LEVELS.indexOf(level))).join("\t")}`;

test("#3631: the team read names admin, a declared repository not at push and an undeclared admin; a 404 is CANNOT_TELL, never PASS", () => {
  const fixture = { teams: { bots: { layer: "push" } }, declared: ["a11ign/a11ign", "a11ign/control"] };
  const exact = [teamLine("a11ign/a11ign", "push"), teamLine("a11ign/control", "push"), teamLine("a11ign/corpus-backups", "push")].join("\n");
  assert.deepEqual(readTeam(fixture, () => exact), { verdict: "PASS", lines: [] }, "push on both declared and push on an undeclared one is clean");

  const admin = exact.replace(teamLine("a11ign/control", "push"), teamLine("a11ign/control", "admin"));
  assert.deepEqual(readTeam(fixture, () => admin).lines, ["a11ign/control: the bots team holds admin, declared push"]);

  const lower = exact.replace(teamLine("a11ign/a11ign", "push"), teamLine("a11ign/a11ign", "pull"));
  assert.deepEqual(readTeam(fixture, () => lower).lines, ["a11ign/a11ign: the bots team holds pull, declared push"]);

  const absent = teamLine("a11ign/a11ign", "push");
  assert.deepEqual(readTeam(fixture, () => absent).lines, ["a11ign/control: the bots team holds none, declared push"]);

  const stranger = `${exact}\n${teamLine("a11ign/auth-capture-check", "admin")}`;
  assert.deepEqual(readTeam(fixture, () => stranger).lines, ["a11ign/auth-capture-check: the bots team holds admin and is not declared"]);

  const unreadable = () => { throw new Error("HTTP 404"); };
  assert.equal(readTeam(fixture, unreadable).verdict, "CANNOT_TELL");
});

test("#3631 LIVE: the bots team holds push on every declared repository and admin on none it reaches, asked of GitHub", () => {
  if (process.env.A11Y_CHECK_REPO_ACCESS !== "1") {
    console.log("  NOT RUN: the live team read is opt-in -- `A11Y_CHECK_REPO_ACCESS=1 pnpm exec tsx --test "
      + "packages/lab/src/packaging/layer-repository-access-live.test.ts` reads `orgs/a11ign/teams/bots/repos`. "
      + "The logic above ran against synthetic listings; nothing here read GitHub.");
    return;
  }
  const { repositories, teams } = declaration();
  const { verdict, lines } = readTeam({ teams, declared: Object.keys(repositories) }, listTeamRepositories);
  for (const line of lines) console.log(`  TEAM ACCESS ${verdict}: ${line}`);
  console.log(`  TEAM ACCESS: ${verdict} across ${Object.keys(repositories).length} declared repositories`);
  assert.equal(verdict, "PASS", "a difference or an unreadable team listing is not a pass");
});
