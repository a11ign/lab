/**
 * #2180 — `npm run lab:clear-failed` clears ONE named failed job unit, probes before it resets, and
 * REFUSES a sweep.
 *
 * Two lab units (`a11y-job-everything`, `a11y-job-release-gate`) sat `failed` for eleven and three days
 * because no route cleared a failed hand-dispatch: `run-job.yml` reaps only on the next START, `lab:stop`
 * is for a running unit, and #2061's clear was tied to a timer removal. The route exists now; this pins
 * what makes it safe to run.
 *
 * WHAT IT PINS, BY RUNNING THE REAL PLAYBOOK rather than reading it as text, because every claim here is
 * about what reaches `systemctl` and a regex over the YAML matches exactly as well when the guard is dead:
 *   1. no `job`, a glob, a suffixed unit, a list and a name the catalogue lacks are each REFUSED and
 *      `systemctl` is never called at all -- "without touching systemd";
 *   2. a named unit is PROBED (`is-failed`) before it is reset, and only ever that one unit;
 *   3. the reset is gated on the probe's STDOUT reading `failed`: a running or already-absent unit is not
 *      reset.
 * The mutation half proves the assertions bite: the same playbook with the stdout gate removed is run
 * against a unit that is NOT failed, and must be caught resetting it.
 *
 * `systemctl` is a fake on `PATH` that logs each call and answers `is-failed` from a state file; the lab
 * is an inventory host with `ansible_connection=local`. No root, no lab, no fleet. Like
 * `lab-job-lock-two-rows.test.ts` it SKIPS, honestly, where `ansible-playbook` is not on `PATH` -- CI's
 * `ts` job does not install ansible-core -- and the text checks below run everywhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = resolve(import.meta.dirname, "../../../..");
const PLAYBOOK = resolve(REPO, "packages/control/ansible/lab-clear-failed.yml");
const SOURCE = readFileSync(PLAYBOOK, "utf8");
const HAS_ANSIBLE = spawnSync("ansible-playbook", ["--version"]).status === 0;
const NO_ANSIBLE = "ansible-playbook is not on PATH -- an honest skip, not a pass (see the header)";

/** Answers `is-failed` from `$FAKE_STATE/<unit>` (default `inactive`), and logs every call it receives. */
const FAKE_SYSTEMCTL = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_STATE/calls.log"
cmd="$1"; shift
case "$cmd" in
  is-failed)
    unit="\${@: -1}"
    state=$(cat "$FAKE_STATE/$unit" 2>/dev/null || echo inactive)
    echo "$state"
    [ "$state" = "failed" ] && exit 0 || exit 1 ;;
  reset-failed)
    unit="\${@: -1}"
    echo inactive > "$FAKE_STATE/$unit" ;;
  show) echo "Result=exit-code" ;;
esac
exit 0
`;

type Run = { status: number | null, out: string, calls: string[], state: (unit: string) => string };

/** The fake's per-unit state files, told apart from its own scaffolding. */
const SCAFFOLDING = new Set(["systemctl", "inventory.yml", "ansible.cfg", "calls.log"]);

/** Runs the playbook (or a mutated copy of it) with `systemctl` faked and the given units' states set. */
function run(args: string[], units: Record<string, string> = {}, playbook = PLAYBOOK): Run {
  const tmp = mkdtempSync(join(tmpdir(), "lab-clear-failed-"));
  try {
    writeFileSync(join(tmp, "systemctl"), FAKE_SYSTEMCTL);
    chmodSync(join(tmp, "systemctl"), 0o755);
    for (const [unit, state] of Object.entries(units)) writeFileSync(join(tmp, unit), `${state}\n`);
    writeFileSync(join(tmp, "inventory.yml"), "a11y_lab:\n  hosts:\n    lab:\n");
    writeFileSync(join(tmp, "ansible.cfg"), "[defaults]\n");
    const result = spawnSync("ansible-playbook", [playbook, "-i", join(tmp, "inventory.yml"),
      "-e", "ansible_connection=local", "-e", "ansible_python_interpreter=auto_silent", ...args], {
      encoding: "utf8",
      // The fake leads PATH, so the play's `systemctl` is ours. `A11Y_PVE_KEY` satisfies the key guard.
      env: { ...process.env, PATH: `${tmp}:${process.env.PATH}`, FAKE_STATE: tmp, A11Y_PVE_KEY: "unused",
        ANSIBLE_CONFIG: join(tmp, "ansible.cfg"), ANSIBLE_LOCALHOST_WARNING: "False" },
    });
    const log = join(tmp, "calls.log");
    // READ BEFORE `finally` removes the directory: a lazy reader would see every unit as absent.
    const states = Object.fromEntries(readdirSync(tmp).filter((f) => !SCAFFOLDING.has(f))
      .map((f) => [f, readFileSync(join(tmp, f), "utf8").trim()]));
    return {
      status: result.status,
      out: `${result.stdout}${result.stderr}`,
      calls: existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [],
      state: (unit) => states[unit] ?? "absent",
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const resets = (r: Run) => r.calls.filter((c) => c.startsWith("reset-failed"));

test("#2180: the route is wired to a script and its README line, and the playbook parses", () => {
  const scripts = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8")).scripts;
  assert.match(scripts["lab:clear-failed"], /ansible-playbook packages\/control\/ansible\/lab-clear-failed\.yml/);
  assert.match(readFileSync(resolve(REPO, "packages/control/ansible/README.md"), "utf8"), /lab:clear-failed/);
  const plays = parseYaml(SOURCE) as Array<{ hosts: string }>;
  assert.deepEqual(plays.map((p) => p.hosts), ["localhost", "a11y_lab"]);
});

// POSITIVE CONTROL FOR EVERY EMPTINESS BELOW: the "named failed unit" test proves a `systemctl` call CAN be
// logged, so "no calls" in the refusal cases means the refusal held rather than the fake logging nothing.
const NAME_ONE = /Pass -e job=<name>, ONE name/;
const REFUSED: Array<[string, string[], RegExp]> = [
  ["no job at all (a sweep)", [], NAME_ONE],
  ["a glob", ["-e", "job=*"], NAME_ONE],
  ["a full unit name", ["-e", "job=a11y-job-everything.service"], NAME_ONE],
  ["a list of two", ["-e", '{"job":["everything","release-gate"]}'], NAME_ONE],
  ["a unit outside a11y-job-*", ["-e", "job=a11y-corpus-backup"], /is not a job this lab has/],
  ["a name the catalogue lacks", ["-e", "job=evrything"], /is not a job this lab has/],
];

for (const [label, args, refusal] of REFUSED) {
  test(`#2180: ${label} is refused and systemctl is never called`, { skip: HAS_ANSIBLE ? false : NO_ANSIBLE }, () => {
    const r = run(args, { "a11y-job-everything": "failed", "a11y-job-release-gate": "failed" });
    assert.notEqual(r.status, 0, `expected a refusal, got exit 0:\n${r.out}`);
    // THE PLAYBOOK'S OWN SENTENCE, not merely a non-zero exit: an ansible that crashed before it ran would
    // also exit non-zero and log no calls, and "refused" would pass having tested nothing.
    assert.match(r.out, refusal, `the refusal must come from the playbook's own guard:\n${r.out}`);
    assert.deepEqual(r.calls, [], `a refused name must not reach systemctl:\n${r.calls.join("\n")}`);
    assert.equal(r.state("a11y-job-everything"), "failed", "the unit must be untouched");
    assert.equal(r.state("a11y-job-release-gate"), "failed", "the unit must be untouched");
  });
}

