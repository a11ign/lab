/**
 * THE WEEKLY OUTSIDER REVIEW IS FILED BY A HOST TIMER, UNDER THE WORKERS ACCOUNT (#3319; ceo, #3183).
 *
 * The first dispatch of `weekly-review.yml` filed #3287 and then died at `gh project item-add 1 --owner a11ign`:
 * `github.token` cannot see an organization Project v2, so the row had no Status, no `ready` and no board item. The schedule
 * is `.agent-org/units/a11ign-weekly-review.{service,timer}` now, and this file pins what that pair must say. It is the
 * PROJECT's pair (ADR 0040 decision 9): it runs a11ign's script against a11ign's `RELEASE.md`, so it is listed in `units.own`
 * and the tool ships nothing for it.
 *
 * Every reading is a function over unit TEXT, so each can be run over a text known to offend: `a11ign-lab-watch` is the
 * positive control (the same readings must pass on a unit that is right, or a test reading nothing would pass), and a copy of
 * the weekly service with a line deleted is the negative one.
 *
 * `host-units.mjs` is loaded by a path built here, for the reason `agent-org-wiring.test.ts` gives: a static import would
 * put this file in `work-gate.test.ts`'s history-requirement population over a question it never puts to git.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const UNITS = join(ROOT, ".agent-org/units");
const WORKERS_GH = "/home/agent/workers/gh";

interface UnclassifiedFinding { unit: string; problem: string }
interface HostUnits {
  unclassifiedEntries(deps: { projectUnitsDir: string; units: { own: string[] } }): UnclassifiedFinding[];
}
const { unclassifiedEntries } = await import(pathToFileURL(join(ROOT, "node_modules/agent-org/src/host-units.mjs")).href) as HostUnits;

const SERVICE = "a11ign-weekly-review.service";
const TIMER = "a11ign-weekly-review.timer";
const unitText = (name: string) => readFileSync(join(UNITS, name), "utf8");
const declaredOwn = (): string[] => (JSON.parse(readFileSync(join(ROOT, ".agent-org/project.json"), "utf8")) as { units: { own: string[] } }).units.own;

/** The value of the one `Key=` line a unit has, or null: a comment that merely MENTIONS the key does not count. */
const setting = (text: string, key: string): string | null => new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1] ?? null;

/** What a service must say wherever it spends `gh`: which account, declared, and no `[Install]` that would start it at boot. */
function accountAndInstallProblems(text: string): string[] {
  const account = setting(text, "Environment=GH_CONFIG_DIR");
  return [
    ...(account !== null && account.startsWith(WORKERS_GH) && account.endsWith("/gh") ? [] : [`GH_CONFIG_DIR is ${JSON.stringify(account)}, not the workers account's ${WORKERS_GH}`]),
    ...(/^\[Install\]$/m.test(text) ? ["it has an [Install] section, so WantedBy=default.target would run it at every boot"] : []),
  ];
}

/** The service's `ExecStart` must run the weekly script, named repository-relative so it resolves from any checkout. */
const runsWeeklyScript = (text: string): boolean => (setting(text, "ExecStart") ?? "").includes("scripts/weekly-review.mjs");

/** Whether an `OnCalendar` expression names Monday as its weekday (systemd's weekday comes FIRST, before the date). */
const firesOnMonday = (expression: string): boolean => /^Mon\b/i.test(expression.trim());

const withoutLine = (text: string, key: string): string => text.split("\n").filter((line) => !line.startsWith(`${key}=`)).join("\n");

test("the weekly service declares the workers account and has no [Install] section", () => {
  assert.deepEqual(accountAndInstallProblems(unitText(SERVICE)), []);
});

test("POSITIVE CONTROL: the same readings pass on a11ign-lab-watch.service, and say no to a service that offends", () => {
  assert.deepEqual(accountAndInstallProblems(unitText("a11ign-lab-watch.service")), []);
  const labWatch = unitText("a11ign-lab-watch.service");
  assert.equal(accountAndInstallProblems(withoutLine(labWatch, "Environment=GH_CONFIG_DIR")).length, 1);
  assert.equal(accountAndInstallProblems(`${labWatch}\n[Install]\nWantedBy=default.target\n`).length, 1);
});

