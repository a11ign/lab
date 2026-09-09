import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse as parseYaml } from "yaml";

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
];

/* THE SUMMARY CHECK IS MINUTE-GATED, NOT HOUR-GATED, and that is why it is not in CASES above.
 *
 * It runs TWICE on the morning of the edition -- 07:15 a reminder that exits 0, 07:45 a refusal that
 * fails -- so the hour alone cannot tell the two apart. Reading only the hour would make every morning
 * end in a red mark at 07:15 for a summary that is not yet late, which is the exact failure the
 * wrong-half-run rule below exists to prevent, arriving through a different door.
 *
 * The pair-of-facts hazard is unchanged and is why this test exists: FOUR crons and a gate that must
 * agree with all four. Someone moving the reminder will move one and not the other, and the failure is
 * silent -- the step simply never runs.
 */
const SUMMARY_CHECK = "board-summary-check.yml";
const SUMMARY_CRONS = ["15 6 * * *", "15 7 * * *", "45 6 * * *", "45 7 * * *"];

test(`${SUMMARY_CHECK} schedules all FOUR UTC crons for 07:15 and 07:45 London`, () => {
  const text = read(SUMMARY_CHECK);
  for (const cron of SUMMARY_CRONS) {
    assert.ok(text.includes(`cron: "${cron}"`),
      `${SUMMARY_CHECK} is missing the cron "${cron}". Each of 07:15 and 07:45 needs a BST and a GMT `
      + "spelling, or that run is an hour out for half the year.");
  }
});

test(`${SUMMARY_CHECK} reads the MINUTE and names a mode, because 07:15 and 07:45 differ only in exit code`, () => {
  const text = read(SUMMARY_CHECK);
  assert.match(text, /date \+%H:%M/,
    `${SUMMARY_CHECK} must read London's hour AND minute; the hour alone cannot separate the reminder `
    + "from the refusal");
  assert.match(text, /07:1\*\)\s*MODE=reminder/, "no 07:15 -> reminder branch");
  assert.match(text, /07:4\*\)\s*MODE=refuse/, "no 07:45 -> refuse branch");
  assert.match(text, /\*\)\s*MODE=none/, "no fall-through to a do-nothing mode");

  // Every working step must be gated on the mode, or it runs on all four crons.
  const steps = text.split(/\n {6}- /).slice(1);
  const working = steps.filter((s) => !s.startsWith("id: hour"));
  assert.ok(working.length >= 3, `only ${working.length} working steps found; this check would be weak`);
  const ungated = working
    .filter((s) => !/if: steps\.hour\.outputs\.mode/.test(s))
    .map((s) => s.split("\n")[0].slice(0, 60));
  assert.deepEqual(ungated, [],
    `these steps in ${SUMMARY_CHECK} are not gated on the mode, so they run on all four crons: `
    + `${ungated.join(", ")}`);
});

test(`${SUMMARY_CHECK}: the reminder exits 0 and the refusal does not -- they differ ONLY in that`, () => {
  const text = read(SUMMARY_CHECK);
  // The whole design is in these two lines: same script, same day, different exit code.
  assert.match(text, /--post --reminder/,
    "the 07:15 step must pass --reminder, or a summary that is merely not written yet fails the run");
  assert.match(text, /run: node scripts\/board-summary-check\.mjs --post\s*$/m,
    "the 07:45 step must run WITHOUT --reminder, or the refusal never refuses");
});

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
    const steps = text.split(/\n {6}- /).slice(1);
    // `id: republish` is DELIBERATELY not hour-gated -- it is the one documented way past the hour, and
    // its own safety is the release-exists precondition rather than the clock. Excluded by name, with
    // its own test below asserting both halves of that safety, rather than loosening this check.
    const working = steps.filter((s) => !s.startsWith("id: hour") && !s.startsWith("id: republish"));
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

