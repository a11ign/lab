/**
 * THE THREE-EDITION RULE: an achievement stays in the BODY for at most three editions, then lives in the
 * record and the appendix. `ceo`'s ruling, 2026-09-09, and it exists so the two-page cap is met by a rule
 * rather than by a hand decision each time the body fills — a decision taken by hand each week is one
 * that will be taken badly on the week nobody has time.
 *
 * THE COUNT AND THE BULLETS MUST AGREE, and that is why these tests exist rather than a data edit. The
 * ruling's first wording had the bullets filter and section 3's headline count not, which would have
 * printed "We made five things demonstrable today" above three bullets — #284's exact defect (a numeral
 * that looked like a fact while the list under it said otherwise, read by five people and caught by
 * nobody), reintroduced by the fix for a different one. Corrected in the ruling the same hour, and pinned
 * here so it cannot come back the next time somebody filters one and not the other.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { document } from "../../../../scripts/board-document.mjs";

// no-token: todaysReleaseExists
//
// #827: this file imports ONLY `document` from board-document.mjs, and every test below renders it from a
// literal fixture object -- never from `collect()`, never from anything that reaches `gh`. But the
// acceptance closure walk scans the WHOLE FILE'S text for a `gh` spawn, not the one export this file
// actually imports, and board-document.mjs's OWN `todaysReleaseExists` (a real `gh release view` call,
// used only by the daily-edition CLI path this file never touches) tripped it. Measured: 7/7 pass with
// `gh` stubbed to exit 4 on every call -- this file genuinely needs no token. Verified, not merely
// declared: the acceptance job's own closure walk checks this file's text does not call
// `todaysReleaseExists(` before trusting the declaration.

const base = {
  since: "2026-01-01T00:00:00Z",
  all: [], open: [], closed: [], milestones: [], release: null,
  merges: [], unpushed: 0, strays: [], latestGate: null, gateIsFresh: false,
  fleetHours: { status: "not instrumented", note: "no total exists." },
};

const achievement = (n: number, extra: Record<string, unknown> = {}) => ({
  claim: `Claim ${n}.`,
  boardClaim: `Board claim ${n}.`,
  evidence: `Evidence for ${n}, verified by command.`,
  issue: n, reportedBy: "product-manager", at: "2026-01-01T00:00:00Z", ...extra,
});

const render = (achievements: unknown[]) => document({ ...base, achievements } as never);
const body = (md: string) => md.split(/^## Appendix/m)[0]!;
const appendix = (md: string) => md.split(/^## Appendix/m)[1] ?? "";

test("a retired achievement leaves the body", () => {
  const md = render([achievement(1), achievement(2, { inBody: false })]);
  assert.match(body(md), /Board claim 1\./);
  assert.doesNotMatch(body(md), /Board claim 2\./,
    "`inBody: false` must remove it from section 3, or the rule does nothing");
});

test("RETIRING IS NOT WITHDRAWING — the appendix still carries it, with its evidence", () => {
  const md = render([achievement(1), achievement(2, { inBody: false })]);
  assert.match(appendix(md), /Board claim 2\./);
  assert.match(appendix(md), /Evidence for 2/,
    "a retired achievement is still a thing the product can do; its evidence must not vanish with it");
});

test("THE HEADLINE COUNTS WHAT IS LISTED — five recorded, two shown, the page says two", () => {
  const md = render([achievement(1), achievement(2),
    achievement(3, { inBody: false }), achievement(4, { inBody: false }), achievement(5, { inBody: false })]);
  assert.match(body(md), /We made two things demonstrable today/);
  assert.equal((body(md).match(/^- \*\*/gm) ?? []).length, 2,
    "the count in the headline and the number of bullets are the same fact and must be derived once");
});

test("the appendix heading carries the TOTAL, so the whole number is on the page without body words", () => {
  const md = render([achievement(1), achievement(2, { inBody: false }), achievement(3, { inBody: false })]);
  assert.match(appendix(md), /Evidence for every achievement to date: 3\./);
  assert.match(appendix(md), /The 1 listed in section 3 are the most recent/);
});

test("ABSENT MEANS IN THE BODY — forgetting the rule can never silently empty section 3", () => {
  // Every record written before this rule existed carries no `inBody` key at all. If absent read as
  // retired, the first edition after this change would have printed "We made zero things demonstrable
  // today" over an appendix full of them — the rule erasing the section it was written to protect.
  const md = render([achievement(1), achievement(2)]);
  assert.match(body(md), /We made two things demonstrable today/);
});

test("`inBody: true` is honoured as explicitly as its absence", () => {
  const md = render([achievement(1, { inBody: true }), achievement(2, { inBody: false })]);
  assert.match(body(md), /We made one thing demonstrable today/);
  assert.match(body(md), /Board claim 1\./);
});

test("every achievement retired still renders section 3's empty case, not a headline over nothing", () => {
  // The one state where the filter and the empty-section message must agree. A body reading "We made zero
  // things demonstrable today" followed by bullets, or by silence with no explanation, are both wrong;
  // the existing empty case says plainly that nobody wrote one.
  const md = render([achievement(1, { inBody: false })]);
  assert.match(body(md), /Nothing was recorded for this period/);
  assert.doesNotMatch(body(md), /^- \*\*/m);
  assert.match(appendix(md), /Board claim 1\./,
    "and the appendix still carries it — the record is not empty, only the body is");
});
