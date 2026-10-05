// no-token: token-cost.mjs -- every test drives pure functions over injected transcript lines and call/pull-request lists; nothing here spawns `gh`, reads a real transcript or reaches the network.
/**
 * CALLS AND DOLLARS PER MERGED PULL REQUEST (#3217): the chairman's other two targets, read from the host's session transcripts.
 *
 * The price list in every cost test is a FIXTURE VALUE, never the live one, so a change of price changes the cost and a call that
 * forgets to pass the list fails. Each emptiness assertion sits beside the fixture that is its positive control.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CATEGORIES, PRICE_LIST, attributeCalls, biggestContributor, callsFromTranscript, categoryOf, costOfCall, countContributors,
  failureIntervals, markRereads, parseHours, readRepository, readTargetsFile, readWindow, renderSection, reviewRounds,
  unreadSection, windowContains, withFiveMinuteWrites,
} from "../../../../scripts/token-cost.mjs";
import { TARGETS_FILE, targetsFrom } from "../../../../scripts/ci-health.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const TARGETS = targetsFrom(JSON.parse(readFileSync(TARGETS_FILE, "utf8")));

// ---- fixtures ------------------------------------------------------------------------------------------

/** Per million tokens, every field distinct so a call that prices one class at another's rate changes the answer. */
const PRICES = {
  readOn: "2026-01-01", source: "fixture",
  perMillionTokens: { "fixture-model": { input: 10, output: 50, cacheRead: 1, cacheWrite5m: 12, cacheWrite1h: 20 } },
};
const TOKENS = { input: 1000, output: 500, cacheRead: 10_000, write5m: 2000, write1h: 4000 };

let nextId = 1;
/** One call, fully formed, with only what a test cares about overridden. */
const call = (over: Record<string, unknown> = {}) => ({
  id: `msg_${nextId++}`, at: "2026-10-01T10:00:00.000Z", model: "fixture-model", tokens: { ...TOKENS }, file: "a.jsonl", name: null as string | null,
  branch: null as string | null, firstInSession: false, afterCompaction: false, reread: false, waitTurn: false,
  waitBy: "" as "" | "idle nudge" | "nothing to do", ...over,
});
const pull = (number: number, branch: string, over: Record<string, unknown> = {}) => ({
  repository: "a11ign/a11ign", number, branch, author: "author", mergedAt: "2026-10-01T12:00:00Z", rounds: [] as { from: string; to: string }[],
  failures: [] as { from: string; to: string }[], ...over,
});
const on = (branch: string, n: number, over: Record<string, unknown> = {}) => Array.from({ length: n }, () => call({ branch, ...over }));

/** One transcript line the way Claude Code writes it: ONE line PER CONTENT BLOCK of a request, usage repeated. */
const assistant = (id: string, at: string, over: { output?: number; text?: string; model?: string; branch?: string } = {}) => JSON.stringify({
  type: "assistant", timestamp: at, gitBranch: over.branch ?? "agent/x-1",
  message: {
    id, model: over.model ?? "fixture-model", content: [{ type: "text", text: over.text ?? "" }],
    usage: { input_tokens: 1, output_tokens: over.output ?? 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4,
      cache_creation: { ephemeral_5m_input_tokens: 1, ephemeral_1h_input_tokens: 3 } },
  },
});
const user = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } });
const toolResult = () => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "x" }] } });
const read = (lines: string[], file = "a.jsonl") => callsFromTranscript({ file, lines });

// ---- 1. the cost of a call -----------------------------------------------------------------------------

