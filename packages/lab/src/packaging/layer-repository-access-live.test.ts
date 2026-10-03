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
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Role = string;
type Declaration = { repositories: Record<string, Record<string, Role>> };

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
