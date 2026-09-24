/**
 * #2217: EVERY WAKE RE-READS THE RULES BEFORE IT CAN ACT, AND NOTHING MEASURED WHAT THAT COST.
 *
 * `CLAUDE.md` and every file under `.claude/rules/` load together in every session in every directory.
 * (One file until #2092, which split it by topic; `rules-files.ts` names the set and the budget is on ALL
 * of it, which is what `ceo`'s number below means by `agent-practices.md`.)
 * Between 2026-09-11 and 2026-09-23 the rules file grew from 1,526 B to 35,374 B -- 23x, a quarter of it
 * in one day -- because every incident in this org correctly ends with somebody writing the lesson down.
 * That is the right habit, and each addition is also a permanent per-wake tax charged hundreds of times a
 * day. **Nothing in the repository told a rule author the price**, so the org was documenting itself into
 * a cost curve it could not see.
 *
 * ## THE BUDGET IS ON THE SET, AND THAT IS THE WHOLE POINT
 *
 * `ceo` set 20,000 bytes for `CLAUDE.md` + `agent-practices.md` TOGETHER. Budgeting them separately would
 * let content escape from the file under pressure into the file beside it, and the loaded cost -- the only
 * thing a session actually pays -- would not move. **Only `ceo` moves this number.**
 *
 * ## WHY THIS GUARD PRINTS RATHER THAN ONLY REFUSES
 *
 * A guard that says "too big" teaches nobody what a section costs. This one prints bytes, tokens and
 * tokens/day on EVERY run, pass or fail, so the next rule author sees the multiplier before adding a
 * section rather than after. That is done-when 3 of the row and it is the cheaper half of the remedy: the
 * budget stops the file growing, the printed price stops the author wanting to.
 *
 * ## bytes/4 IS A FLOOR AND IS NAMED AS ONE
 *
 * It is a proxy, and it UNDER-reads a file this dense in backticks, issue numbers and em dashes, each of
 * which tokenises worse than prose. Every figure this guard prints is therefore a lower bound on the real
 * cost, never an estimate of it, and the output says so. A guard quoting a number it cannot support is the
 * defect this repository names most often.
 *
 * ## THE PRESERVATION CONTROL IS A PINNED LITERAL, NOT A DERIVED LIST
 *
 * `HEADINGS_AT_AAE2C3C9E` is typed out rather than read from git, because the CI acceptance job runs with
 * NO history (`History: full` is opt-in) and a list derived at run time would be empty there -- and an
 * emptiness that passes because nothing was measured is exactly the shape this repo has paid for most.
 * `content-preservation.test.ts` pins its four destination paths the same way and for the same reason.
 *
 * **That guard cannot help here: it reads the root `CLAUDE.md` ONLY.** Measured at `bedef4d51`, its
 * `removedSubstantiveLines` is called on `git diff … -- CLAUDE.md` and nothing else, so every byte of
 * `agent-practices.md` was unguarded text. This file is the control that file never had for it.
 *
 * ## A HEADING MAY LIVE IN EITHER PLACE, AND THAT IS THE REMEDY RATHER THAN A LOOPHOLE
 *
 * The rule stays loaded; the incident moves to `docs/operational-lessons.md` and is linked. So a heading
 * satisfies this guard from EITHER file. What it may not do is vanish from both -- which is the one thing
 * a byte budget on its own would quietly reward.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES_FILES } from "./rules-files.ts";
import { BUDGET_BYTES, REMEDY, WARN_BYTES, WARN_REMEDY, prefixBudgetVerdict } from "./prefix-budget.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The two files every session loads before it can act. Budgeted as a SET -- see the header. */
// #2092: the rules are one file per topic; the set is named in `rules-files.ts`, never globbed.
const LOADED = ["CLAUDE.md", ...RULES_FILES] as const;

/**
 * Deliveries in the measured day (2026-09-23): 529 `wake-ledger` lines + 171 `prompt-session-handoffs`
 * acks the ledger never sees. A STATED ASSUMPTION for the price line, never a live reading -- CI has no
 * ledger, and a guard whose output changed with the host would report noise as growth.
 */