test("cost of a call: cache reads, cache writes (5m and 1h) and plain input each priced at their own rate, from the list passed in", () => {
  const cost = costOfCall(call(), PRICES);
  assert.ok(cost !== null && Math.abs(cost - 0.149) < 1e-12, `expected 0.149, got ${cost}`);
  // each token class is priced: raising ONE price by 1 raises the cost by exactly that class's tokens / 1e6
  const classes = [["input", TOKENS.input], ["output", TOKENS.output], ["cacheRead", TOKENS.cacheRead], ["cacheWrite5m", TOKENS.write5m], ["cacheWrite1h", TOKENS.write1h]] as const;
  for (const [field, tokens] of classes) {
    const bumped = { ...PRICES, perMillionTokens: { "fixture-model": { ...PRICES.perMillionTokens["fixture-model"], [field]: PRICES.perMillionTokens["fixture-model"][field] + 1 } } };
    assert.ok(Math.abs((costOfCall(call(), bumped) as number) - (cost as number) - tokens / 1e6) < 1e-12, `${field} is not priced`);
  }
});

test("cost of a call: a changed price changes the cost, and a call made without the list FAILS rather than costing nothing", () => {
  const doubled = { ...PRICES, perMillionTokens: { "fixture-model": Object.fromEntries(Object.entries(PRICES.perMillionTokens["fixture-model"]).map(([k, v]) => [k, v * 2])) } };
  assert.ok(Math.abs((costOfCall(call(), doubled as typeof PRICES) as number) - 0.298) < 1e-12);
  assert.throws(() => (costOfCall as (c: unknown, p?: unknown) => unknown)(call(), undefined), TypeError);
});

test("cost of a call: a model off the list is UNPRICED (null), never $0, and a dated snapshot prices as its family", () => {
  assert.equal(costOfCall(call({ model: "no-such-model" }), PRICES), null);
  const dated = { ...PRICES, perMillionTokens: { "claude-haiku-4-5": PRICES.perMillionTokens["fixture-model"] } };
  assert.equal(costOfCall(call({ model: "claude-haiku-4-5-20251001" }), dated), costOfCall(call(), PRICES));
});

test("the live list prices every model the transcripts show, and the 5-minute-write proxy lowers a 1-hour write to the 5-minute rate only", () => {
  for (const model of ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "claude-opus-5", "claude-haiku-4-5-20251001"]) {
    assert.notEqual(costOfCall(call({ model }), PRICE_LIST), null, `${model} is unpriced`);
  }
  const proxied = costOfCall(call(), withFiveMinuteWrites(PRICES)) as number;
  assert.ok(Math.abs(proxied - (0.149 - (4000 * (20 - 12)) / 1e6)) < 1e-12);
});

// ---- 2. calls and dollars per merged pull request, and the remainder ------------------------------------

