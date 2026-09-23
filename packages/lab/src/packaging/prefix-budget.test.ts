/**
 * #2217: EVERY WAKE RE-READS THE RULES BEFORE IT CAN ACT, AND NOTHING MEASURED WHAT THAT COST.
 *
 * `CLAUDE.md` and `.claude/rules/agent-practices.md` load together in every session in every directory.
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

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The two files every session loads before it can act. Budgeted as a SET -- see the header. */
const LOADED = ["CLAUDE.md", ".claude/rules/agent-practices.md"] as const;

/** `ceo`'s number, #2217. Only `ceo` moves it. */
const BUDGET_BYTES = 20_000;

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

/** The remedy, named in the refusal so a reader does not have to guess at it. */
const REMEDY = "EVICT OR MOVE, DO NOT TRUNCATE: keep the RULE loaded, move the incident narrative to "
  + "docs/operational-lessons.md and link it from the heading. That is the form CLAUDE.md already uses "
  + "(#458, #1240). Deleting a rule to fit is NOT the remedy, and the preservation test below refuses it.";

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

test("the loaded set -- CLAUDE.md plus agent-practices.md -- is within ceo's 20,000-byte budget", () => {
  const { each, total } = loadedSizes();
  assert.ok(
    total <= BUDGET_BYTES,
    `${priceLines(total, each)}\n\nOVER BUDGET by ${(total - BUDGET_BYTES).toLocaleString()} B.\n${REMEDY}`,
  );
});

test("the budget assertion is REACHABLE in both directions -- a set at the budget passes, one byte over fails", () => {
  // THE POSITIVE CONTROL. Without it, the test above could pass because it measures nothing.
  const overBudget = (total: number) => total > BUDGET_BYTES;
  assert.equal(overBudget(BUDGET_BYTES), false, "a set exactly at the budget must PASS");
  assert.equal(overBudget(BUDGET_BYTES + 1), true, "a set one byte over the budget must FAIL");
  assert.equal(overBudget(BUDGET_BYTES - 1), false);
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