const DELIVERIES_PER_DAY = 700;

/** The proxy the whole price rests on. See the header: it UNDER-reads, so every figure is a floor. */
const BYTES_PER_TOKEN = 4;

/** One kilobyte of new rule -- the unit a rule author actually adds, used in the price line. */
const ONE_KB_OF_RULE = 1_000;

/** bytes/4 -- a FLOOR, for the reason the header gives. */
const tokensFloor = (bytes: number) => Math.round(bytes / BYTES_PER_TOKEN);

function loadedSizes() {
  const each = LOADED.map((f) => ({ file: f, bytes: statSync(join(REPO_ROOT, f)).size }));
  return { each, total: each.reduce((n, f) => n + f.bytes, 0) };
}

/**
 * THE PRICE, in the words a rule author needs. Printed on every run, pass or fail (done-when 3).
 * @param total bytes of the loaded set
 */
function priceLines(total: number, each: readonly { file: string; bytes: number }[]) {
  return [
    "PREFIX PRICE -- what every wake pays before it can act:",
    ...each.map((f) => `  ${f.file}: ${f.bytes.toLocaleString()} B (>=${tokensFloor(f.bytes).toLocaleString()} tokens)`),
    `  SET TOTAL: ${total.toLocaleString()} B of ${BUDGET_BYTES.toLocaleString()} B budget`,
    `  >=${tokensFloor(total).toLocaleString()} tokens per wake, a FLOOR (bytes/4 under-reads this text)`,
    `  >=${(tokensFloor(total) * DELIVERIES_PER_DAY).toLocaleString()} tokens/day at ${DELIVERIES_PER_DAY} deliveries`,
    `  So ${ONE_KB_OF_RULE.toLocaleString()} bytes of new rule costs `
    + `>=${(tokensFloor(ONE_KB_OF_RULE) * DELIVERIES_PER_DAY).toLocaleString()} tokens/day, every day.`,
  ].join("\n");
}

/**
 * Every heading the loaded rules file carried at `aae2c3c9e` -- the commit #2217 was filed against.
 * PINNED AS A LITERAL: CI has no git history, so a derived list would be empty there and pass vacuously.
 */
const HEADINGS_AT_AAE2C3C9E = [
  "# Agent practices — every session in this repo (chairman's direction, 2026-09-11)",
  "## Model routing for subagents",
  "## Context",
  "## Web research",
  "## Timers and state",
  "## The API budget — `gh api rate_limit` is a broken gauge (measured 2026-09-22, #1967)",
  "## `lane:ceo` protects review, not authorship (ceo's ruling, 2026-09-18)",
  "## `main` REQUIRES an approving review (ceo's ruling, 2026-09-22, #2022)",
  "## A waiting condition is DATA, not a sentence (chairman's direction, 2026-09-19)",
  "## Routing — who reads what (chairman's direction, 2026-09-14)",
  "## An approval prompt a human learns to click through is worse than no prompt (2026-09-23, #2076)",
  "## Assertions",
] as const;

/**
 * ARRIVED AFTER `aae2c3c9e` AND PINNED ANYWAY. #2084's section merged into the rules file between the row
 * being filed and being built. The row's own list cannot name it, and dropping it would lose a live rule
 * for no reason other than the accident of a commit hash -- the exact failure the list exists to prevent.
 */
/** 12 headings at `aae2c3c9e` plus the one #2084 added after it. A literal, for the reason above. */
const PINNED_HEADING_COUNT = 13;

/** A floor on the lines actually read, so a haystack that came back near-empty cannot pass vacuously. */
const MIN_LINES_READ = 100;

/** The same floor for the collapsed-prose haystack the directive test reads. */
const MIN_PROSE_CHARS = 5_000;

const HEADINGS_ADDED_SINCE = [
  "## A review OUTLIVES the head it was posted on, and the org now READS that (2026-09-23, #2084)",
] as const;