const pulls = [pull(1, "agent/one-1"), pull(2, "agent/two-2")];
const reading = (calls: ReturnType<typeof call>[], over: { pulls?: typeof pulls; minimum?: number } = {}) => {
  const used = over.pulls ?? pulls;
  const { byPull, noPull } = attributeCalls({ calls, pulls: used });
  const repository = readRepository({ repository: "a11ign/a11ign", pulls: used, byPull, prices: PRICES, minimum: over.minimum ?? 1 });
  const whole = readWindow({ calls, noPull, merged: used.length, prices: PRICES });
  return { repository, whole, noPull, byPull };
};
const section = (r: ReturnType<typeof reading>, over: { targets?: typeof TARGETS; minimum?: number } = {}) => renderSection({
  readings: [r.repository], whole: r.whole, targets: over.targets ?? TARGETS, prices: PRICES, window: { since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z" },
  commit: "abc", rateLimit: "fixture", minimum: over.minimum ?? 1,
});

test("calls and dollars per merged pull request: each PR gets the calls its branch names, and attributed + UNATTRIBUTED = every call", () => {
  const calls = [...on("agent/one-1", 3), ...on("agent/two-2", 1), ...on("main", 2), call()];
  const r = reading(calls);
  assert.equal(r.byPull.get("a11ign/a11ign#1")?.length, 3);
  assert.equal(r.byPull.get("a11ign/a11ign#2")?.length, 1);
  assert.equal(r.repository.calls, 4);
  assert.equal(r.noPull.length, 3);
  assert.equal(r.repository.calls + r.noPull.length, calls.length, "attributed plus the remainder is the total");
  assert.equal(r.repository.callsPerPull, 2);
  assert.ok(Math.abs((r.repository.dollarsPerPull as number) - 0.149 * 2) < 1e-12);
  assert.equal(r.whole.callsPerPull, 3.5, "the chairman's figure: ALL calls over merged pull requests");
});

test("the remainder is printed as its own line: non-zero when calls belong to no pull request (positive control), zero when none do", () => {
  const withRemainder = section(reading([...on("agent/one-1", 2), ...on("main", 3), ...on("agent/two-2", 1)]));
  assert.match(withRemainder, /UNATTRIBUTED \(calls that belong to no merged pull request\): 3 of 6 calls \(50\.0%\)/);
  const without = section(reading([...on("agent/one-1", 2), ...on("agent/two-2", 1)]));
  assert.match(without, /UNATTRIBUTED \(calls that belong to no merged pull request\): 0 of 3 calls \(0\.0%\)/);
});

test("attribution rule: branch first, then reviewer-<n> by PR number, then worker-<n> by row suffix; a name or branch two repositories share reaches NONE", () => {
  const both = [pull(7, "agent/shared-7"), pull(7, "agent/other-8", { repository: "a11ign/agent-org" }), pull(9, "agent/x-9", { repository: "a11ign/agent-org" }), pull(3, "agent/dup-3"), pull(4, "agent/dup-3", { repository: "a11ign/agent-org" })];
  const calls = [
    call({ branch: "agent/x-9" }), call({ branch: "HEAD", name: "reviewer-9" }), call({ branch: "HEAD", name: "worker-9" }),
    call({ branch: "HEAD", name: "reviewer-7" }), // two repositories merged a #7
    call({ branch: "agent/dup-3" }),               // the branch is two pull requests' head
    call({ branch: "HEAD", name: "ceo" }),
  ];
  const { byPull, noPull } = attributeCalls({ calls, pulls: both });
  assert.equal(byPull.get("a11ign/agent-org#9")?.length, 3, "branch, reviewer-9 and worker-9 all reach #9");
  assert.equal(noPull.length, 3, "the ambiguous #7, the shared branch and a standing seat belong to no pull request");
});

// ---- 3. the window ---------------------------------------------------------------------------------------

test("the window is half-open and UTC: 20:00:00Z is in the window that starts at 20:00 and never in the one that ends there", () => {
  const day = { since: "2026-10-03T00:00:00Z", until: "2026-10-04T00:00:00Z" };
  const fourteenToTwenty = { ...day, hours: parseHours("14-20") };
  const twentyToMidnight = { ...day, hours: parseHours("20-24") };
  const at = (time: string) => `2026-10-03T${time}Z`;
  assert.equal(windowContains(fourteenToTwenty, at("14:00:00.000")), true, "14:00:00 opens the window");
  assert.equal(windowContains(fourteenToTwenty, at("13:59:59.999")), false);
  assert.equal(windowContains(fourteenToTwenty, at("19:59:59.999")), true);
  assert.equal(windowContains(fourteenToTwenty, at("20:00:00.000")), false, "20:00:00 closes it");
  assert.equal(windowContains(twentyToMidnight, at("20:00:00.000")), true, "and opens the next, so it is in exactly one");
  assert.equal(windowContains(day, "2026-10-03T00:00:00Z"), true);
  assert.equal(windowContains(day, "2026-10-04T00:00:00Z"), false, "the end of a whole window is out");
  assert.equal(windowContains({ ...day, hours: parseHours("14-20") }, "2026-10-02T15:00:00Z"), false, "the right hour of the wrong day");
  assert.equal(windowContains(fourteenToTwenty, "2026-10-03T16:00:00+02:00"), true, "an offset instant is read in UTC: 16:00+02:00 is 14:00Z, in");
  assert.equal(windowContains(fourteenToTwenty, "2026-10-03T22:00:00+02:00"), false, "22:00+02:00 is 20:00Z, out: the wall-clock hour is not the UTC hour");
});

test("--hours refuses what is not FROM-TO within a day", () => {
  assert.deepEqual(parseHours("14-20"), { from: 14, to: 20 });
  for (const bad of ["20-14", "14-14", "0-25", "14", "a-b"]) assert.throws(() => parseHours(bad), /--hours=/, bad);
});

// ---- 4. UNREAD is not $0.00 ------------------------------------------------------------------------------

test("a merged pull request with no attributed call reads UNREAD, is out of the denominators, and is never a $0.00", () => {
  const r = reading(on("agent/one-1", 4));
  assert.deepEqual(r.repository.unread, [2]);
  assert.equal(r.repository.read, 1);
  assert.equal(r.repository.callsPerPull, 4, "averaged over the ONE pull request that has calls, not two");
  assert.match(section(r), /UNREAD, no call attributed: #2\./);
  const none = reading(on("main", 3));
  assert.equal(none.repository.callsPerPull, null);
  assert.equal(none.repository.dollarsPerPull, null);
  const text = section(none);
  assert.match(text, /\| \*\*UNREAD\*\* \|/);
  assert.doesNotMatch(text.split("#### a11ign/a11ign")[1], /\$0\.00/);
});

test("a repository whose window holds fewer than 10 merged pull requests reads UNREAD with its count; ten read", () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => pull(i + 1, `agent/p-${i + 1}`));
  const calls = (n: number) => Array.from({ length: n }, (_, i) => on(`agent/p-${i + 1}`, 2)).flat();
  const nine = reading(calls(9), { pulls: make(9), minimum: 10 });
  assert.equal(nine.repository.enough, false);
  assert.match(section(nine, { minimum: 10 }), /UNREAD above: 9 merged pull requests is under the 10 a rate needs\./);
  assert.match(section(nine, { minimum: 10 }).split("#### a11ign/a11ign")[1], /\| \*\*UNREAD\*\* \|[\s\S]*\| \*\*UNREAD\*\* \|/);
  const ten = reading(calls(10), { pulls: make(10), minimum: 10 });
  assert.equal(ten.repository.enough, true);
  assert.doesNotMatch(section(ten, { minimum: 10 }).split("#### a11ign/a11ign")[1], /UNREAD above/);
});

