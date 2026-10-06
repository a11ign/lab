/**
 * THE WEEKLY CALLS-AND-DOLLARS READING IS POSTED BY A HOST TIMER, AFTER THE CI-HEALTH COMMENT EXISTS (#3690, the host half of #3217).
 *
 * `scripts/token-cost.mjs --post` edits the comment `ci-health.yml` posts on Mondays at 06:43Z, and exits non-zero without
 * changing anything while that comment is absent. A scheduled run has started up to 8h44m late (#965, #3678), so what must hold
 * of `.agent-org/units/a11ign-token-cost-weekly.{service,timer}` is that it RETRIES, that the retry is BOUNDED and ends inside
 * Monday UTC (the script reads the week of TODAY's UTC day), and that a final failure is a FAILED unit. It is the PROJECT's
 * pair (`units.own`), pinned beside `weekly-review-unit.test.ts`, whose reading of the account and `[Install]` it repeats.
 *
 * Every reading is a function over unit TEXT, so each runs over a text known to offend: `a11ign-weekly-review.service` is the
 * positive control for the readings it shares, and a copy of the new service with a line removed or added is the negative one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const UNITS = join(ROOT, ".agent-org/units");
const WORKERS_GH = "/home/agent/workers/gh";
const SERVICE = "a11ign-token-cost-weekly.service";
const TIMER = "a11ign-token-cost-weekly.timer";
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
/** `ci-health.yml`'s first Monday slot, `43 6 * * 1`. */
const FIRST_SLOT = { hour: 6, minute: 43 };

const unitText = (name: string) => readFileSync(join(UNITS, name), "utf8");
const declaredOwn = (): string[] => (JSON.parse(readFileSync(join(ROOT, ".agent-org/project.json"), "utf8")) as { units: { own: string[] } }).units.own;

/** The value of the one `Key=` line a unit has, or null: a comment that merely MENTIONS the key does not count. */
const setting = (text: string, key: string): string | null => new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1] ?? null;
const withoutLine = (text: string, key: string): string => text.split("\n").filter((line) => !line.startsWith(`${key}=`)).join("\n");

/** What a service must say wherever it spends `gh`: which account, declared, and no `[Install]` that would start it at boot. */
function accountAndInstallProblems(text: string): string[] {
  const account = setting(text, "Environment=GH_CONFIG_DIR");
  return [
    ...(account !== null && account.startsWith(WORKERS_GH) && account.endsWith("/gh") ? [] : [`GH_CONFIG_DIR is ${JSON.stringify(account)}, not the workers account's ${WORKERS_GH}`]),
    ...(/^\[Install\]$/m.test(text) ? ["it has an [Install] section, so WantedBy=default.target would run it at every boot"] : []),
  ];
}

/** Minutes in a systemd time span of the forms this repository writes (`90min`, `12h`, `300`), or null for anything else. */
function minutesOf(span: string | null): number | null {
  const match = span === null ? null : /^(\d+)\s*(min|h)?$/.exec(span.trim());
  if (match === null) return null;
  return Number(match[1]) * (match[2] === "h" ? MINUTES_PER_HOUR : 1);
}

