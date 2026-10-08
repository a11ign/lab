/**
 * A `regression` ROW THE OUTSIDER JOB FILED IS BOARDED BY A HOST TIMER, UNDER THE WORKERS ACCOUNT (#3328; follow-up to #3184).
 *
 * The job files under `github.token`, which cannot see organization Project 1, so the row exists with no Project item, no
 * Status, no `ready` and no lane label. `.agent-org/units/a11ign-regression-board.{service,timer}` is the sweep, and this file
 * pins what the pair must say AND what its ExecStart does when run: the text readings are functions over unit text so each can
 * be run over a text known to offend (`a11ign-weekly-review.service`, #3319, is the positive control; a copy with a line
 * deleted is the negative one), and the behaviour tests run the real ExecStart script with a fake `gh` and a fake tool.
 *
 * `host-units.mjs` is loaded by a path built here, for the reason `weekly-review-unit.test.ts` gives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toolPath } from "../../../../scripts/agent-org-newest-tag.mjs";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const UNITS = join(ROOT, ".agent-org/units");
const WORKERS_GH = "/home/agent/workers/gh";
const EXECUTABLE = 0o755;
const LISTED_THREE = 3;

interface UnclassifiedFinding { unit: string; problem: string }
interface HostUnits {
  unclassifiedEntries(deps: { projectUnitsDir: string; units: { own: string[] } }): UnclassifiedFinding[];
}
const { unclassifiedEntries } = await import(pathToFileURL(toolPath("src/host-units.mjs")).href) as HostUnits;

const SERVICE = "a11ign-regression-board.service";
const TIMER = "a11ign-regression-board.timer";
const MODEL = "a11ign-weekly-review.service";
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

test("the service declares the workers account and has no [Install] section", () => {
  assert.deepEqual(accountAndInstallProblems(unitText(SERVICE)), []);
});

test("POSITIVE CONTROL: the same reading passes on the weekly review's service, which is right", () => {
  assert.deepEqual(accountAndInstallProblems(unitText(MODEL)), []);
});

test("NEGATIVE CONTROL: a copy of the new service with GH_CONFIG_DIR deleted FAILS the account reading", () => {
  const problems = accountAndInstallProblems(withoutLine(unitText(SERVICE), "Environment=GH_CONFIG_DIR"));
  assert.ok(problems.some((problem) => /GH_CONFIG_DIR is null/.test(problem)), `read: ${JSON.stringify(problems)}`);
  assert.equal(accountAndInstallProblems(`${unitText(SERVICE)}\n[Install]\nWantedBy=default.target\n`).length, 1);
});

test("the timer persists across a sleeping host and does not `Requires=` the service", () => {
  const timer = unitText(TIMER);
  assert.equal(setting(timer, "Persistent"), "true");
  assert.match(setting(timer, "OnCalendar") ?? "", /\*:\d+\/\d+/, "an interval, not a daily hour: a Status should not wait a day");
  assert.equal(setting(timer, "Requires"), null);
  assert.equal(setting(unitText("a11ign-lab-watch.timer"), "Persistent"), "true", "POSITIVE CONTROL: Persistent is read off a timer that has it");
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

test("the unit runs the live tool, which has `--board=`, and declares the host and the launch reason it needs", () => {
  const text = unitText(SERVICE);
  const exec = setting(text, "ExecStart") ?? "";
  assert.match(exec, /\/usr\/bin\/node %h\/repos\/agent-org\/src\/bin\.mjs row-file --board=/, "the pinned install's `agent-org` refuses --board (read 2026-10-03)");
  assert.doesNotMatch(exec, /pnpm exec agent-org/);
  assert.match(setting(text, "Environment=AGENT_ORG_HOST") ?? "", /\.agent-org\/host\.json$/);
  const reason = setting(text, "Environment=\"A11Y_POLICY_LAUNCH_REASON");
  assert.ok(reason !== null && reason.length > 1, "without it `row-file` refuses the host's primary checkout and the unit fails every fire");
});

/**
 * The script inside `sh -c '...'`, with systemd's `$$` and `%h` resolved the way systemd resolves them, and the host's
 * `/usr/bin/node` swapped for the interpreter running this test: a CI runner keeps node elsewhere, and the unit's own path
 * is pinned by the text reading above, so the behaviour readings need only a node that exists.
 */
