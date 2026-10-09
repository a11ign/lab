/**
 * #3124 (ADR 0039, item 7, under #69): THE PERMISSION EACH ACCOUNT HOLDS ON EACH CODE REPOSITORY IS DECLARED,
 * PINNED AND READ BACK, AND NO AGENT ACCOUNT IS `admin`.
 *
 * The accounts reach every repository through the `gh` routing wrapper and the host-scoped git credential
 * helper, and neither names a repository, so a NEW repository changes nothing they do. What a new repository
 * does change is the permission the accounts hold on it, and that was declared nowhere: measured 2026-10-03,
 * `a11ign/screenreader-worker` gives all four agent accounts `admin` through the org team `bots`, against the
 * tracker's `write` and against the sentence `host-units.mjs` still carries ("write, not admin"). An agent with
 * admin can edit the protection that `main-review-requirement.md` says nobody may walk past.
 *
 * `docs/repository-access.json` is the declaration; this file pins it. The opt-in read of
 * `repos/<r>/collaborators` against it is `layer-repository-access-live.test.ts`, a separate file because it
 * spawns `gh` and this one is a row's Acceptance command, run by a job with no token. Nothing here changes
 * GitHub: the downgrade is an org-admin act, the chairman's (`docs/repository-access.md`).
 *
 * The wrapper and `host-units.mjs` live in `a11ign/agent-org` (the checkout `.agent-org/host.json` names), so they
 * are read as TEXT and edited by nobody here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolPath } from "../../../../scripts/agent-org-newest-tag.mjs";

const rootFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

const AGENT_ACCOUNTS = ["a11ign-bot", "a11ign-ai-workers", "a11ign-ai-leads", "a11ign-ci"];
const PERSON_ACCOUNTS = ["DanBeckDev", "Cemmaw"];
/** The one account allowed to administer a code repository (ADR 0039, item 7). */
const ADMINISTRATOR = "DanBeckDev";
/** Exists today (public, created empty 2026-09-26) and is not in `code` until #2701 moves code into it. */
const LAYER_NOT_YET_DECLARED = "a11ign/screenreader-worker";
const ROLES = ["admin", "write", "read", "none"];
/** The tracker, agent-org and screenreader-worker: a walk that finds fewer has stopped reading something. */
const MIN_REPOSITORIES = 3;

type Role = string;
type Declaration = {
  accounts: { person: string[]; agent: string[] };
  teams: { bots: { layer: string } };
  repositories: Record<string, Record<string, Role>>;
};

const declaration = (): Declaration => JSON.parse(rootFile("docs/repository-access.json"));

/** Every code repository the org opens pull requests in, plus the layer that exists before it is declared. */
function expectedRepositories(): string[] {
  const project = JSON.parse(rootFile(".agent-org/project.json")) as { code: Array<{ repo: string }> };
  return [...new Set([...project.code.map((entry) => entry.repo), LAYER_NOT_YET_DECLARED])].sort();
}

/** Every way a declaration breaks the model, each naming the repository and account. Empty means it holds. */
function violations(decl: Declaration): string[] {
  const named = [...decl.accounts.person, ...decl.accounts.agent];
  const found: string[] = [];
  for (const [repo, roles] of Object.entries(decl.repositories)) {
    for (const account of named) {
      const role = roles[account];
      if (role === undefined) found.push(`${repo}: ${account} carries no role`);
      else if (!ROLES.includes(role)) found.push(`${repo}: ${account} has the unknown role "${role}"`);
      else if (role === "admin" && decl.accounts.agent.includes(account)) {
        found.push(`${repo}: agent account ${account} is admin`);
      } else if (role === "admin" && account !== ADMINISTRATOR) found.push(`${repo}: ${account} is admin`);
    }
    for (const account of Object.keys(roles)) {
      if (!named.includes(account)) found.push(`${repo}: ${account} is declared but is not a known account`);
    }
    if (roles[ADMINISTRATOR] !== "admin") found.push(`${repo}: ${ADMINISTRATOR} must be admin`);
  }
  return found;
}

