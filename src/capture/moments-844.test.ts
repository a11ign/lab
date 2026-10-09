/**
 * THE TWO HALVES OF THE RATIO ARE MINUTES APART, AND NOW THE CAPTURE SAYS SO — #844.
 *
 * #800 could not answer whether IKEA serves 265 form controls or the sweep walks more than is there.
 * #836 shipped the wrong mechanism, #850 shipped the right one — a gate that refused any verdict because
 * no capture recorded WHEN its census was read — and #854 added `readAt.startedAtMs` so they could.
 *
 * **The answer that field unlocked is worse than "unknown", and it is a bound rather than an absence.**
 * On the 14 captures carrying `readAt`, the census lands at **28–67 s** and the `formField` sweep walks at
 * **37–280 s**. Knowing both moments PROVES they are not the same moment. A gate that opened merely
 * because the moments were recorded would have read *"we can see the gap"* as *"there is no gap"*.
 *
 * ## THE CONTROL THE ROW NAMED BEFORE ANYTHING COULD MEASURE IT
 *
 * `heading` carries no `onItem`, so the sweep changes nothing, and a heading is a heading in the DOM, in
 * the accessibility tree and to NVDA alike — no role-bucket argument can reach it. **So a `heading` ratio
 * of exactly 1 is direct evidence the page did not change over that interval**, whatever its length. That
 * is what opens the gate, in place of a threshold on time that somebody would have had to choose.
 *
 * ## AND IT REFUTES THE ROW'S FIRST OPTION
 *
 * The row offers three: widen `FORM_CONTROL_ROLES`, report a per-role breakdown, or record the role each
 * announcement came from. **Option 1 is refuted by measurement**, and the discriminator is the DOM census
 * sitting beside the AX one:
 *
 *     capture       DOM formField    AX formControl    sweep found    heading ratio
 *     ikea                     51               136            270             1.16
 *     salesforce                7                18             27             1.11
 *     tfl                    1392                15             34             1.00
 *     w3.org                   15                15             15             1.00
 *
 * **On ikea and salesforce the AX bucket is already WIDER than the DOM's form elements** — 136 against 51.
 * Widening `FORM_CONTROL_ROLES` would move the number further from the page, not closer.
 *
 * **And tfl is the capture that rules out page growth on its own**: `heading` reads 1.00, so the page held
 * still, and `formField` still reads 2.27. Whatever that gap is, it is not the page changing and it is not
 * a bucket that is too narrow — the DOM count above it is 1392.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sweepAgainstCensus, populationVerdict, pageHeldStill } from "./sweep-vs-census.mjs";

const fixture = JSON.parse(readFileSync(
  resolve(import.meta.dirname, "fixtures-moments-844.json"), "utf8")) as {
    captures: {
      source: string, site: string, domFormField: number | null,
      structureCensus: Record<string, unknown>,
      sweeps: Record<string, unknown>[],
    }[],
  };

const capture = (site: string) => {
  const found = fixture.captures.find((c) => c.site.includes(site));
  assert.ok(found, `the fixture no longer holds a ${site} capture`);
  return found!;
};
const rowsFor = (site: string) => {
  const c = capture(site);
  return sweepAgainstCensus({ diagnostics: [c.structureCensus, ...c.sweeps] } as never);
};
const row = (site: string, type: string) => {
  const r = rowsFor(site).find((x) => x.type === type);
  assert.ok(r, `${site} has no ${type} sweep in the fixture`);
  return r!;
};

test("the gap between the two reads is a NUMBER now, not an unknown", () => {
  // #850 could only say "nobody recorded when". This says how far apart, per sweep, on the record.
  const ff = row("ikea", "formField");
  assert.equal(typeof ff.censusReadAt, "number");
  assert.equal(typeof ff.sweptAt, "number");
  assert.ok(ff.apartMs! > 200_000,
    `ikea's census and its formField sweep are ${ff.apartMs} ms apart — the ratio's two halves describe `
    + "moments minutes apart, which is the row's whole question");
});

test("an unknown moment stays unknown — absent is not a gap of zero", () => {
  const noReadAt = sweepAgainstCensus({ diagnostics: [
    { event: "structureCensus", atMs: 400_000, formControl: 125 },
    { event: "sweep", type: "formField", found: 265, atMs: 300_000, prevStop: "exhausted", nextStop: "exhausted" },
  ] } as never);
  assert.equal(noReadAt[0].apartMs, null,
    "a capture from before #854 cannot say how far apart the reads were, and must not be given a 0");
});

test("THE CONTROL: `heading` says whether the page held still", () => {
  assert.equal(pageHeldStill(rowsFor("tfl")), true, "tfl's heading sweep found exactly what was counted");
  assert.equal(pageHeldStill(rowsFor("w3-org")), true);
  assert.equal(pageHeldStill(rowsFor("ikea")), false, "ikea gained headings between the two reads");
  assert.equal(pageHeldStill(rowsFor("salesfor")), false);
});

test("a ratio BELOW 1 is not a shrinking page — the control declines to report", () => {
  // hubspot's heading sweep found 1 of 28. The page did not lose 27 headings; the sweep was sealed inside
  // a chat dialog and exhausted it (#897). Reporting `false` would be right for the wrong reason, and a
  // reader would look for growth that never happened.
  assert.equal(pageHeldStill(rowsFor("hubspot")), null,
    "the control must say it could not report, rather than answer about the page");
});

test("no verdict without the control, however well the moments are recorded", () => {
  const ratios = [2.27, 2.12];
  assert.equal(populationVerdict(ratios, { censusReadAt: [60_000, 61_000] }), "not-simultaneous");
  assert.equal(populationVerdict(ratios, { censusReadAt: [60_000, 61_000], heldStill: false }),
    "not-simultaneous", "a page that grew cannot support a ratio about what it holds");
  assert.equal(populationVerdict(ratios, { censusReadAt: [60_000, 61_000], heldStill: true }),
    "sweep-exceeds", "and a controlled comparison finally gets one");
});

test("OPTION 1 IS REFUTED: the AX bucket is already wider than the DOM's form elements", () => {
  // The row's first option is to widen `FORM_CONTROL_ROLES` to whatever NVDA's quick-nav visits. On the
  // two lazy-loading pages the AX census is already several times the DOM count, so widening moves the
  // denominator further from the page rather than closer.
  for (const site of ["ikea", "salesfor"]) {
    const c = capture(site);
    const ax = c.structureCensus.formControl as number;
    assert.ok(ax > c.domFormField!,
      `${site}: AX formControl ${ax} is already wider than DOM formField ${c.domFormField} — widening the `
      + "role set is aimed the wrong way");
  }
});

test("tfl rules out page growth on its own, and that is what makes it the interesting capture", () => {
  // The heading control says the page held still; formField still reads 2.27. So on this capture the gap
  // is neither the page changing nor — given the DOM count above it — a bucket that is too narrow.
  assert.equal(pageHeldStill(rowsFor("tfl")), true);
  const ff = row("tfl", "formField");
  assert.ok(ff.ratio! > 2, `formField reads ${ff.ratio?.toFixed(2)} on a page whose headings did not move`);
  assert.equal(capture("tfl").domFormField, 1392,
    "and the DOM count above it is 1392 — three instruments, three populations, on one still page");
});
