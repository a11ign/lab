/**
 * A PRE-REGISTERED STATISTIC CAN GO MISSING AND THE RUN STILL REPORTS A RESULT.
 *
 * #22 named the statistic that would settle it in advance — *"the verdict is whether the median moved"* —
 * with the reason beside it: *"stating the falsifier before the run is what makes this a measurement
 * rather than a justification."* The per-arm median was not recovered. The run produced a wall-clock
 * proxy, the proxy answered the question the same way, and a hardware purchase recommendation turned on
 * it. **Nothing in the pipeline noticed. A person reading the row did.**
 *
 * THE FAILURE IS SILENT BY CONSTRUCTION. A run that produces SOMETHING looks like a run that produced THE
 * THING; the proxy is usually reasonable, so the result is usually right, which is what makes it
 * dangerous — it trains everyone to accept the substitution. And the substitution is invisible in the
 * output: the number is there, and only the row says which number it was supposed to be.
 *
 * This repo knows the shape as *a check that reports success having examined nothing*. This is a check
 * that reports success having examined **something else**.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { verdictStatisticState }
  from "../../../lab/scripts/check-preregistered-verdict.mjs";

const withMedian = "arm A: median 27.4s IQR 3.0 · arm B: median 35.1s IQR 17.9";
const proxyOnly = "arm A: 13,541s wall clock over 2,122 captures · arm B: 9,004s over 1,400";

test("the declared statistic is present: the run reported what it promised", () => {
  const v = verdictStatisticState({ verdictStatistic: "median", output: withMedian });
  assert.equal(v.state, "arrived");
});

test("MISSING is refused, and it is a different finding from 'it did not move'", () => {
  // The incident. The proxy answered the question and nothing said which number had answered it.
  const v = verdictStatisticState({ verdictStatistic: "median", output: proxyOnly });
  assert.equal(v.state, "missing");
  assert.match(v.why, /different findings and only one of them is a result/,
    "the refusal must say WHY it refuses rather than merely refusing -- 'the statistic is missing' and "
    + "'the statistic did not move' are the two the reader has to be able to tell apart");
});

test("a DECLARED proxy is allowed, and the caveat then travels with the number", () => {
  // The substitution is what this surfaces, not what it forbids. A run that publishes its own caveat has
  // done the honest thing; one that says nothing has published a number that LOOKS pre-registered.
  const v = verdictStatisticState({
    verdictStatistic: "median", output: proxyOnly, proxyFor: "median",
  });
  assert.equal(v.state, "proxy");
  assert.match(v.why, /DECLARES a proxy for median/);
});

test("an EMPTY proxyFor does not count as declaring one", () => {
  // Otherwise the escape is a keystroke: `proxyFor: ""` would silence the refusal while saying nothing,
  // which is the shape every EXEMPT table in this repo refuses by demanding a reason.
  assert.equal(verdictStatisticState({
    verdictStatistic: "median", output: proxyOnly, proxyFor: "  ",
  }).state, "missing");
});

test("SEVERAL statistics may be pre-registered, and one missing is enough to refuse", () => {
  // #22 named three: median, IQR and wall time. A run reporting two of three has not settled it.
  const v = verdictStatisticState({
    verdictStatistic: ["median", "IQR", "wall"], output: "median 27.4s, wall 13,541s",
  });
  assert.equal(v.state, "missing");
  assert.match(v.why, /IQR/, "the refusal must name WHICH statistic is absent, not just that one is");
});

test("no declaration is its OWN state, never an 'arrived'", () => {
  // The state most of the file is in today, and the one this check is in most danger from: an entry that
  // declares nothing must not be counted as an entry that reported everything.
  const v = verdictStatisticState({ output: withMedian });
  assert.equal(v.state, "undeclared");
  assert.doesNotMatch(v.why, /arrived|contains/);
});

test("the match is case-insensitive but not fuzzy: a NEAR word does not satisfy it", () => {
  assert.equal(verdictStatisticState({ verdictStatistic: "Median", output: withMedian }).state, "arrived");
  assert.equal(verdictStatisticState({ verdictStatistic: "median", output: "the medium was 27.4s" }).state,
    "missing", "a statistic is satisfied by its own name, not by something spelled nearly like it");
});