/**
 * Every LINE of the loaded files plus the destination the rules now link to. A heading may survive in any
 * of them -- but as a WHOLE LINE.
 *
 * WHY LINES AND NOT `includes`. The first version of this guard asked `haystack.includes(heading)` and a
 * mutation SURVIVED it: renaming `## Assertions` to `## Assertions-RENAMED` in BOTH files left the
 * substring intact, so a heading could be mangled out of existence and still pass. Every heading that was
 * moved to `docs/operational-lessons.md` is recorded there on a line of its own inside a fenced block for
 * exactly this reason -- the fence keeps it from rendering as a second heading while leaving it a line.
 */
function preservationLines() {
  const lines = new Set<string>();
  for (const f of [...LOADED, "docs/operational-lessons.md"]) {
    for (const line of readFileSync(join(REPO_ROOT, f), "utf8").split("\n")) lines.add(line.trim());
  }
  return lines;
}

test("the loaded prefix states its price, and every run says it", () => {
  const { each, total } = loadedSizes();
  const price = priceLines(total, each);
  console.log(price);
  // The population is never empty: LOADED is a literal and statSync throws on a missing file.
  assert.equal(each.length, LOADED.length);
  assert.ok(total > 0, "the loaded set measured 0 bytes -- statSync read nothing");
  // ASSERTED, not merely printed. done-when 3 asks for bytes, tokens-as-a-floor and tokens/day on every
  // run; a `console.log` nobody checks is a claim with no reader, so each figure is named here. Deleting
  // any one of the three lines from `priceLines` fails this.
  assert.match(price, /SET TOTAL: [\d,]+ B of 20,000 B budget/, "the price must state bytes against the budget");
  assert.match(price, />=[\d,]+ tokens per wake, a FLOOR/, "tokens must be stated AND named as a floor");
  assert.match(price, />=[\d,]+ tokens\/day at \d+ deliveries/, "the price must state the per-day multiplier");
  for (const f of each) assert.ok(price.includes(f.file), `the price must name ${f.file}`);
});

/**
 * #2248: TWO BANDS, ONE REFUSAL. The bands and both remedies live in `prefix-budget.mjs`, so the five
 * boundary values are checkable from outside this suite; this file asserts them and applies them to the tree.
 *
 * **THE WARN BAND WAS IN BREACH THE DAY IT LANDED, AND THAT IS CORRECT.** The set measured 19,986 B at
 * `c06bc5cc3` (the commit the row was filed against) and 19,972 B at `df20cfe09` (measured off disk in the
 * worktree the band was built on), both past 18,000 B and both within 30 B of the 20,000 B refusal. So this
 * test PRINTS A WARNING from its first run. Do not close that by moving the band: it is the alarm, and the
 * remedy is `WARN_REMEDY`'s ladder (move narrative, shorten over-long pins, then `ceo`).
 *
 * WHERE THE WARNING IS SEEN, MEASURED: the `default` console reporter (CI, a person's terminal, or
 * `RSTEST_NO_AGENT=1`) prints it, and the JSON run record keeps it. **An agent session's `md` reporter prints
 * only failures, so on a green run it shows nothing** -- the price printout above has always had that limit.
 */
/**
 * The bands as ceo set them, typed out AGAIN here on purpose: a test that imported the constants and compared
 * them to themselves would follow whoever moved the number. Moving either is `ceo`'s, and shows up as a red here.
 */
const CEO_WARN_BYTES = 18_000;
const CEO_BUDGET_BYTES = 20_000;
/** The set as measured at `c06bc5cc3`, the commit #2248 was filed against: 14 B from the refusal. */
const SET_AT_FILING = 19_986;

test("the loaded set -- CLAUDE.md plus every rules file -- is within ceo's 20,000-byte budget", () => {
  const { each, total } = loadedSizes();
  const verdict = prefixBudgetVerdict(total);
  // A warning is PRINTED on the run that reports it, with the number, the headroom and the remedy -- a band
  // nobody sees reads as coverage. It does not fail the suite; only `over` does.
  if (verdict.verdict === "warn") console.warn(`${priceLines(total, each)}\n\n${verdict.message}`);
  assert.notEqual(verdict.verdict, "over", `${priceLines(total, each)}\n\n${verdict.message}`);
});

