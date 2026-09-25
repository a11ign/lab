// @ts-check
/**
 * #2248: THE PREFIX BUDGET'S BANDS AND ITS REMEDIES, AS ONE CALLABLE PREDICATE.
 *
 * `prefix-budget.test.ts` used to hold a single threshold and assert `total <= BUDGET_BYTES`, so there was
 * no state between *fine* and *blocked*: the author who pushed the set over the line learned it from a red
 * gate in their own pull request, and the author who left 14 B of headroom warned nobody. The bands live
 * here rather than in a literal inside an assertion so the five boundary values are checkable from outside
 * the suite (the row's Acceptance calls `prefixBudgetVerdict` directly), the shape `pr-armed-state.mjs` has.
 *
 * ## TWO BANDS, ONE REFUSAL
 *
 * | bytes | verdict |
 * |---|---|
 * | `< 18,000` | `ok` |
 * | `18,000` … `20,000` inclusive | `warn` -- the suite stays green and SAYS so |
 * | `> 20,000` | `over` -- the refusal, exactly as before |
 *
 * **20,000 exactly still passes** and is a `warn`: the refusal was never `>=`.
 *
 * ## THE WARN BAND WAS IN BREACH ON THE DAY IT LANDED, AND THAT IS CORRECT
 *
 * The loaded set measured **19,986 B at `c06bc5cc3`** (the commit the row was filed against: CLAUDE.md 5,256
 * + the rules files 14,730) and **19,972 B at `df20cfe09`** (measured off disk in the worktree this was
 * built on), both over 18,000. So the band reported from its first run. **Do not "fix" that by moving
 * `WARN_BYTES`.** Being 14 B from a refusal IS the alarm state; the remedy is the ladder in `WARN_REMEDY`,
 * not the threshold. A band people learn to scroll past is worse than none, which is why a warning here
 * carries a remedy naming the ACT and its author rather than a number in a summary.
 *
 * `ceo` ruled all of this on 2026-09-23 (#2217, comment 5802488056). The budget itself was not a part of it.
 */

/** `ceo`'s number, #2217. Only `ceo` moves it: a budget that moves the first time it binds is not a budget. */
export const BUDGET_BYTES = 20_000;

/**
 * Where the warning starts, so compression happens with 2 KB of room rather than 14 B. ONLY `ceo` moves it,
 * for the same reason as the budget -- and moving it to silence the alarm is the one thing it exists to stop.
 */
export const WARN_BYTES = 18_000;

/**
 * The remedy for a set that is genuinely over -- the words #2217 shipped, kept byte-for-byte (done-when 5 of
 * #2248: this row adds a rung below the refusal and does not soften the one above).
 */
export const REMEDY = "EVICT OR MOVE, DO NOT TRUNCATE: keep the RULE loaded, move the incident narrative to "
  + "docs/operational-lessons.md and link it from the heading. That is the form CLAUDE.md already uses "
  + "(#458, #1240). Deleting a rule to fit is NOT the remedy, and the preservation test below refuses it.";

/**
 * The remedy at the warn band: whose debt it is, when it falls due, and the order of recourse. It is here and
 * not in the loaded rules file because it costs zero prefix bytes and reaches an author AT THE MOMENT IT
 * BINDS; written into `.claude/rules/` it would be charged to every wake, the ruling arguing with itself.
 *
 * THE ORDER IS THE RULE (`ceo`, 2026-09-23): narrative, then pins, then `ceo`. `#2248`'s second Acceptance
 * command asks for the three in that order, because an unordered list of three good ideas is what this must
 * not become. **`ceo` is first named in the LAST rung** -- the order check reads first occurrences.
 */
export const WARN_REMEDY = "THE ADDING AUTHOR PAYS, IN THE SAME PULL REQUEST: add N bytes of rule, free N bytes "
  + "of narrative from the loaded set in that same PR. When the set nears the budget the order is: "
  + "(1) MOVE NARRATIVE -- keep the RULE loaded, move the incident narrative to docs/operational-lessons.md "
  + "and link it from the heading; (2) SHORTEN OVER-LONG PINS -- pre-authorised, no need to ask, where a pin "
  + "holds prose its claim does not need, PROVIDED the claim and both its directions stay pinned; "
  + "(3) only then come back to ceo. Deleting a rule is NOT on this list, and the preservation test refuses "
  + "it. Do not move the 18,000 B band to make this go away: being this close to a refusal is the alarm.";

/**
 * @param {number} total bytes of the loaded set (`CLAUDE.md` plus every rules file)
 * @returns {{ verdict: "ok" | "warn" | "over", total: number, headroom: number, remedy: string, message: string }}
 *   `headroom` is bytes left to the REFUSAL, negative once over; `remedy` is empty when the verdict is `ok`.
 */
export function prefixBudgetVerdict(total) {
  const headroom = BUDGET_BYTES - total;
  if (total > BUDGET_BYTES) {
    return { verdict: "over", total, headroom, remedy: REMEDY, message: overMessage(total, headroom) };
  }
  if (total >= WARN_BYTES) {
    return { verdict: "warn", total, headroom, remedy: WARN_REMEDY, message: warnMessage(total, headroom) };
  }
  return { verdict: "ok", total, headroom, remedy: "", message: "" };
}

/** @param {number} n */
const bytes = (n) => `${n.toLocaleString("en-US")} B`;

/**
 * @param {number} total
 * @param {number} headroom
 */
function warnMessage(total, headroom) {
  return `PREFIX BUDGET WARNING: the loaded set is ${bytes(total)}, at or past the ${bytes(WARN_BYTES)} warn band, `
    + `with ${bytes(headroom)} of headroom before the ${bytes(BUDGET_BYTES)} refusal. This run passes; the next `
    + `rule written the old way may not.\n${WARN_REMEDY}`;
}

/**
 * @param {number} total
 * @param {number} headroom
 */
function overMessage(total, headroom) {
  return `OVER BUDGET by ${bytes(-headroom)}.\n${REMEDY}`;
}