// ---- 5. the targets are read from the file ---------------------------------------------------------------

test("the targets are READ FROM docs/ci-targets.json: a changed target changes the verdict, and a missing file reads UNREAD and says so", () => {
  const r = reading([...on("agent/one-1", 5), ...on("agent/two-2", 5)]); // 5 calls and $0.745 per pull request
  const tighter = structuredClone(TARGETS);
  tighter.targets.callsPerMergedPullRequest = { ...tighter.targets.callsPerMergedPullRequest, atMost: 4 };
  assert.match(section(r).split("#### a11ign/a11ign")[1], /Calls per merged pull request \(attributed\) \| at most 70 \| 5 \|.*\*\*MET\*\*/);
  assert.match(section(r, { targets: tighter }).split("#### a11ign/a11ign")[1], /Calls per merged pull request \(attributed\) \| at most 4 \| 5 \|.*\*\*MISSED\*\*/);
  const missing = readTargetsFile(resolve(REPO, "docs/no-such-targets.json"));
  assert.ok("missing" in missing, "a missing file is a state, not a thrown ENOENT");
  const text = unreadSection(missing.missing);
  assert.match(text, /UNREAD/);
  assert.match(text, /no-such-targets\.json/);
  assert.ok("targets" in readTargetsFile(TARGETS_FILE), "positive control: the real file reads");
});

test("the two token targets are in docs/ci-targets.json, are the chairman's 70 and $2.50, and name the token row as their reader", () => {
  assert.equal(TARGETS.targets.callsPerMergedPullRequest.atMost, 70);
  assert.equal(TARGETS.targets.dollarsPerMergedPullRequest.below, 2.5);
  assert.equal(TARGETS.targets.callsPerMergedPullRequest.readBy, "the token row");
});