test("republish CANNOT be reached from the schedule, and CANNOT create an edition", () => {
  const text = read("board-report.yml");

  // BOTH HALVES, because either alone is unsafe. Reachable-from-schedule would make the cron able to
  // trip it; creating-an-edition would make it an off-hour publish route rather than a replacement.
  assert.match(text, /if: github\.event_name == 'workflow_dispatch' && inputs\.republish/,
    "the republish step must be gated on the DISPATCH event as well as the input -- `inputs.republish` "
    + "is empty on a schedule event, and the event check says so explicitly rather than relying on it");

  assert.match(text, /gh release view "board\/\$DAY"/,
    "republish must check that TODAY'S RELEASE ALREADY EXISTS -- that single precondition is what makes "
    + "it a replacement rather than an override, since the worst it can then do is replace a document "
    + "the board already has");

  assert.match(text, /REFUSING: board\/\$DAY does not exist/,
    "the absent-release case must REFUSE and say why, never fall through to publishing");

  // Every working step must accept EITHER gate, or republish reaches some steps and not others and
  // produces a half-rendered edition -- worse than refusing.
  const steps = text.split(/\n {6}- /).slice(1);
  const working = steps.filter((s) => !s.startsWith("id: hour") && !s.startsWith("id: republish"));
  assert.ok(working.length >= 3, `only ${working.length} working steps found; this check would be weak`);
  const ungated = working
    .filter((s) => !s.includes("steps.republish.outputs.ok == 'true'"))
    .map((s) => s.split("\n")[0].slice(0, 60));
  assert.deepEqual(ungated, [],
    `these steps do not accept the republish gate, so a republish would run some and skip others: `
    + `${ungated.join(", ")}`);
});

// ---------------------------------------------------------------------------------------------------
// #590: THE EVENING RUN IS RETIRED ON PURPOSE, AND RESTORING IT MEANS GOING BACK TO THE BOARD.
//
// `board-summary-check` ran at 21:00 the evening before an edition until 2026-09-08, when the board moved
// it, in its own words: "it should be 30 mins before as it should be as fresh as possible as a lot
// happens over night." A summary written the evening before is a forecast about a night that has not
// happened -- measured that day, the queue went from twelve open PRs to zero between the summary being
// written and the edition rendering.
//
// This is pinned because the ghost outlived the decision: three files still described the 21:00 entry in
// the present tense on 2026-09-09, and one of them was the `// command:` header that GENERATES
// docs/commands.md -- so one stale line was being reproduced into a second document on every docs run. A
// future reader meeting that prose could restore an evening cron believing they were repairing a gap.
// ---------------------------------------------------------------------------------------------------
test("#590 board-summary-check runs in the MORNING of the edition, never the evening before", () => {
  const text = readFileSync(path.join(REPO, ".github/workflows/board-summary-check.yml"), "utf8");
  const doc = parseYaml(text) as { on: { schedule?: { cron: string }[] } };
  const crons = (doc.on.schedule ?? []).map((s) => s.cron);
  assert.ok(crons.length > 0, "the schedule must still exist -- an unscheduled check warns nobody");

  for (const cron of crons) {
    const hour = Number(cron.split(/\s+/)[1]);
    assert.ok(hour >= 5 && hour <= 8,
      `cron "${cron}" fires at ${hour}:00 UTC, outside the morning window. The board moved this check to `
      + "the morning of the edition on 2026-09-08 (2a1bdd92): a summary written the evening before is a "
      + "forecast about a night that has not happened. Restoring an evening run means taking that back to "
      + "the board, not adding a cron.");
  }
});

test("#590 no document describes the retired 21:00 entry as current", () => {
  // The `// command:` header is the one that matters: it GENERATES docs/commands.md, so a stale sentence
  // there is reproduced into a second document on every docs run -- one wrong line, two places, forever.
  for (const file of ["scripts/board-summary-check.mjs", "docs/commands.md", "docs/npm-scripts.md"]) {
    const text = readFileSync(path.join(REPO, file), "utf8");
    for (const line of text.split("\n")) {
      if (!line.includes("21:00")) continue;
      assert.match(line, /USED TO|until 2026|moved it|RIGHT WHEN IT RAN|was correct for/,
        `${file} mentions 21:00 outside a retraction:\n  ${line.trim()}\n`
        + "The evening run was retired on 2026-09-08. A description of it in the present tense is the "
        + "ghost that let three sessions believe the warning still existed.");
    }
  }
});
