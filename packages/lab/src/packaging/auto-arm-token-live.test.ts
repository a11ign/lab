/**
 * #2358: A SWAP OF `A11IGN_BOT_TOKEN` BACK TO A PERSON IS A RED TEST, READ FROM GITHUB'S OWN TIMELINE.
 *
 * The secret's value never reaches the repository, so nothing can read WHO holds it. What GitHub does
 * record is who ACTED with it: the `auto_merge_enabled` / `added_to_merge_queue` actor on a pull request's
 * timeline, and its `mergedBy`. `auto-arm-token.test.ts` pins the secret's NAME and says which account is
 * expected to hold it; this file reads the acting identity back. It is separate because it spawns `gh`,
 * and that file is a row's Acceptance command, run by an acceptance job that has no token (the reason
 * `arm-pr-labels-live.test.ts` is its own file too).
 *
 * THE RULE BEING PINNED (#1950/#2333): no agent acts as the chairman, and CI is not an exception. Before
 * 2026-09-24T19:54:17Z the secret was the chairman's personal token and 23 of the last 40 merges were
 * `mergedBy: DanBeckDev`. Only PRs merged AFTER that instant are read, so the history that was true then
 * does not turn this red now.
 *
 * THE VERDICT HAS THREE STATES, because absence is not proof: `a11ign-ci` acting and nobody-a-person is a
 * pass; a person acting is the failure; and no `a11ign-ci` action in the window is CANNOT_TELL, never a pass
 * (a window in which only sessions armed proves nothing about the secret).
 *
 * ASKED, THE READ MUST ANSWER. The live read is opt-in, so whoever sets `A11Y_CHECK_ARMING_IDENTITY=1` is
 * asking the question on purpose, and only PASS answers it: FAIL, CANNOT_TELL and a `gh` that could not be
 * asked are all red. NOT RUN (no opt-in) is the only quiet exit, and it says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { SECRET_HOLDER as EXPECTED_ACTOR, PERSONAL_ACCOUNTS, SWAPPED_AT } from "./auto-arm-identity.ts";

const RECENT_MERGES = 20;

type Verdict = "PASS" | "FAIL" | "CANNOT_TELL";
/** One actor's act on one pull request: `auto_merge_enabled`, `added_to_merge_queue` or `merged`. */
type Act = { pr: number; event: string; actor: string };

/** Reads acts and says whether the arming identity is still a machine account. */
function armingIdentityVerdict(acts: Act[]): { verdict: Verdict; why: string } {
  const person = acts.find((a) => PERSONAL_ACCOUNTS.includes(a.actor));
  if (person) {
    return { verdict: "FAIL", why: `#${person.pr} ${person.event} by ${person.actor}, a personal account: `
      + "the secret has gone back to a person (#2358)" };
  }
  if (!acts.some((a) => a.actor === EXPECTED_ACTOR)) {
    return { verdict: "CANNOT_TELL", why: `no act by ${EXPECTED_ACTOR} in ${acts.length} act(s) since ${SWAPPED_AT}: `
      + "a window with only other identities says nothing about the secret" };
  }
  return { verdict: "PASS", why: `${EXPECTED_ACTOR} acted and no personal account did` };
}

test("#2358: a personal account acting after the swap is FAIL, even beside a11ign-ci", () => {
  const { verdict, why } = armingIdentityVerdict([
    { pr: 2411, event: "auto_merge_enabled", actor: EXPECTED_ACTOR },
    { pr: 2500, event: "merged", actor: "DanBeckDev" },
  ]);
  assert.equal(verdict, "FAIL");
  assert.match(why, /#2500 merged by DanBeckDev/);
});

test("#2358: the machine account alone is PASS -- the positive control for the FAIL above", () => {
  const acts: Act[] = [{ pr: 2411, event: "merged", actor: EXPECTED_ACTOR }];
  assert.equal(armingIdentityVerdict(acts).verdict, "PASS");
  assert.equal(armingIdentityVerdict([...acts, { pr: 2412, event: "merged", actor: "a11ign-ai-workers" }]).verdict,
    "PASS", "a session merging by hand is not the chairman: only the named personal accounts fail");
});

test("#2358: no act by the machine account is CANNOT_TELL, never PASS -- silence is not proof", () => {
  assert.equal(armingIdentityVerdict([]).verdict, "CANNOT_TELL");
  assert.equal(armingIdentityVerdict([{ pr: 2412, event: "merged", actor: "a11ign-ai-workers" }]).verdict,
    "CANNOT_TELL");
});

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** The acts on recently merged PRs, the merge itself included. Throws when `gh` cannot be asked. */
function readActs(): Act[] {
  const merged: { number: number; mergedAt: string; mergedBy: { login: string } | null }[] = JSON.parse(gh([
    "pr", "list", "--repo", "a11ign/a11ign", "--state", "merged", "--limit", String(RECENT_MERGES),
    "--json", "number,mergedAt,mergedBy"]));
  const since = Date.parse(SWAPPED_AT);
  const acts: Act[] = [];
  for (const pr of merged.filter((m) => Date.parse(m.mergedAt) > since)) {
    if (pr.mergedBy) acts.push({ pr: pr.number, event: "merged", actor: pr.mergedBy.login });
    const timeline = gh(["api", `repos/a11ign/a11ign/issues/${pr.number}/timeline`, "--paginate", "--jq",
      '.[]|select(.event=="auto_merge_enabled" or .event=="added_to_merge_queue")|"\\(.event) \\(.actor.login)"']);
    for (const line of timeline.split("\n").filter(Boolean)) {
      const [event, actor] = line.split(" ");
      acts.push({ pr: pr.number, event, actor });
    }
  }
  return acts;
}

/** The verdict for a read that may throw: a check that could not ask is CANNOT_TELL, never a pass. */
function liveVerdict(read: () => Act[]): { verdict: Verdict; why: string } {
  try {
    return armingIdentityVerdict(read());
  } catch (cause) {
    return { verdict: "CANNOT_TELL", why: `\`gh\` could not be asked (${String(cause)})` };
  }
}

test("#2358: a read that throws is CANNOT_TELL, and only PASS satisfies the opted-in check", () => {
  const thrown = liveVerdict(() => { throw new Error("no token"); });
  assert.equal(thrown.verdict, "CANNOT_TELL");
  assert.match(thrown.why, /could not be asked/);
  assert.equal(liveVerdict(() => []).verdict, "CANNOT_TELL");
  assert.equal(liveVerdict(() => [{ pr: 1, event: "merged", actor: EXPECTED_ACTOR }]).verdict, "PASS");
});

test("#2358 LIVE: nothing armed or merged since the swap acted as a personal account, asked of GitHub", () => {
  // OPT-IN, for `arm-pr-labels-live.test.ts`'s reason: a test that spawns `gh` whenever a token happens to
  // be present asks GitHub on every local run. An agent asks deliberately.
  if (process.env.A11Y_CHECK_ARMING_IDENTITY !== "1") {
    console.log("  NOT RUN: the live arming-identity read is opt-in -- `A11Y_CHECK_ARMING_IDENTITY=1 npx tsx "
      + "--test packages/lab/src/packaging/auto-arm-token-live.test.ts` reads who armed and merged. The verdict "
      + "logic above ran against synthetic acts; nothing here read GitHub.");
    return;
  }
  const { verdict, why } = liveVerdict(readActs);
  console.log(`  ARMING IDENTITY: ${verdict} -- ${why}`);
  assert.equal(verdict, "PASS", why);
});