test("the budget assertion is REACHABLE in both directions -- a set at the budget passes, one byte over fails", () => {
  // THE POSITIVE CONTROL. Without it, the test above could pass because it measures nothing.
  const at = (total: number) => prefixBudgetVerdict(total).verdict;
  assert.equal(at(BUDGET_BYTES), "warn", "a set exactly at the budget must PASS (and warn)");
  assert.equal(at(BUDGET_BYTES + 1), "over", "a set one byte over the budget must FAIL");
  assert.equal(at(BUDGET_BYTES - 1), "warn");
});

test("the warn band starts at 18,000 B, in both directions, and every boundary is asserted", () => {
  const at = (total: number) => prefixBudgetVerdict(total).verdict;
  assert.equal(WARN_BYTES, CEO_WARN_BYTES, "only ceo moves the band, and never to silence it");
  assert.equal(BUDGET_BYTES, CEO_BUDGET_BYTES, "the refusal stays where ceo set it");
  assert.equal(at(WARN_BYTES - 1), "ok", "17,999 B is below the band");
  assert.equal(at(WARN_BYTES), "warn", "18,000 B is the first byte of the band");
  assert.equal(at(SET_AT_FILING), "warn", "the figure the row was filed at, in breach on the day it landed");
  assert.equal(at(BUDGET_BYTES), "warn", "20,000 B exactly still passes -- the refusal was never >=");
  assert.equal(at(BUDGET_BYTES + 1), "over");
});

test("a warning names the number, the headroom and the remedy, and an ok set says nothing", () => {
  const warn = prefixBudgetVerdict(SET_AT_FILING);
  const headroom = CEO_BUDGET_BYTES - SET_AT_FILING;
  assert.equal(warn.headroom, headroom);
  assert.match(warn.message, /19,986 B/, "the number");
  assert.ok(warn.message.includes(`${headroom} B of headroom`), "the headroom");
  assert.ok(warn.message.includes(WARN_REMEDY), "the remedy, in full, in the message a run prints");
  assert.equal(warn.remedy, WARN_REMEDY);
  const ok = prefixBudgetVerdict(WARN_BYTES - 1);
  assert.deepEqual([ok.message, ok.remedy], ["", ""], "a set below the band must be silent");
});

test("the warn remedy carries the ladder in ceo's order, the debt's author and its due date", () => {
  const r = WARN_REMEDY.toLowerCase();
  const [narrative, shorten, ceo] = ["narrative", "shorten", "ceo"].map((w) => r.indexOf(w));
  assert.ok(narrative >= 0 && narrative < shorten && shorten < ceo, `ladder out of order: ${[narrative, shorten, ceo]}`);
  // The first-occurrence check above is the row's own Acceptance and is satisfied by the word "narrative" in the
  // DEBT sentence, so a swapped ladder passes it (mutant survived, #2248). The rungs are pinned as rungs.
  assert.match(WARN_REMEDY, /\(1\) MOVE NARRATIVE.*\(2\) SHORTEN OVER-LONG PINS.*\(3\) only then come back to ceo/,
    "the rungs must be numbered and in ceo's order: narrative, then pins, then ceo");
  assert.match(WARN_REMEDY, /adding author pays, in the same pull request/i, "the debt's author AND its due date");
  assert.match(WARN_REMEDY, /pre-authorised/, "pin-shortening needs no second ruling");
  assert.match(WARN_REMEDY, /claim and both its directions stay pinned/, "the proviso that makes it safe");
  assert.match(WARN_REMEDY, /Deleting a rule is NOT on this list/, "deletion is not a rung");
});

/**
 * The refusal's remedy as #2217 shipped it, PINNED AS A LITERAL copied from this file at `f3e75eee6^` (the
 * commit before #2248). Comparing the subject to the `REMEDY` it exports compares it to itself, so a reference
 * changed in `prefix-budget.mjs` (`#1240` to `#9999`) passed all twelve tests; only a literal held here can
 * notice the words move.
 */
const REMEDY_BEFORE_2248 = "EVICT OR MOVE, DO NOT TRUNCATE: keep the RULE loaded, move the incident narrative to "
  + "docs/operational-lessons.md and link it from the heading. That is the form CLAUDE.md already uses "
  + "(#458, #1240). Deleting a rule to fit is NOT the remedy, and the preservation test below refuses it.";