test("#3124: the declaration lists every code repository plus screenreader-worker, and the list is not empty", () => {
  const expected = expectedRepositories();
  assert.ok(expected.length >= MIN_REPOSITORIES, `positive control: the union is ${expected.length} repositories, not an empty walk`);
  assert.ok(expected.includes("a11ign/a11ign"), "positive control: the tracker is a code repository");
  assert.deepEqual(Object.keys(declaration().repositories).sort(), expected);
});

test("#3124: the six accounts are the ones the row names, and each carries a role on every repository", () => {
  const decl = declaration();
  assert.deepEqual([...decl.accounts.agent].sort(), [...AGENT_ACCOUNTS].sort());
  assert.deepEqual([...decl.accounts.person].sort(), [...PERSON_ACCOUNTS].sort());
  const missing = violations(decl).filter((line) => /carries no role|unknown role|not a known account/.test(line));
  assert.deepEqual(missing, []);
});

test("#3124: no agent account is admin anywhere, and the declaration as shipped breaks nothing", () => {
  assert.deepEqual(violations(declaration()), []);
});

test("#3124: a fixture that gives an agent account admin is REFUSED, naming the account", () => {
  const fixture = declaration();
  const [repo] = Object.keys(fixture.repositories);
  fixture.repositories[repo]["a11ign-ai-workers"] = "admin";
  assert.deepEqual(violations(fixture), [`${repo}: agent account a11ign-ai-workers is admin`]);
});

test("#3124: the other refusals each fire alone -- a missing role, an unknown role, a second human admin", () => {
  const missing = declaration();
  delete missing.repositories["a11ign/a11ign"]["a11ign-ci"];
  assert.deepEqual(violations(missing), ["a11ign/a11ign: a11ign-ci carries no role"]);

  const unknown = declaration();
  unknown.repositories["a11ign/a11ign"]["a11ign-ci"] = "maintain";
  assert.deepEqual(violations(unknown), ['a11ign/a11ign: a11ign-ci has the unknown role "maintain"']);

  const secondAdmin = declaration();
  secondAdmin.repositories["a11ign/a11ign"].Cemmaw = "admin";
  assert.deepEqual(violations(secondAdmin), ["a11ign/a11ign: Cemmaw is admin"]);

  const noAdministrator = declaration();
  noAdministrator.repositories["a11ign/a11ign"][ADMINISTRATOR] = "write";
  assert.deepEqual(violations(noAdministrator), [`a11ign/a11ign: ${ADMINISTRATOR} must be admin`]);
});

test("#3124: the bots team is declared at `push` on a layer, never admin", () => {
  assert.equal(declaration().teams.bots.layer, "push");
});

test("#3124: the gh wrapper names no repository, and does name accounts (the control that the read saw it)", () => {
  const wrapper = readFileSync(toolPath("host/gh"), "utf8");
  assert.match(wrapper, /a11ign-ai-workers/, "positive control: the wrapper is the real file and names accounts");
  assert.match(wrapper, /a11ign-ai-leads/, "positive control: ...both of the accounts it routes to");
  assert.deepEqual(wrapper.match(/a11ign\/[a-z][\w.-]*/g) ?? [], [], "a repository named in the wrapper is a per-repository table");
});

test("#3124: host-units.mjs's \"write, not admin\" sentence and the declaration agree about a11ign-ai-leads", () => {
  const sentences = readFileSync(toolPath("src/host-units.mjs"), "utf8")
    .split("\n")
    .filter((line) => line.includes("write, not admin"));
  assert.ok(sentences.length > 0, "positive control: the sentence is still there to be pinned");
  const unnamed = sentences.filter((line) => !line.includes("a11ign-ai-leads"));
  assert.deepEqual(unnamed, [], "each occurrence is about the leads account, which is what the declaration is compared to");
  const roles = Object.entries(declaration().repositories).map(([repo, held]) => `${repo}:${held["a11ign-ai-leads"]}`);
  assert.deepEqual(roles.filter((entry) => !entry.endsWith(":write")), [], "the declaration says write, as the sentence does");
});