// ---- the four contributors (done-when 5) -----------------------------------------------------------------

const T = (minute: number) => `2026-10-01T10:${String(minute).padStart(2, "0")}:00.000Z`;

test("the four counts plus the calls that fit none sum to the attributed calls, for each repository, and with the no-pull remainder to every call", () => {
  const p1 = pull(1, "agent/one-1", { failures: [{ from: T(10), to: T(20) }], rounds: [{ from: T(30), to: T(40) }] });
  const p2 = pull(2, "agent/two-2", { repository: "a11ign/agent-org" });
  const calls = [
    ...on("agent/one-1", 2, { at: T(12) }), ...on("agent/one-1", 3, { at: T(35) }), ...on("agent/one-1", 1, { waitTurn: true }),
    ...on("agent/one-1", 1, { reread: true }), ...on("agent/one-1", 4, { at: T(50) }), ...on("agent/two-2", 2), ...on("main", 5),
  ];
  const { byPull, noPull } = attributeCalls({ calls, pulls: [p1, p2] });
  for (const repository of ["a11ign/a11ign", "a11ign/agent-org"]) {
    const r = readRepository({ repository, pulls: [p1, p2], byPull, prices: PRICES, minimum: 1 });
    const sum = Object.values(r.counts).reduce((a, b) => a + b, 0) + r.none;
    assert.equal(sum, r.calls, `${repository}: four counts + none-of-the-four = attributed`);
  }
  const a = readRepository({ repository: "a11ign/a11ign", pulls: [p1, p2], byPull, prices: PRICES, minimum: 1 });
  assert.deepEqual(a.counts, { "review rounds": 3, "CI red": 2, waits: 1, "re-reads": 1 });
  assert.equal(a.none, 4);
  const b = readRepository({ repository: "a11ign/agent-org", pulls: [p1, p2], byPull, prices: PRICES, minimum: 1 });
  assert.equal(a.calls + b.calls + noPull.length, calls.length, "attributed over both repositories plus the no-pull remainder is every call");
});

test("a call that fits two of the four is counted ONCE, in the order waits, re-reads, CI red, review rounds; reviewers' calls are never CI red or a round", () => {
  const p = pull(1, "agent/one-1", { failures: [{ from: T(0), to: T(59) }], rounds: [{ from: T(0), to: T(59) }] });
  assert.equal(categoryOf(call({ waitTurn: true, reread: true }), p), "waits");
  assert.equal(categoryOf(call({ reread: true }), p), "re-reads");
  assert.equal(categoryOf(call(), p), "CI red", "in both a failure and a round: CI red");
  assert.equal(categoryOf(call(), pull(1, "b", { rounds: p.rounds })), "review rounds");
  assert.equal(categoryOf(call({ name: "reviewer-1" }), p), null, "a reviewer's call is not the author's");
  assert.equal(categoryOf(call(), pull(1, "b")), null, "none of the four stays out of the four");
});

test("a fixture in which each of the four in turn is the largest names that one", () => {
  const p = pull(1, "agent/one-1", { failures: [{ from: T(10), to: T(20) }], rounds: [{ from: T(30), to: T(40) }] });
  const heavy: Record<string, Record<string, unknown>> = {
    "review rounds": { at: T(35) }, "CI red": { at: T(15) }, waits: { waitTurn: true }, "re-reads": { reread: true },
  };
  for (const name of CATEGORIES) {
    const calls = [...on("agent/one-1", 5, heavy[name]), ...CATEGORIES.filter((c) => c !== name).flatMap((c) => on("agent/one-1", 1, heavy[c]))];
    const { counts } = countContributors([{ pull: p, calls }]);
    assert.equal(biggestContributor(counts), name);
    const { byPull } = attributeCalls({ calls, pulls: [p] });
    const r = readRepository({ repository: "a11ign/a11ign", pulls: [p], byPull, prices: PRICES, minimum: 1 });
    const text = section({ repository: r, whole: readWindow({ calls, noPull: [], merged: 1, prices: PRICES }), noPull: [], byPull });
    assert.match(text, new RegExp(`Biggest contributor: ${name} \\(5 calls, 62\\.5% of the attributed calls\\)`));
    for (const c of CATEGORIES) assert.match(text, new RegExp(`${c} ${c === name ? 5 : 1}[,;]`), "the line prints all four counts");
  }
  assert.equal(biggestContributor({ "review rounds": 0, "CI red": 0, waits: 0, "re-reads": 0 }), null, "all zero names nothing");
});