test("the 20,000 refusal still says what it said before #2248", () => {
  const over = prefixBudgetVerdict(BUDGET_BYTES + 1);
  assert.equal(over.remedy, REMEDY_BEFORE_2248);
  assert.equal(over.message, `OVER BUDGET by 1 B.\n${REMEDY_BEFORE_2248}`);
  assert.equal(REMEDY, REMEDY_BEFORE_2248, "the export the other assertions print is the same words");
});

test("no rule was lost to the budget: every heading the rules file carried still exists", () => {
  const lines = preservationLines();
  const pinned = [...HEADINGS_AT_AAE2C3C9E, ...HEADINGS_ADDED_SINCE];
  // THE POPULATION CONTROL, and it is here because emptying the pinned list SURVIVED this test in an
  // earlier draft: `[].filter(...)` is `[]`, so the emptiness below passed while measuring nothing. The
  // count is a literal for the same reason the list is -- CI has no history to derive it from. Adding a
  // section to the rules file means adding it here, deliberately, which is the point.
  assert.equal(pinned.length, PINNED_HEADING_COUNT, "the pinned heading list changed size -- update it deliberately");
  assert.ok(lines.size > MIN_LINES_READ, `read only ${lines.size} lines from the loaded set plus docs`);
  const missing = pinned.filter((h) => !lines.has(h));
  assert.deepEqual(
    missing,
    [],
    `${missing.length} heading(s) exist in neither the loaded rules, CLAUDE.md, nor `
    + `docs/operational-lessons.md:\n  ${missing.join("\n  ")}\n\n${REMEDY}`,
  );
});

test("the preservation assertion is REACHABLE -- a heading that was never written is reported missing", () => {
  // THE POSITIVE CONTROL for the emptiness above, which is what this repo's own rule asks for: an
  // emptiness assertion names where its positive control lives, and this is it.
  const lines = preservationLines();
  const invented = "## A rule nobody has ever written (2026-01-01, #0)";
  assert.equal(lines.has(invented), false, "the fixture names a line the tree already contains");
  assert.deepEqual([invented].filter((h) => !lines.has(h)), [invented]);
  // AND the mutant that survived the first draft, pinned on a LOCAL fixture rather than on the tree: a
  // heading that is only a PREFIX of an existing line must read as missing. `includes` said it was
  // present, which let a rule be renamed out of existence silently.
  const renamedOnly = new Set(["## Some Heading-RENAMED"]);
  assert.equal(renamedOnly.has("## Some Heading"), false, "a line set must not match a mere prefix");
  assert.ok("## Some Heading-RENAMED".includes("## Some Heading"), "…which a substring match WOULD match");
});

/**
 * THE DIRECTIVE, NOT ONLY THE HEADING -- and this is the control the first draft of this guard did not
 * have. `reviewer-2` applied a mutant to `.claude/rules/agent-practices.md` turning
 * "Do not create a cron to check for work." into "Consider creating a cron to check for work.", ran the
 * five tests above, and **all five stayed green**: a section can keep its heading while the rule under it
 * is reversed. A heading census answers "was this subject dropped"; it cannot answer "does it still say
 * the same thing", which is what done-when 2 actually claims.
 *
 * ## MATCHED AGAINST THE **LOADED** FILES ONLY, AND THAT IS DELIBERATE
 *
 * A heading may satisfy the census from `docs/operational-lessons.md`, because the row's remedy is to move
 * the NARRATIVE there and link it. A DIRECTIVE may not. **A rule that exists only in a file nothing loads
 * is a rule that was lost**, however faithfully it was archived -- and the audit that found this blocker
 * found exactly that shape three times: `Model routing`, `Context` and `Web research` had their
 * measurements deleted outright while their headings survived in the loaded file, and the Web-research
 * exception ("One fetch that the main session must read itself is the exception, not the habit.") was
 * gone from all three files. So the haystack here is `CLAUDE.md` + the rules files, and nothing else.
 *
 * ## WHY NORMALISED SUBSTRING HERE, WHERE THE HEADING CENSUS USES WHOLE LINES
 *
 * A heading IS a line, so a line set is the exact instrument and it refuses the prefix mutant
 * (`## Assertions` vs `## Assertions-RENAMED`). A directive is wrapped across lines by the formatter and
 * is never a line, so the haystack collapses all whitespace and the needle is written collapsed. The
 * mutant that motivated this test dies on it: "Consider creating a cron…" does not contain
 * "Do not create a cron to check for work.", and the control below asserts that on a local fixture rather
 * than on today's tree.
 *
 * **THE LIMIT, STATED RATHER THAN IMPLIED.** A literal pin decides whether a sentence SURVIVED, not
 * whether the section around it still means what it meant. A weakening that leaves the pinned sentence
 * intact and adds a contradicting one after it passes this test. Refusing that would need a guard that
 * infers intent, which is the defect this repository's own Assertions rule names one level up; the
 * control for it is review, and it is named here so nobody reads a green run as more than it is.
 */