function scriptFor(text: string, home: string): string {
  const exec = setting(text, "ExecStart") ?? "";
  const quoted = /^\/usr\/bin\/sh -c '(.*)'$/.exec(exec)?.[1];
  assert.ok(quoted, `ExecStart is not a single-quoted sh -c: ${exec}`);
  return quoted.replaceAll("$$", "$").replaceAll("%h", home).replaceAll("/usr/bin/node", process.execPath);
}

interface Sweep { status: number | null; boarded: string[]; stderr: string }

/** Runs the real ExecStart script against a fake `gh` (listing `listed`, or failing) and a fake tool that refuses `refused`. */
function runSweep(text: string, opts: { listed: string[]; listFails?: boolean; refused?: string[] }): Sweep {
  const home = mkdtempSync(join(tmpdir(), "regression-board-"));
  try {
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "repos/agent-org/src"), { recursive: true });
    const boardedLog = join(home, "boarded.log");
    writeFileSync(join(home, "bin/gh"), `#!/bin/sh\n${opts.listFails ? "exit 1" : opts.listed.map((n) => `echo ${n}`).join("\n") || "true"}\n`);
    chmodSync(join(home, "bin/gh"), EXECUTABLE);
    writeFileSync(join(home, "repos/agent-org/src/bin.mjs"),
      `import { appendFileSync } from "node:fs";\nconst n = process.argv.find((a) => a.startsWith("--board="))?.slice(8) ?? "";\n`
      + `appendFileSync(${JSON.stringify(boardedLog)}, process.argv.slice(2).join(" ") + "\\n");\n`
      + `process.exit(${JSON.stringify(opts.refused ?? [])}.includes(n) ? 1 : 0);\n`);
    const run = spawnSync("/usr/bin/sh", ["-c", scriptFor(text, home)], { env: { PATH: `${join(home, "bin")}:/usr/bin:/bin` }, encoding: "utf8" });
    const boarded = (() => { try { return readFileSync(boardedLog, "utf8").trim().split("\n").filter(Boolean); } catch { return []; } })();
    return { status: run.status, boarded, stderr: run.stderr };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("BEHAVIOUR: every listed row is boarded as lane:any through `row-file --board=`, and a clean sweep exits 0", () => {
  const sweep = runSweep(unitText(SERVICE), { listed: ["3287", "3400"] });
  assert.deepEqual(sweep.boarded, ["row-file --board=3287 --lane=any", "row-file --board=3400 --lane=any"]);
  assert.equal(sweep.status, 0);
});

test("BEHAVIOUR: one row's refusal does not stop the rest, and it turns the unit red", () => {
  const sweep = runSweep(unitText(SERVICE), { listed: ["3287", "3400", "3401"], refused: ["3287"] });
  assert.equal(sweep.boarded.length, LISTED_THREE, "the rows after the refused one were still attempted");
  assert.equal(sweep.status, 1);
});

test("BEHAVIOUR: nothing listed is a clean no-op, and a FAILED listing is red rather than an empty sweep", () => {
  const none = runSweep(unitText(SERVICE), { listed: [] });
  assert.deepEqual([none.status, none.boarded], [0, []]);
  const failed = runSweep(unitText(SERVICE), { listed: [], listFails: true });
  assert.equal(failed.status, 1, "a listing that failed must not read as 'no regression rows'");
});

test("BEHAVIOUR: the listing asks for open `regression` rows only, so no other row is ever handed to the tool", () => {
  assert.match(scriptFor(unitText(SERVICE), "/h"), /gh issue list [^;]*--label regression --state open/);
});

test("NEGATIVE CONTROL: a script that swallows the listing failure is caught by the behaviour reading", () => {
  const swallowed = unitText(SERVICE).replace('" || exit 1;', '" || true;');
  assert.notEqual(swallowed, unitText(SERVICE), "the mutation applied");
  assert.equal(runSweep(swallowed, { listed: [], listFails: true }).status, 0, "the mutant exits 0 on a failed listing, which is what the real unit's test refuses");
});