test("a tie between contributors goes to the earlier in the closed set, so the same counts always name the same one", () => {
  assert.equal(biggestContributor({ "review rounds": 3, "CI red": 3, waits: 1, "re-reads": 1 }), "review rounds");
  assert.equal(biggestContributor({ "review rounds": 1, "CI red": 4, waits: 4, "re-reads": 4 }), "CI red");
  assert.equal(biggestContributor({ "review rounds": 2, "CI red": 2, waits: 2, "re-reads": 2 }), "review rounds");
});

test("review rounds run from a non-approving verdict to the next verdict by anyone but the author, or the merge", () => {
  const reviews = [
    { at: T(10), state: "CHANGES_REQUESTED", login: "rev" }, { at: T(20), state: "COMMENTED", login: "author" },
    { at: T(30), state: "APPROVED", login: "rev" }, { at: T(40), state: "PENDING", login: "rev" },
  ];
  assert.deepEqual(reviewRounds(reviews, { author: "author", mergedAt: T(59) }), [{ from: T(10), to: T(30) }]);
  assert.deepEqual(reviewRounds([{ at: T(10), state: "COMMENTED", login: "rev" }], { author: "author", mergedAt: T(59) }), [{ from: T(10), to: T(59) }], "no later verdict: to the merge");
  assert.deepEqual(reviewRounds([{ at: T(10), state: "APPROVED", login: "rev" }], { author: "author", mergedAt: T(59) }), [], "an approval opens no round");
});

test("CI red runs from a failed pull_request run on the branch to the next pass, or the merge; other branches and merge_group runs are not it", () => {
  const run = (branch: string, conclusion: string, minute: number, event = "pull_request") => ({ event, conclusion, head_branch: branch, created_at: T(minute), updated_at: T(minute + 1) });
  const runs = [run("b", "failure", 10), run("b", "success", 20), run("b", "failure", 30), run("other", "failure", 5), run("b", "failure", 40, "merge_group")];
  assert.deepEqual(failureIntervals(runs, { branch: "b", mergedAt: T(59) }), [{ from: T(11), to: T(21) }, { from: T(31), to: T(59) }]);
});

// ---- reading a transcript --------------------------------------------------------------------------------

test("a call is one message.id, not one transcript line: three content-block lines of one request are ONE call", () => {
  const { calls } = read([assistant("m1", T(1)), assistant("m1", T(1)), assistant("m1", T(2)), assistant("m2", T(3))]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].tokens, { input: 1, output: 2, cacheRead: 3, write5m: 1, write1h: 3 });
  assert.equal(calls[0].at, T(1), "stamped at its first line");
});

test("the last line of a request may carry the final output count: the larger one is kept", () => {
  const { calls } = read([assistant("m1", T(1), { output: 5 }), assistant("m1", T(1), { output: 9 }), assistant("m1", T(1), { output: 7 })]);
  assert.equal(calls[0].tokens.output, 9);
});

test("a synthetic message and a tool result are not calls; an unparsable line is counted, not guessed at", () => {
  const { calls, unparsed } = read([assistant("m1", T(1), { model: "<synthetic>" }), toolResult(), '{"type":"assistant","message":{"id":"m9"', assistant("m2", T(2))]);
  assert.deepEqual(calls.map((c) => c.id), ["m2"]);
  assert.equal(unparsed, 1);
});