const DIRECTIVES_BY_SECTION: Readonly<Record<string, readonly string[]>> = {
  "## Model routing for subagents": ["**Every subagent call names its model.**"],
  "## Context": [
    "`/clear` between unrelated topics; a fresh window beats stale history.",
    // #2257: the model-change trigger is a COUNT, so the count and the WRONG-not-stale qualifier are pinned.
    "two `ceo` rulings in a week reversed as WRONG, not stale,",
    "**Never pin a session to Opus.**",
  ],
  "## Web research": ["**One fetch that the main session must read itself is the exception, not the habit.**"],
  "## Timers and state": [
    "**No session holds a standing cron.**",
    // #2257: the ORDER is the rule -- list ONCE, then delete. `CronDelete` needs ids and ids need a list.
    "list them once and **`CronDelete` anything you find.**",
    "**Do not create a cron to check for work.**",
    "**The row is the state.**",
    "**Nobody merges by hand.**",
    "**`Acceptance:` and `Closes` are MERGE-BLOCKING**",
  ],
  "## The API budget — `gh api rate_limit` is a broken gauge (measured 2026-09-22, #1967)": [
    "**Never decide anything from `gh api rate_limit`.**",
    "**you must not switch to the other config to get past your own limit.**",
    "**Run `gh api user --jq .login` first, then the headers**",
  ],
  "## `lane:ceo` protects review, not authorship (ceo's ruling, 2026-09-18)": [
    "**A `lane:<owner>` label refuses any OTHER session unconditionally**",
  ],
  "## `main` REQUIRES an approving review (ceo's ruling, 2026-09-22, #2022)": [
    "**One approving review, and `bypass_pull_request_allowances` EMPTY**",
    '**A 404 from `branches/main/protection` means absent OR forbidden, never "unprotected".**',
  ],
  "## A review OUTLIVES the head it was posted on, and the org now READS that (2026-09-23, #2084)": [
    "**A grep count in a row body is a reading at a moment: re-run it at YOUR commit.**",
  ],
  "## A waiting condition is DATA, not a sentence (chairman's direction, 2026-09-19)": [
    "**If a conclusion changes what should happen next, it goes in a FIELD, not a comment.**",
    "**Nothing in this org reads comments.**",
    "Removing the label IS the act of answering",
  ],
  "## Routing — who reads what (chairman's direction, 2026-09-14)": [
    "An engineer's report goes there, never to `ceo`.",
    "**Both halves, or it is unrecorded or undelivered.**",
    "**Do not retry and do not poll:**",
  ],
  "## An approval prompt a human learns to click through is worse than no prompt (2026-09-23, #2076)": [
    '**Write `rm -f "${D:?}"/*.md`, never `rm -f $D/*.md`.**',
    "when a command is refused for its SHAPE rather than its EFFECT, change the shape.",
  ],
  "## Assertions": [
    "**An emptiness assertion names where its positive control lives.**",
    "**A control you believe in is not one you can point at.**",
  ],
};

