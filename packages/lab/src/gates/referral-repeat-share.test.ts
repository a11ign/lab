import assert from "node:assert/strict";
import { test } from "node:test";

import { pageShare, referralsOf, repeatShare, render, GROUPING_THRESHOLD } from "../../scripts/referral-repeat-share.mjs";

const r = (criterion: string, text: string) => ({ criterion, text });

test("positive control: five referrals, three repeating an earlier pair, is 0.6", () => {
  const page = [r("1.1.1", "a"), r("1.1.1", "a"), r("1.1.1", "a"), r("4.1.2", "b"), r("4.1.2", "b")];
  assert.deepEqual(pageShare(page), { referrals: 5, repeats: 3, share: 0.6 });
});

test("five distinct referrals have no repeats", () => {
  const page = [r("1.1.1", "a"), r("1.1.1", "b"), r("4.1.2", "a"), r("4.1.2", "b"), r("2.4.4", "a")];
  assert.deepEqual(pageShare(page), { referrals: 5, repeats: 0, share: 0 });
});

test("a page with no referrals reports 0 referrals and does not divide by zero", () => {
  assert.deepEqual(pageShare([]), { referrals: 0, repeats: 0, share: 0 });
  assert.equal(repeatShare([{ page: "empty", referrals: [] }]).total.share, 0);
});

test("the total is the sum over pages, not the mean of shares", () => {
  const big = Array.from({ length: 10 }, () => r("1.1.1", "x")); // 9 repeats of 10
  const small = [r("1.1.1", "y")]; // 0 of 1
  const { total } = repeatShare([{ page: "big", referrals: big }, { page: "small", referrals: small }]);
  assert.deepEqual(total, { pages: 2, referrals: 11, repeats: 9, share: 9 / 11 });
  assert.notEqual(total.share, (0.9 + 0) / 2);
});

test("a pair repeats only within its own page", () => {
  const { total } = repeatShare([{ page: "a", referrals: [r("1.1.1", "x")] }, { page: "b", referrals: [r("1.1.1", "x")] }]);
  assert.equal(total.repeats, 0);
});

test("the criterion's name and the quote's whitespace do not make a pair distinct", () => {
  const page = [r("1.3.1 Info and Relationships", "two  words"), r("1.3.1", " two words\n")];
  assert.equal(pageShare(page).repeats, 1);
  assert.equal(pageShare([r("1.3.1", "a"), r("1.3.2", "a")]).repeats, 0);
});

test("a Judgment's findings are referrals unless they assert", () => {
  const judgment = {
    findings: [
      { wcag: "1.1.1 Non-text Content", evidence: "graphic", mapping: "conformance" },
      { wcag: "2.4.4 Link Purpose", evidence: "click here" },
      { wcag: "2.4.4 Link Purpose", evidence: "click here", mapping: "secondary" },
    ],
  };
  assert.deepEqual(referralsOf(judgment), [r("2.4.4 Link Purpose", "click here"), r("2.4.4 Link Purpose", "click here")]);
  assert.throws(() => referralsOf({}), /neither/);
});

test("the rendering names which side of the line the total falls", () => {
  const above = render(repeatShare([{ page: "p", referrals: [r("1.1.1", "a"), r("1.1.1", "a")] }]));
  const below = render(repeatShare([{ page: "p", referrals: [r("1.1.1", "a"), r("1.1.1", "b")] }]));
  assert.match(above, /AT OR ABOVE/);
  assert.match(below, /BELOW/);
  assert.equal(GROUPING_THRESHOLD, 0.2);
});