/** Minutes after 00:00 UTC of an `OnCalendar` expression's hour, or null when it is not a `Mon ... HH:MM:SS UTC` form. */
function mondayStartMinute(expression: string): number | null {
  const match = /^Mon\s+\*-\*-\*\s+(\d{2}):(\d{2}):\d{2}\s+UTC$/i.exec(expression.trim());
  return match === null ? null : Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

interface RetryReading { problems: string[]; lastStartMinute: number | null }

/**
 * Whether the service retries on a failure, with a bound, and the minute of the LAST start if the timer's first start is `firstStart`.
 * A retry with no `StartLimitBurst` is unbounded, and one whose last start passes midnight UTC asks for a different week's comment.
 */
function retryReading(service: string, firstStart: number | null): RetryReading {
  const restart = setting(service, "Restart");
  const gap = minutesOf(setting(service, "RestartSec"));
  const burst = Number(setting(service, "StartLimitBurst"));
  const problems = [
    ...(restart === "on-failure" ? [] : [`Restart is ${JSON.stringify(restart)}, not on-failure, so a failure is never retried`]),
    ...(gap !== null && gap > 0 ? [] : ["RestartSec is missing or not a span, so a retry would be immediate"]),
    ...(Number.isInteger(burst) && burst > 1 ? [] : ["StartLimitBurst is missing or 1, so the retry has no stated bound"]),
  ];
  if (problems.length > 0 || firstStart === null || gap === null) return { problems, lastStartMinute: null };
  const lastStartMinute = firstStart + (burst - 1) * gap;
  return {
    problems: lastStartMinute < MINUTES_PER_DAY ? problems : [...problems, `the last start is at minute ${lastStartMinute} of the day, past 00:00Z, when the script asks for the NEXT week's comment`],
    lastStartMinute,
  };
}

/** The retry window must be stated in a comment beside the unit's evidence: a run id, which is a long number. */
const citesLateStartRun = (text: string): boolean => /^#.*\b\d{11}\b/m.test(text);

test("the service declares the workers account and has no [Install] section; the readings can say no", () => {
  assert.deepEqual(accountAndInstallProblems(unitText(SERVICE)), []);
  assert.deepEqual(accountAndInstallProblems(unitText("a11ign-weekly-review.service")), [], "POSITIVE CONTROL: the same reading passes on the weekly review's service");
  assert.equal(accountAndInstallProblems(withoutLine(unitText(SERVICE), "Environment=GH_CONFIG_DIR")).length, 1);
  assert.equal(accountAndInstallProblems(`${unitText(SERVICE)}\n[Install]\nWantedBy=default.target\n`).length, 1);
});

test("ExecStart runs scripts/token-cost.mjs with --post, repository-relative, and a service that does not is refused", () => {
  const execStart = setting(unitText(SERVICE), "ExecStart") ?? "";
  assert.ok(execStart.includes("scripts/token-cost.mjs") && /\s--post(\s|$)/.test(execStart), `ExecStart is ${execStart}`);
  assert.ok(!(setting(unitText("a11ign-weekly-review.service"), "ExecStart") ?? "").includes("scripts/token-cost.mjs"), "POSITIVE CONTROL: the reading can say no");
  assert.ok(!(setting(withoutLine(unitText(SERVICE), "ExecStart") , "ExecStart") ?? "").includes("--post"));
});

test("the service retries on failure, boundedly, and its last start is inside Monday UTC", () => {
  const first = mondayStartMinute(setting(unitText(TIMER), "OnCalendar") ?? "");
  assert.notEqual(first, null, "the timer's OnCalendar is a Monday UTC time");
  const reading = retryReading(unitText(SERVICE), first);
  assert.deepEqual(reading.problems, []);
  assert.ok(reading.lastStartMinute !== null && reading.lastStartMinute < MINUTES_PER_DAY, `last start at minute ${reading.lastStartMinute}`);
});

test("the retry reading says no: without Restart, without a bound, or with a window that crosses midnight UTC", () => {
  const service = unitText(SERVICE);
  const first = mondayStartMinute(setting(unitText(TIMER), "OnCalendar") ?? "");
  assert.equal(retryReading(withoutLine(service, "Restart"), first).problems.length, 1, "no retry");
  assert.equal(retryReading(withoutLine(service, "StartLimitBurst"), first).problems.length, 1, "no bound");
  assert.equal(retryReading(withoutLine(service, "RestartSec"), first).problems.length, 1, "no spacing");
  const tooLong = service.replace(/^StartLimitBurst=.*$/m, "StartLimitBurst=20");
  assert.match(retryReading(tooLong, first).problems.join(" "), /past 00:00Z/);
  assert.deepEqual(retryReading(service.replace(/^StartLimitBurst=.*$/m, "StartLimitBurst=2"), first).problems, [], "POSITIVE CONTROL: a short bound passes");
});

test("a failure ends FAILED, not green: no SuccessExitStatus, and the start limit window outlasts the retries", () => {
  const service = unitText(SERVICE);
  assert.equal(setting(service, "SuccessExitStatus"), null, "a non-zero exit must stay a failure");
  const window = minutesOf(setting(service, "StartLimitIntervalSec"));
  const gap = minutesOf(setting(service, "RestartSec")) ?? 0;
  const burst = Number(setting(service, "StartLimitBurst"));
  assert.ok(window !== null && window > (burst - 1) * gap, "a window shorter than the retries would forget the early starts and never hit the limit");
});

test("the timer fires on a Monday, persists, and does not `Requires=` the service", () => {
  const timer = unitText(TIMER);
  assert.equal(setting(timer, "Persistent"), "true");
  assert.notEqual(mondayStartMinute(setting(timer, "OnCalendar") ?? ""), null, `OnCalendar is ${setting(timer, "OnCalendar")}`);
  assert.equal(mondayStartMinute("Tue *-*-* 12:13:00 UTC"), null, "POSITIVE CONTROL: another weekday is not a Monday one");
  assert.equal(mondayStartMinute(setting(unitText("a11ign-lab-watch.timer"), "OnCalendar") ?? ""), null, "POSITIVE CONTROL: an every-hour expression is not one");
  assert.equal(setting(timer, "Requires"), null, "`host:install` must not post as a side effect");
});

test("the first start is after the 06:43Z slot, and the unit's comment cites the late-start run it rests on", () => {
  const first = mondayStartMinute(setting(unitText(TIMER), "OnCalendar") ?? "");
  const slot = FIRST_SLOT.hour * MINUTES_PER_HOUR + FIRST_SLOT.minute;
  assert.ok(first !== null && first > slot, "the comment is due 06:43Z; an attempt before it can only fail");
  assert.ok(citesLateStartRun(unitText(SERVICE)));
  assert.ok(!citesLateStartRun(unitText("a11ign-lab-watch.service").replace(/\b\d{11}\b/g, "")), "POSITIVE CONTROL: the reading can say no");
});

test("both names are in units.own", () => {
  const own = declaredOwn();
  assert.ok(own.includes(SERVICE) && own.includes(TIMER));
});