/** Collapse every run of whitespace, so a needle written on one line matches text the formatter wrapped. */
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** The LOADED set only -- see the header for why `docs/` is not in this haystack. */
function loadedProse() {
  return collapse(LOADED.map((f) => readFileSync(join(REPO_ROOT, f), "utf8")).join("\n"));
}

test("every pinned section names at least one directive, so a new section cannot arrive unguarded", () => {
  // The H1 title carries no rule of its own; every `##` section must have one.
  const sections: string[] = [...HEADINGS_AT_AAE2C3C9E, ...HEADINGS_ADDED_SINCE].filter((h) => h.startsWith("## "));
  const keys = Object.keys(DIRECTIVES_BY_SECTION);
  assert.deepEqual(
    sections.filter((h) => !keys.includes(h)),
    [],
    "a pinned heading has no pinned directive -- add its load-bearing sentence to DIRECTIVES_BY_SECTION",
  );
  assert.deepEqual(
    keys.filter((k) => !sections.includes(k)),
    [],
    "DIRECTIVES_BY_SECTION names a section that is not in the pinned heading list",
  );
  for (const [section, directives] of Object.entries(DIRECTIVES_BY_SECTION)) {
    assert.ok(directives.length > 0, `${section} pins an EMPTY directive list, which asserts nothing`);
  }
});

test("no rule was WEAKENED: every pinned directive is still in the LOADED set, verbatim", () => {
  const prose = loadedProse();
  assert.ok(prose.length > MIN_PROSE_CHARS, `read only ${prose.length} chars of loaded prose`);
  const missing: string[] = [];
  for (const [section, directives] of Object.entries(DIRECTIVES_BY_SECTION)) {
    for (const d of directives) if (!prose.includes(collapse(d))) missing.push(`${section}\n    ${d}`);
  }
  assert.deepEqual(
    missing,
    [],
    `${missing.length} pinned directive(s) no longer appear in CLAUDE.md or the loaded rules file:\n  `
    + `${missing.join("\n  ")}\n\n${REMEDY}\n\nA directive that now lives only in docs/ has been LOST: `
    + "the narrative moves, the rule stays loaded.",
  );
});

test("the directive assertion is REACHABLE, and it kills the mutant that motivated it", () => {
  const prose = loadedProse();
  // Control 1: a directive nobody ever wrote reads as missing, so the emptiness above is not vacuous.
  const invented = "**Every session must file a row before breakfast.**";
  assert.equal(prose.includes(collapse(invented)), false, "the fixture names text the loaded set contains");
  assert.deepEqual([invented].filter((d) => !prose.includes(collapse(d))), [invented]);
  // Control 2: `reviewer-2`'s EXACT mutant on #2236, pinned on a local fixture so it is a property of the
  // matcher rather than of today's tree. The heading census stayed green on this; this must not.
  const weakened = collapse("## Timers and state - **Consider creating a cron to check for work.** If you want one, the gate is missing a question.");
  const directive = collapse("**Do not create a cron to check for work.**");
  assert.equal(weakened.includes(directive), false, "the weakened text must NOT satisfy the directive");
  assert.ok(weakened.includes("## Timers and state"), "…while its heading survives, which is why headings alone are not enough");
  // Control 4 (#2257): the two mutants the reviewer applied to this PR, as local fixtures. Swapping the verb
  // or loosening the count must each stop satisfying its pin, and the real prose must satisfy both.
  const cronPin = collapse("list them once and **`CronDelete` anything you find.**");
  const triggerPin = collapse("two `ceo` rulings in a week reversed as WRONG, not stale,");
  assert.ok(prose.includes(cronPin) && prose.includes(triggerPin), "the shipped prose must satisfy both new pins");
  assert.equal(collapse("list them once and **`CronList` anything you find.**").includes(cronPin), false);
  assert.equal(collapse("one `ceo` ruling in a week reversed as WRONG, not stale,").includes(triggerPin), false);
  // Control 3: the whitespace collapse is load-bearing -- the directive is wrapped in the real file.
  const wrapped = collapse("**Do not create a cron\n  to check for work.**");
  assert.equal(wrapped, directive, "a directive wrapped across lines must still match");
});