test("NEGATIVE CONTROL: a copy of the weekly service with GH_CONFIG_DIR deleted FAILS the account reading", () => {
  const problems = accountAndInstallProblems(withoutLine(unitText(SERVICE), "Environment=GH_CONFIG_DIR"));
  assert.ok(problems.some((problem) => /GH_CONFIG_DIR is null/.test(problem)), `read: ${JSON.stringify(problems)}`);
});

test("the weekly service's ExecStart names scripts/weekly-review.mjs, and a service that does not is refused", () => {
  assert.ok(runsWeeklyScript(unitText(SERVICE)));
  assert.ok(!runsWeeklyScript(unitText("a11ign-lab-watch.service")), "POSITIVE CONTROL: the reading can say no");
  assert.ok(!runsWeeklyScript(withoutLine(unitText(SERVICE), "ExecStart")));
});

test("the weekly timer persists across a sleeping host and fires on a Monday, and the readings can say no", () => {
  const timer = unitText(TIMER);
  assert.equal(setting(timer, "Persistent"), "true");
  assert.ok(firesOnMonday(setting(timer, "OnCalendar") ?? ""), `OnCalendar is ${setting(timer, "OnCalendar")}`);
  const hourly = unitText("a11ign-lab-watch.timer");
  assert.equal(setting(hourly, "Persistent"), "true", "POSITIVE CONTROL: Persistent is read off a timer that has it");
  assert.ok(!firesOnMonday(setting(hourly, "OnCalendar") ?? ""), "POSITIVE CONTROL: an every-hour expression is not a Monday one");
  assert.ok(!firesOnMonday("Tue *-*-* 06:17:00 UTC") && !firesOnMonday("*-*-* 06:17:00 UTC"));
});

test("the timer does not `Requires=` the service: `host:install` must not file a row as a side effect", () => {
  assert.equal(setting(unitText(TIMER), "Requires"), null);
});

test("#1352: the unit declares a launch reason for `row-file`, and the script it runs is the one that needs it", () => {
  const reason = setting(unitText(SERVICE), "Environment=\"A11Y_POLICY_LAUNCH_REASON");
  assert.ok(reason !== null && reason.length > "\"".length, "without the reason `row-file` refuses the host's primary checkout and the unit fails every Monday");
  const script = readFileSync(join(ROOT, "scripts/weekly-review.mjs"), "utf8");
  assert.match(script, /"row-file"/, "the filing really goes through `row-file`, which is what launchGate guards");
});

test("the unit supplies GITHUB_SHA, which the script refuses to run without, and updates the checkout first", () => {
  const script = readFileSync(join(ROOT, "scripts/weekly-review.mjs"), "utf8");
  assert.match(script, /process\.env\.GITHUB_SHA/, "POSITIVE CONTROL: the script still reads it, so the line below is still needed");
  assert.match(setting(unitText(SERVICE), "ExecStart") ?? "", /GITHUB_SHA=/);
  assert.equal(setting(unitText(SERVICE), "ExecStartPre"), "-%h/.local/bin/pnpm run primary:update",
    "the script reads RELEASE.md and docs/try-it.md from this checkout, so a stale one files last week's requirements");
});

test("both names are in units.own, and the project's own classification reports neither as unlisted", () => {
  const own = declaredOwn();
  assert.ok(own.includes(SERVICE) && own.includes(TIMER));
  assert.deepEqual(unclassifiedEntries({ projectUnitsDir: UNITS, units: { own } }), []);
});

test("POSITIVE CONTROL: with the two names left out of units.own the classification names both files", () => {
  const own = declaredOwn().filter((name) => name !== SERVICE && name !== TIMER);
  const unlisted = unclassifiedEntries({ projectUnitsDir: UNITS, units: { own } }).map(({ unit }) => unit).sort();
  assert.deepEqual(unlisted, [SERVICE, TIMER]);
});