test("a cache write the usage does not split by TTL is a 5-minute write", () => {
  const line = JSON.stringify({ type: "assistant", timestamp: T(1), message: { id: "m1", model: "x", content: [], usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 7 } } });
  assert.deepEqual(read([line]).calls[0].tokens, { input: 0, output: 0, cacheRead: 0, write5m: 7, write1h: 0 });
});

test("the session's name is read from its first prompt, and an idle nudge makes every call of its turn a wait", () => {
  const { calls } = read([
    user("<pasted_content id=\"x\">\nYou are `worker-5`, an org session in this repository."), assistant("m1", T(1)),
    user("You are `worker-5` -- a follow-up order: #5 IS YOURS AND YOU HAVE BEEN IDLE FOR 31 MINUTES WITH NO WAIT"), assistant("m2", T(2)), assistant("m3", T(3)),
    user("You are `worker-5` -- a follow-up order: #5 at `abc` has FAILING checks"), assistant("m4", T(4)),
  ]);
  assert.deepEqual(calls.map((c) => [c.name, c.waitTurn, c.waitBy]), [
    ["worker-5", false, ""], ["worker-5", true, "idle nudge"], ["worker-5", true, "idle nudge"], ["worker-5", false, ""],
  ]);
});

test("a short turn that ends 'nothing to do' is a wait; a long one that did work first is not", () => {
  const quiet = [user("an order"), assistant("q1", T(1)), assistant("q2", T(2), { text: "Checked the row: nothing to do." })];
  assert.deepEqual(read(quiet).calls.map((c) => c.waitBy), ["nothing to do", "nothing to do"]);
  const long = [user("an order"), ...Array.from({ length: 9 }, (_, i) => assistant(`l${i}`, T(i + 1), { text: i === 8 ? "Done; nothing to do now." : "" }))];
  assert.ok(read(long).calls.every((c) => !c.waitTurn), "nine calls is work, not a wait");
});

test("a background-task notice and a slash command do not open a turn; a compaction summary marks the next call a re-read", () => {
  const { calls } = read([
    user("an order"), assistant("m1", T(1)), user("<task-notification>done</task-notification>"), user("<command-name>/compact</command-name>"),
    user("This session is being continued from a previous conversation that ran out of context."), assistant("m2", T(2)), assistant("m3", T(3)),
  ]);
  assert.deepEqual(calls.map((c) => c.afterCompaction), [false, true, false]);
});

test("a session NAME in more than one transcript was resumed or cleared in the later ones: that file's FIRST call re-reads, and only it", () => {
  const first = read([user("You are `worker-5`, an org session"), assistant("a1", T(1)), assistant("a2", T(2))], "one.jsonl").calls;
  const later = read([user("You are `worker-5`, an org session"), assistant("b1", T(10)), assistant("b2", T(11))], "two.jsonl").calls;
  const unnamed = read([assistant("c1", T(20))], "three.jsonl").calls;
  const marked = markRereads([...later, ...first, ...unnamed]);
  assert.deepEqual(marked.map((c) => [c.id, c.reread]).sort(), [["a1", false], ["a2", false], ["b1", true], ["b2", false], ["c1", false]]);
});

// ---- the section as a whole ------------------------------------------------------------------------------

test("the section says each definition once at the top, names the price list's date, and the whole reading carries the chairman's figure beside the attributed one", () => {
  const text = section(reading([...on("agent/one-1", 2), ...on("main", 2)]));
  for (const needle of ["**Call**", "**Sessions**", "**Price**", "**Attribution**", "**Merged**", "the list read 2026-01-01"]) assert.ok(text.includes(needle), needle);
  assert.equal(text.split("**Call**").length, 2, "each definition appears once");
  assert.match(text, /\(ALL calls\)/);
  assert.match(text, /\(attributed\)/);
  assert.match(text, /\(the chairman's proxy\)/);
  assert.match(text, /Rate limit seen: fixture/);
});