test("#2180: a named failed unit is probed FIRST, then reset, and only that unit",
  { skip: HAS_ANSIBLE ? false : NO_ANSIBLE }, () => {
    const r = run(["-e", "job=everything"],
      { "a11y-job-everything": "failed", "a11y-job-release-gate": "failed", "a11y-job-acceptance": "failed" });
    assert.equal(r.status, 0, r.out);
    const probe = r.calls.findIndex((c) => c === "is-failed a11y-job-everything");
    const reset = r.calls.findIndex((c) => c === "reset-failed a11y-job-everything");
    assert.ok(probe >= 0, `no is-failed probe of the named unit:\n${r.calls.join("\n")}`);
    assert.ok(reset > probe, `the reset must FOLLOW the probe:\n${r.calls.join("\n")}`);
    assert.deepEqual(resets(r), ["reset-failed a11y-job-everything"], "exactly one unit is reset");
    assert.equal(r.state("a11y-job-everything"), "inactive");
    // The other failed lines carry owners and clocks (#1926, #2160): the route must leave them as read.
    assert.equal(r.state("a11y-job-release-gate"), "failed");
    assert.equal(r.state("a11y-job-acceptance"), "failed");
  });

test("#2180: a unit that is not failed is not reset, and an absent one is the success case",
  { skip: HAS_ANSIBLE ? false : NO_ANSIBLE }, () => {
    for (const state of ["active", "inactive"]) {
      const r = run(["-e", "job=everything"], { "a11y-job-everything": state });
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(resets(r), [], `a unit reading '${state}' must not be reset`);
    }
    const absent = run(["-e", "job=everything"]);
    assert.equal(absent.status, 0, absent.out);
    assert.deepEqual(resets(absent), []);
  });

test("#2180 mutation: dropping the stdout gate resets a unit that is not failed, and this suite sees it",
  { skip: HAS_ANSIBLE ? false : NO_ANSIBLE }, () => {
    const gate = /[ ]+when: \(lab_clear_state\.stdout \| trim\) == "failed"\n(?=\s+changed_when: true)/;
    assert.match(SOURCE, gate, "the mutation must find the gate it removes, or it proves nothing");
    // Written NEXT TO the real playbook so its `vars/` and `tasks/` resolve, and removed in `finally`.
    const mutant = join(resolve(REPO, "packages/control/ansible"), `.mutant-${process.pid}.yml`);
    writeFileSync(mutant, SOURCE.replace(gate, ""));
    try {
      const r = run(["-e", "job=everything"], { "a11y-job-everything": "active" }, mutant);
      assert.deepEqual(resets(r), ["reset-failed a11y-job-everything"],
        `the ungated mutant should reset a RUNNING unit, which is the defect the gate prevents:\n${r.out}`);
    } finally {
      rmSync(mutant, { force: true });
    }
  });
