import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/* THE STATED HOUR MUST BE TRUE IN WINTER TOO.
 *
 * GitHub schedules in UTC only. A single cron is the right London hour for half the year and an hour out
 * for the other half, so both are scheduled and every working step is gated on London's actual clock.
 * Exactly one of the pair acts on any given day.
 *
 * THIS TEST EXISTS BECAUSE THE PAIR IS TWO FACTS THAT MUST AGREE: the crons, and the hour the gate
 * compares against. Someone changing the publish time will move one and not the other, and the failure is
 * silent -- the job simply never runs, or runs twice. That is the "fact stated twice" shape with a clock
 * in it, and nothing else in the repository would catch it.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (f: string) => readFileSync(path.join(REPO, ".github/workflows", f), "utf8");

const CASES: [string, string, string][] = [
  // file, London hour it claims, the two UTC crons that bracket it
  ["board-report.yml", "08", "0 7 * * *|0 8 * * *"],
  ["board-summary-check.yml", "21", "0 20 * * *|0 21 * * *"],
];

for (const [file, hour, crons] of CASES) {
  test(`${file} schedules BOTH UTC hours that can be ${hour}:00 in London`, () => {
    const text = read(file);
    for (const cron of crons.split("|")) {
      assert.ok(text.includes(`cron: "${cron}"`),
        `${file} is missing the cron "${cron}". Only one of the pair is scheduled, so the job is an hour `
        + "out for half the year — which is the untruth the pair exists to remove.");
    }
  });

  test(`${file} gates every working step on London reading ${hour}`, () => {
    const text = read(file);
    const guard = `if: steps.hour.outputs.london == '${hour}'`;
    assert.ok(text.includes(`echo "london=$LONDON"`),
      `${file} has no step computing London's hour, so the pair of crons would BOTH act`);
    assert.match(text, new RegExp(`\\[ "\\$LONDON" = "${hour}" \\]`),
      `${file} computes London's hour but does not compare it against ${hour}`);

    // Every step after the gate must carry it. A step without it runs twice a day for half the year.
    const steps = text.split(/\n      - /).slice(1);
    const working = steps.filter((s) => !s.startsWith("id: hour"));
    assert.ok(working.length >= 3, `only ${working.length} working steps found; this check would be weak`);
    const ungated = working.filter((s) => !s.includes(guard)).map((s) => s.split("\n")[0].slice(0, 60));
    assert.deepEqual(ungated, [],
      `these steps in ${file} are not gated on London's hour, so they run on BOTH crons: `
      + `${ungated.join(", ")}`);
  });
}

test("the wrong-half run is a SUCCESS, not a failure", () => {
  // A job that fails every day for behaving correctly puts a red mark on the repository daily, and a
  // signal that is red every day is a signal nobody reads. The off-hour run does nothing and exits 0.
  for (const [file] of CASES) {
    const text = read(file);
    assert.doesNotMatch(text, /exit 1[\s\S]{0,80}LONDON/,
      `${file} appears to fail the off-hour run; it must succeed having done nothing`);
    assert.match(text, /Doing nothing, successfully/,
      `${file} must SAY that the off-hour run did nothing deliberately, or its empty log reads as a fault`);
  }
});
