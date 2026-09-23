/**
 * #2060 — RETIRING A TIMER IS A CONTRACT BETWEEN SIX TASKS, AND NOTHING IN THIS REPOSITORY READ IT.
 *
 * #2059 stopped `a11y-corpus-backup.timer` firing nightly into a destination the org had decided against.
 * The change is correct and was applied to the lab; what it shipped WITHOUT is any check that it stays
 * correct. reviewer-2's verdict on `78983ba2` and again on `d6dad494` is the measurement: the four-file
 * code Acceptance proves the YAML parses and that unrelated inventory/corpus prose guards pass, and
 * **changing `enabled: false` to `enabled: true` on the stop-and-disable task left all 22 tests green**
 * while turning the retirement task into one that RE-ENABLES the timer it exists to remove.
 *
 * That mutant is the first positive control below.
 *
 * ## `when:` PRESENT is not `when:` MEANINGFUL — reviewer-2's third refusal, on `5781567e`
 *
 * The first version of this file asked only whether the stop-and-disable carried a `when` at all. It does,
 * so the clause never fired, and **`when: corpus_backup_timer_file.stat.exists` -> `when: false` left all
 * 37 tests green** — a retirement skipped on every host, an enabled timer still firing, and a guard
 * reporting success. That is the SAME defect one level up: a check that reads the shape of a field instead
 * of what the field says, which is what this file exists to refuse in the playbook.
 *
 * So every gate here is now read for what it TESTS, not for whether it is written:
 *
 *   - the stop's `when` must positively read the `stat` register of the retired timer's own unit file
 *     (`unit-file-probe` / `absent-unit-guard-tests-the-file`), so a constant or an inversion is refused;
 *   - the reset's `when` must read the is-failed probe's `stdout` AND compare it to `"failed"`
 *     (`reset-failed-gated`), so a gate gated on the probe having merely RUN is refused;
 *   - the assert's surviving-timer clause must be a POSITIVE membership test (`assert-snapshot-present`),
 *     so an assert demanding the snapshot timer be absent too is refused.
 *
 * All three had the same weakness and only the first was measured; fixing one and leaving its siblings
 * would have been answering the mutant rather than the finding.
 *
 * ## Why the contract is between tasks, rather than inside any one of them
 *
 * Every trap `corpus-schedule.yml`'s own header names is a relationship a single task cannot state:
 *
 *   1. **Stop-and-disable must run BEFORE the files are removed.** `systemctl disable` needs the unit file
 *      on disk. Reversing the two leaves an ENABLED timer with no file — which `systemctl list-timers`
 *      honours until the next daemon-reload, and which every task in the playbook reports as success.
 *   2. **The removal must reach BOTH unit files, and the install loop must not put either back.** Ansible
 *      does not remove what it stops managing, so dropping the names from `corpus_timer_units` and calling
 *      that a retirement leaves the timer running on every lab that already has it.
 *   3. **`reset-failed` is load-bearing and separate.** `a11y-job-corpus-backup` is transient and
 *      `--remain-after-exit`: it sits in `failed` from the last 05:00Z firing with no timer anywhere near
 *      it, so `npm run lab:failed-units` names it forever unless something clears it. The row's own second
 *      Mutation is exactly this — *stop the timer, skip the `reset-failed`* — and the acceptance it
 *      predicts must stay red is a LAB read, which no runner can take. This is where that mutant is caught
 *      on a runner instead.
 *   4. **The closing assert must read BOTH directions.** A removal checked only by the task that performed
 *      it is checked by the thing that performed it; the negative clause is what catches trap 2.
 *   5. **A registered read must still read under `--check`.** `ansible.builtin.command` is SKIPPED in check
 *      mode, so a preview left `corpus_timers_listed` undefined, failed the assertion against an empty
 *      string, and reported a healthy schedule as broken — measured on the lab 2026-09-23T05:21Z, and the
 *      whole reason `d6dad494` exists. It was invisible while the assertion had one clause an empty string
 *      failed the same way, which is the shape of a guard that cannot distinguish its own failure modes.
 *
 * ## Why this reads the PARSED playbook, and matches on structure rather than task names
 *
 * A `name:` is prose. Rewording "Stop and disable the retired backup timer" breaks nothing on a lab and
 * would break a check keyed to it, so tasks are found here by what they DO — module, arguments, and the
 * unit each one names once its `{{ }}` is expanded against the play's own `vars`. That expansion is the
 * point rather than a convenience: `corpus-schedule.yml` deliberately writes each unit name ONCE and
 * reaches it through a variable everywhere else, so a check reading the literal text would miss a rename
 * that reached every task, and a check reading only the variable would miss a task that hard-coded a
 * different unit. Both are answered by resolving the name the way Ansible will.
 *
 * ## The population, and where its controls live
 *
 * `retirementFindings()` returns `[]` on the shipped playbook, and an empty-findings assertion passes
 * perfectly against a checker that examines nothing. So every clause it can report is exercised by a
 * MUTANT below, applied to a parsed copy of the real file — not to a fixture, which would let the checker
 * and the playbook drift apart while both stayed green.
 *
 * **The coverage pin is RUNTIME EVIDENCE, not a scan of this file's own text.** `provenBy()` records the
 * clause each control actually made fire, and the last test compares that set against `CLAUSES`. A check
 * that read its own source for `clause: "…"` would be a textual proxy for the property it claims — the
 * defect `corpus-backup.test.ts`'s header records three rounds of, one directory over.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = resolve(import.meta.dirname, "../../../..");
const PLAYBOOK = resolve(REPO, "packages/control/ansible/corpus-schedule.yml");

/** The retired pair, the transient unit that outlives them, and the timer that must SURVIVE the retirement. */
const BACKUP_TIMER = "a11y-corpus-backup.timer";
const BACKUP_SERVICE = "a11y-corpus-backup.service";
const BACKUP_JOB_UNIT = "a11y-job-corpus-backup";
const SNAPSHOT_TIMER = "a11y-corpus-snapshot.timer";

/** A `{{ x }}` may name a var whose own value is a `{{ y }}`; this bounds that walk rather than trusting it. */
const MAX_EXPANSIONS = 8;

/**
 * Every finding this checker can report. Named here so a clause cannot be added to the checker without
 * appearing in the coverage pin at the foot of the file, which is what makes "each one has a control" a
 * checkable claim rather than a habit.
 */
const CLAUSES = {
  stopAndDisable: "stop-and-disable",
  disable: "disable",
  stop: "stop",
  absentUnitGuard: "absent-unit-guard",
  unitFileProbe: "unit-file-probe",
  absentUnitGuardTests: "absent-unit-guard-tests-the-file",
  order: "order",
  removeUnitFiles: "remove-unit-files",
  notReinstalled: "not-reinstalled",
  resetFailed: "reset-failed",
  failedStateProbe: "failed-state-probe",
  resetFailedGated: "reset-failed-gated",
  checkModeRead: "check-mode-read",
  assertSnapshotPresent: "assert-snapshot-present",
  assertBackupAbsent: "assert-backup-absent",
} as const;

type Task = Record<string, unknown>;
type Vars = Record<string, unknown>;
/** One task, keeping the index because ORDER is half of what this file checks. */
type Step = { index: number; module: string; args: Task; task: Task };
type Finding = { clause: string; detail: string };

const asRecord = (value: unknown): Task =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Task) : {};
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asText = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Resolve a value the way Ansible will: a whole-value `{{ name }}` becomes that var's value (which may be
 * a LIST — `loop: "{{ corpus_backup_units }}"` is the shape this exists for). An interpolation inside a
 * larger string (`"/etc/systemd/system/{{ item }}"`) is left alone: `item` is loop-local and has no value
 * here, and a half-expanded path would read as a unit name it is not.
 */
function expand(value: unknown, vars: Vars, depth: number): unknown {
  if (Array.isArray(value)) return value.map((entry) => expand(entry, vars, depth));
  const whole = asText(value).match(/^\{\{\s*([A-Za-z_]\w*)\s*\}\}$/);
  if (!whole) return value;
  const named = vars[whole[1]];
  if (named === undefined || depth >= MAX_EXPANSIONS) return value;
  return expand(named, vars, depth + 1);
}

/** Every unit name a value resolves to, flattened — one name, a list of them, or nothing. */
function unitNames(value: unknown, vars: Vars): string[] {
  const resolved = expand(value, vars, 0);
  return (Array.isArray(resolved) ? resolved : [resolved]).map(asText).filter(Boolean);
}

/** The play that runs on the lab. The first play is the localhost inventory guard and owns none of this. */
function labPlay(source: string): { play: Task; vars: Vars; steps: Step[] } {
  const play = asRecord(asList(parseYaml(source)).find((entry) => asRecord(entry).hosts === "a11y_lab"));
  const vars = asRecord(play.vars);
  const steps = asList(play.tasks).map((entry, index) => {
    const task = asRecord(entry);
    const module = Object.keys(task).find((key) => key.startsWith("ansible.builtin.")) ?? "";
    return { index, module, args: asRecord(task[module]), task };
  });
  return { play, vars, steps };
}

/** Identifiers whose value IS this unit, so a Jinja expression naming the var counts as naming the unit. */
function aliasesFor(unit: string, vars: Vars): string[] {
  return [unit, ...Object.keys(vars).filter((key) => unitNames(vars[key], vars).includes(unit))];
}

/** Does a Jinja expression name one of these identifiers as a WHOLE word? `.` is a separator, not a letter. */
const mentions = (expression: string, names: string[]): boolean =>
  names.some((name) => new RegExp(`(^|[^\\w.-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`)
    .test(expression));

/**
 * A PATH with its `{{ var }}` occurrences resolved in place, which `expand` deliberately will not do: a
 * unit file is named inside a larger string (`/etc/systemd/system/{{ corpus_backup_timer }}`), so the only
 * way to know which unit a `stat` asks about is to substitute. `{{ item }}` has no value here and survives
 * as itself, which is what keeps a loop's path from reading as a unit name it is not.
 */
function interpolate(value: unknown, vars: Vars): string {
  let text = asText(value);
  for (let depth = 0; depth < MAX_EXPANSIONS && text.includes("{{"); depth += 1) {
    const next = text.replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g, (whole, name: string) =>
      typeof vars[name] === "string" ? (vars[name] as string) : whole);
    if (next === text) break;
    text = next;
  }
  return text;
}

/** A `when:` as Ansible evaluates it: one expression, or a LIST of expressions it ANDs together. */
const whenText = (value: unknown): string =>
  Array.isArray(value) ? value.map(asText).join(" and ") : asText(value);

/** Does this expression read `<register>.<field>` as a whole term? `.` separates, so it is not a word char. */
const reads = (expression: string, register: string, field: string): boolean =>
  new RegExp(`(^|[^\\w.-])${register}\\.${field}([^\\w-]|$)`).test(expression);

/**
 * POSITIVELY. `when: false` reads nothing and `when: not <probe>.stat.exists` reads it backwards; both skip
 * the retirement on every host with every task reporting success, which is the mutation reviewer-2 measured
 * surviving. A `not` anywhere in the expression is refused rather than parsed: a guard that needs one is a
 * guard worth a second look, and a false finding here is one line to exempt where a false pass is a timer
 * still firing.
 */
const testsPositively = (expression: string, register: string, field: string): boolean =>
  reads(expression, register, field) && !/(^|\W)not(\W|$)/.test(expression);

/** The argv of an `ansible.builtin.command`, which this playbook always writes as a list rather than a string. */
const argvOf = (step: Step, vars: Vars): string[] => unitNames(step.args.argv, vars);

/** The `systemctl <verb> a11y-job-corpus-backup` task, found by what it runs rather than by its name. */
const commandDoing = (steps: Step[], verb: string, vars: Vars): Step | undefined =>
  steps.find((step) => step.module === "ansible.builtin.command"
    && argvOf(step, vars).includes(verb) && argvOf(step, vars).includes(BACKUP_JOB_UNIT));

/** The `ansible.builtin.systemd` task that acts on the retired timer — the subject of traps 1 and 2. */
const stopStep = (steps: Step[], vars: Vars): Step | undefined =>
  steps.find((step) => step.module === "ansible.builtin.systemd"
    && unitNames(step.args.name, vars).includes(BACKUP_TIMER));

/** The `ansible.builtin.stat` that asks whether the retired timer's unit file is still on this lab. */
const unitFileProbeStep = (steps: Step[], vars: Vars): Step | undefined =>
  steps.find((step) => step.module === "ansible.builtin.stat"
    && interpolate(step.args.path, vars).endsWith(`/${BACKUP_TIMER}`));

/** The `ansible.builtin.file` task that deletes the retired unit files. */
const removalStep = (steps: Step[], vars: Vars): Step | undefined =>
  steps.find((step) => step.module === "ansible.builtin.file" && step.args.state === "absent"
    && unitNames(step.task.loop ?? step.args.path, vars).includes(BACKUP_TIMER));

/**
 * The guard on the stop, read for what it TESTS. `ansible.builtin.systemd` errors on a unit it cannot
 * find, so the stop must be guarded -- but a guard is not a `when` key, it is a `when` that asks whether
 * THIS unit file is on THIS lab. reviewer-2's refusal on `5781567e` is the measurement: `when: false`
 * satisfied a presence check, skipped the retirement on every host, and left the timer enabled and firing.
 */
function guardFindings(stop: Step, steps: Step[], vars: Vars): Finding[] {
  if (stop.task.when === undefined) {
    return [{ clause: CLAUSES.absentUnitGuard,
      detail: "ansible.builtin.systemd ERRORS on a unit it cannot find, so the stop needs a `when` -- "
        + "without one, a fresh lab and every second run fail on the absence that means the work is done" }];
  }
  const probe = unitFileProbeStep(steps, vars);
  const register = asText(probe?.task.register);
  if (!register) {
    return [{ clause: CLAUSES.unitFileProbe,
      detail: `no ansible.builtin.stat registers a read of /etc/systemd/system/${BACKUP_TIMER}, so the `
        + "guard on the stop has nothing to ask whether this lab has the unit -- and a guard that cannot "
        + "be answered from the host is a constant wearing a condition's clothes" }];
  }
  if (!testsPositively(whenText(stop.task.when), register, "stat.exists")) {
    return [{ clause: CLAUSES.absentUnitGuardTests,
      detail: `the stop's \`when\` (${JSON.stringify(stop.task.when)}) does not positively read `
        + `\`${register}.stat.exists\`, so it is a constant, an inversion or an unrelated condition. A `
        + "guard that is never true SKIPS the whole retirement on every lab that has the timer, leaves it "
        + "enabled and firing, and reports success from every task in this play" }];
  }
  return [];
}

/** Trap 1: the stop-and-disable, what it must say, and that it still has a file to disable when it runs. */
function stopAndDisableFindings(steps: Step[], vars: Vars): Finding[] {
  const stop = stopStep(steps, vars);
  if (!stop) {
    return [{ clause: CLAUSES.stopAndDisable,
      detail: `no ansible.builtin.systemd task names ${BACKUP_TIMER}, so a lab that has the timer keeps it` }];
  }
  const findings: Finding[] = [];
  if (stop.args.enabled !== false) {
    findings.push({ clause: CLAUSES.disable,
      detail: `the task naming ${BACKUP_TIMER} must set \`enabled: false\`; it sets `
        + `${JSON.stringify(stop.args.enabled)}` });
  }
  if (stop.args.state !== "stopped") {
    findings.push({ clause: CLAUSES.stop,
      detail: `the task naming ${BACKUP_TIMER} must set \`state: stopped\`; it sets `
        + `${JSON.stringify(stop.args.state)}` });
  }
  findings.push(...guardFindings(stop, steps, vars));
  const removal = removalStep(steps, vars);
  if (removal && stop.index > removal.index) {
    findings.push({ clause: CLAUSES.order,
      detail: "stop-and-disable runs AFTER the unit files are removed; `systemctl disable` needs the file "
        + "on disk, so this leaves an enabled timer with no file and every task reporting success" });
  }
  return findings;
}

/** Trap 2, both halves: both files go, and nothing in the same play puts either back. */
function removalFindings(steps: Step[], vars: Vars): Finding[] {
  const removal = removalStep(steps, vars);
  if (!removal) {
    return [{ clause: CLAUSES.removeUnitFiles,
      detail: `no ansible.builtin.file task removes ${BACKUP_TIMER}` }];
  }
  const removed = unitNames(removal.task.loop ?? removal.args.path, vars);
  const left = [BACKUP_TIMER, BACKUP_SERVICE].filter((unit) => !removed.includes(unit));
  const findings: Finding[] = left.length
    ? [{ clause: CLAUSES.removeUnitFiles, detail: `the removal leaves ${left.join(", ")} on disk` }]
    : [];
  const reinstated = [...new Set(steps.flatMap((step) => installedBy(step, vars)))]
    .filter((unit) => unit === BACKUP_TIMER || unit === BACKUP_SERVICE);
  if (reinstated.length) {
    findings.push({ clause: CLAUSES.notReinstalled,
      detail: `${reinstated.join(", ")} is still copied or enabled by this play, so the retirement removes `
        + "what the same run puts back" });
  }
  return findings;
}

/** The units a step installs: a `copy` into /etc/systemd/system, or a `systemd` task that ENABLES one. */
function installedBy(step: Step, vars: Vars): string[] {
  const enabling = step.module === "ansible.builtin.systemd" && step.args.enabled === true;
  const copying = step.module === "ansible.builtin.copy" && asText(step.args.dest).includes("systemd/system");
  if (!enabling && !copying) return [];
  return unitNames(step.task.loop ?? step.args.name ?? step.args.src, vars);
}

/** Trap 3: the failed state outlives the timer, and the reset is ASKED before it acts rather than forced. */
function resetFailedFindings(steps: Step[], vars: Vars): Finding[] {
  const reset = commandDoing(steps, "reset-failed", vars);
  if (!reset) {
    return [{ clause: CLAUSES.resetFailed,
      detail: `nothing runs \`systemctl reset-failed ${BACKUP_JOB_UNIT}\`; the unit is transient and `
        + "`--remain-after-exit`, so removing the timer leaves `lab:failed-units` naming it forever" }];
  }
  const probe = commandDoing(steps, "is-failed", vars);
  if (!probe) {
    return [{ clause: CLAUSES.failedStateProbe,
      detail: `nothing runs \`systemctl is-failed ${BACKUP_JOB_UNIT}\`, so the reset cannot be gated on the `
        + "state it exists to clear and must instead be forced with `failed_when: false`" }];
  }
  // READ FOR WHAT IT TESTS, for the same reason the stop's guard is: `when: <register> is defined` MENTIONS
  // the probe and gates on nothing, because a registered command is always defined once it has run. The
  // gate has to read what the probe SAID -- its stdout, against the one word that means there is something
  // to clear.
  const register = asText(probe.task.register);
  const when = whenText(reset.task.when);
  if (!register || !reads(when, register, "stdout") || !/["']failed["']/.test(when)) {
    return [{ clause: CLAUSES.resetFailedGated,
      detail: `the reset's \`when\` (${JSON.stringify(reset.task.when)}) does not compare the is-failed `
        + `probe's \`${register || "<unregistered>"}.stdout\` against "failed", so it runs whenever the probe `
        + "ran, which is always -- a task that can neither fail nor honestly report `changed` breaks the "
        + "playbook's own idempotence claim" }];
  }
  return [];
}

/**
 * Trap 5. A registered, `changed_when: false` command is a pure READ whose value a later task consumes;
 * `--check` skips it, leaving the register undefined and the consumer unevaluable. The reset task is
 * deliberately NOT in this population: it changes state and must stay skipped in a preview.
 */
function checkModeFindings(steps: Step[]): Finding[] {
  return steps
    .filter((step) => step.module === "ansible.builtin.command"
      && step.task.changed_when === false && step.task.register !== undefined
      && step.task.check_mode !== false)
    .map((step) => ({ clause: CLAUSES.checkModeRead,
      detail: `\`${asText(step.task.register)}\` is a registered read with no \`check_mode: false\`, so a `
        + "--check run skips it and whatever reads it fails against an empty string (#2059, measured on "
        + "the lab 2026-09-23T05:21Z)" }));
}

/** Trap 4: the closing assert reads both directions, so the removal is not checked by its own task. */
function assertionFindings(steps: Step[], vars: Vars): Finding[] {
  const closing = steps.find((step) => step.module === "ansible.builtin.assert");
  if (!closing) {
    return [{ clause: CLAUSES.assertBackupAbsent, detail: "the play asserts nothing at all" }];
  }
  const clauses = asList(closing.args.that).map(asText);
  // PRESENT means a POSITIVE membership test. `'…snapshot.timer' not in …` names the surviving timer just
  // as loudly and asserts the opposite of what this play is for -- the same read-the-shape-not-the-meaning
  // weakness as the stop's guard, and it has to be refused in the same breath rather than after someone
  // measures it too.
  const asserts = (unit: string, sense: "in" | "not in") => clauses.some((clause) =>
    mentions(clause, aliasesFor(unit, vars)) && clause.includes(" in ")
      && clause.includes(" not in ") === (sense === "not in"));
  const findings: Finding[] = [];
  if (!asserts(SNAPSHOT_TIMER, "in")) {
    findings.push({ clause: CLAUSES.assertSnapshotPresent,
      detail: `no assert clause requires ${SNAPSHOT_TIMER} to be PRESENT in the read-back; this retirement `
        + "stops one timer of the pair, and nothing would notice if it took the surviving one with it" });
  }
  if (!asserts(BACKUP_TIMER, "not in")) {
    findings.push({ clause: CLAUSES.assertBackupAbsent,
      detail: `no assert clause requires ${BACKUP_TIMER} to be ABSENT from the read-back; the removal is `
        + "then checked only by the task that performed it" });
  }
  return findings;
}

/** Everything `corpus-schedule.yml` must still be true of, in the order the traps appear in its own header. */
function retirementFindings(source: string): Finding[] {
  const { vars, steps } = labPlay(source);
  return [
    ...stopAndDisableFindings(steps, vars),
    ...removalFindings(steps, vars),
    ...resetFailedFindings(steps, vars),
    ...checkModeFindings(steps),
    ...assertionFindings(steps, vars),
  ];
}

const shipped = () => readFileSync(PLAYBOOK, "utf8");

test("#2060: the shipped corpus-schedule.yml satisfies every clause of the retirement contract", () => {
  const findings = retirementFindings(shipped());
  assert.deepEqual(findings, [],
    `packages/control/ansible/corpus-schedule.yml no longer retires ${BACKUP_TIMER} safely:\n  `
    + findings.map((finding) => `${finding.clause}: ${finding.detail}`).join("\n  ")
    + "\n\nEvery clause above has a named mutant in this file; if the playbook changed deliberately, the "
    + "mutant is where to change this check.");
});

/**
 * Each mutation is applied to the REAL playbook's parsed form, so the checker cannot pass by examining a
 * fixture the playbook has since moved away from. The result is re-serialised as JSON — which is YAML, and
 * which the checker parses exactly as it parses the file — so the subject stays a document rather than an
 * object this test handed itself.
 */
function mutate(edit: (play: Task, steps: Step[], vars: Vars) => void): string {
  const source = shipped();
  const document = asList(parseYaml(source));
  const { play, vars, steps } = labPlay(source);
  const live = asRecord(document.find((entry) => asRecord(entry).hosts === "a11y_lab"));
  assert.deepEqual(Object.keys(live), Object.keys(play), "the lab play moved between these two parses");
  edit(live, steps, vars);
  return JSON.stringify(document);
}

const taskAt = (play: Task, index: number): Task => asRecord(asList(play.tasks)[index]);
const moduleAt = (play: Task, step: Step): Task => asRecord(taskAt(play, step.index)[step.module]);

/** Clauses a control has been WATCHED making fire. The coverage pin at the foot of the file reads it. */
const proven = new Set<string>();

/** Assert a mutant produces its clause, and record that it did — the two halves of a positive control. */
function provenBy(mutated: string, clause: string, whatSurvived: string): void {
  const reported = retirementFindings(mutated).map((finding) => finding.clause);
  assert.ok(reported.includes(clause),
    `${whatSurvived}\n  expected the \`${clause}\` clause; the checker reported ${JSON.stringify(reported)}`);
  proven.add(clause);
}

test("#2060 CONTROL: re-enabling the timer is caught -- the mutation that survived the whole Acceptance", () => {
  // reviewer-2 on `78983ba2` and `d6dad494`: "changed subject `enabled: false` to `enabled: true` in
  // corpus-schedule.yml (confirmed applied, then restored from copy) -> 0 red".
  const mutated = mutate((play, steps, vars) => { moduleAt(play, stopStep(steps, vars)!).enabled = true; });
  provenBy(mutated, CLAUSES.disable, "a retirement task that RE-ENABLES the timer passed.");
});

test("#2060 CONTROL: leaving the timer running is caught", () => {
  const mutated = mutate((play, steps, vars) => { moduleAt(play, stopStep(steps, vars)!).state = "started"; });
  provenBy(mutated, CLAUSES.stop, "a retirement task that STARTS the timer passed.");
});

test("#2060 CONTROL: dropping the absent-unit guard is caught", () => {
  const mutated = mutate((play, steps, vars) => { delete taskAt(play, stopStep(steps, vars)!.index).when; });
  provenBy(mutated, CLAUSES.absentUnitGuard,
    "an unguarded systemd task passed, and it errors on every lab that never had the unit.");
});

test("#2060 CONTROL: a guard that is always false is caught -- reviewer-2's refusal on `5781567e`", () => {
  // "I applied `when: false` to the real playbook, confirmed the changed line on disk, and the full
  // five-file Acceptance still passed 5/37. That mutation skips stop/disable on every host, leaving an
  // existing enabled timer running while the new guard reports success."
  const mutated = mutate((play, steps, vars) => { taskAt(play, stopStep(steps, vars)!.index).when = false; });
  provenBy(mutated, CLAUSES.absentUnitGuardTests,
    "a retirement skipped on every host passed, and the timer it exists to stop keeps firing.");
});

test("#2060 CONTROL: a guard that is INVERTED is caught", () => {
  // The other half of the same hole: a `when` that reads the right register and acts on it backwards runs
  // the stop only where the unit is already gone -- an error where it is absent, silence where it is not.
  const mutated = mutate((play, steps, vars) => {
    const stop = stopStep(steps, vars)!;
    taskAt(play, stop.index).when = `not ${whenText(stop.task.when)}`;
  });
  provenBy(mutated, CLAUSES.absentUnitGuardTests, "a guard that fires only where there is nothing to do passed.");
});

test("#2060 CONTROL: dropping the unit-file probe leaves the guard unanswerable, and is caught", () => {
  const mutated = mutate((play, steps, vars) => {
    const probe = unitFileProbeStep(steps, vars)!;
    play.tasks = asList(play.tasks).filter((_, index) => index !== probe.index);
  });
  provenBy(mutated, CLAUSES.unitFileProbe,
    "the stop's `when` names a register nothing sets, so it is undefined on every host.");
});

test("#2060 CONTROL: removing the files BEFORE disabling them is caught", () => {
  // The order trap in full: `systemctl disable` needs the unit file, so this leaves an enabled timer with
  // no file -- and every task in the play still reports success.
  const mutated = mutate((play, steps, vars) => {
    const tasks = asList(play.tasks);
    const stop = stopStep(steps, vars)!.index;
    const removal = removalStep(steps, vars)!.index;
    [tasks[stop], tasks[removal]] = [tasks[removal], tasks[stop]];
  });
  provenBy(mutated, CLAUSES.order, "disable-after-delete passed.");
});

test("#2060 CONTROL: leaving the .service file behind is caught", () => {
  const mutated = mutate((play) => { asRecord(play.vars).corpus_backup_units = [BACKUP_TIMER]; });
  provenBy(mutated, CLAUSES.removeUnitFiles,
    `a removal that takes only ${BACKUP_TIMER} and leaves ${BACKUP_SERVICE} passed.`);
});

test("#2060 CONTROL: a retirement the same play re-installs is caught", () => {
  // Trap 2's other half, and the row's FIRST Mutation in structural form: a change that edits the prose
  // and puts the units back in the install loop is not a retirement.
  const mutated = mutate((play, _steps, vars) => {
    asRecord(play.vars).corpus_timer_units =
      [...unitNames(vars.corpus_timer_units, vars), BACKUP_TIMER, BACKUP_SERVICE];
  });
  provenBy(mutated, CLAUSES.notReinstalled,
    "the play copies back the units it removes, and the check passed.");
});

test("#2060 CONTROL: skipping the reset-failed is caught -- the row's own second Mutation", () => {
  // "Stop the timer, skip the `reset-failed`. ... `lab:failed-units` must STILL name
  // a11y-job-corpus-backup.service." That acceptance is a LAB read; this is where a runner catches it.
  const mutated = mutate((play, steps, vars) => {
    const reset = commandDoing(steps, "reset-failed", vars)!;
    play.tasks = asList(play.tasks).filter((_, index) => index !== reset.index);
  });
  provenBy(mutated, CLAUSES.resetFailed,
    "a retirement with no reset-failed passed, and it leaves the unit failed forever.");
});

test("#2060 CONTROL: an ungated reset-failed is caught", () => {
  const mutated = mutate((play, steps, vars) => {
    delete taskAt(play, commandDoing(steps, "reset-failed", vars)!.index).when;
  });
  provenBy(mutated, CLAUSES.resetFailedGated, "an unconditional reset-failed passed.");
});

test("#2060 CONTROL: a reset gated on the probe having RUN, rather than on what it said, is caught", () => {
  // The stop's guard was not the only gate read for its shape. `<register> is defined` MENTIONS the probe
  // and gates on nothing: a registered command is always defined once it has run, so this reset fires on
  // every lab, including the ones with nothing failed to clear.
  const mutated = mutate((play, steps, vars) => {
    const probe = commandDoing(steps, "is-failed", vars)!;
    taskAt(play, commandDoing(steps, "reset-failed", vars)!.index).when =
      `${asText(probe.task.register)} is defined`;
  });
  provenBy(mutated, CLAUSES.resetFailedGated, "an unconditional reset wearing the probe's name passed.");
});

test("#2060 CONTROL: dropping the is-failed probe is caught", () => {
  const mutated = mutate((play, steps, vars) => {
    const probe = commandDoing(steps, "is-failed", vars)!;
    play.tasks = asList(play.tasks).filter((_, index) => index !== probe.index);
  });
  provenBy(mutated, CLAUSES.failedStateProbe, "a reset with nothing to gate on passed.");
});

test("#2060 CONTROL: a registered read that --check would skip is caught", () => {
  // `d6dad494`'s whole content. Both probes only read, so both carry `check_mode: false`; dropping either
  // makes a preview of the removal fail against an empty string and report a healthy schedule as broken.
  const mutated = mutate((play, steps) => {
    const read = steps.find((step) => step.task.check_mode === false)!;
    delete taskAt(play, read.index).check_mode;
  });
  provenBy(mutated, CLAUSES.checkModeRead, "a registered read with no check_mode: false passed.");
});

test("#2060 CONTROL: an assert that checks only the installation is caught", () => {
  const mutated = mutate((play, steps) => {
    const closing = steps.find((step) => step.module === "ansible.builtin.assert")!;
    const args = moduleAt(play, closing);
    args.that = asList(args.that).map(asText).filter((clause) => !clause.includes("not in"));
  });
  provenBy(mutated, CLAUSES.assertBackupAbsent,
    "the closing assert no longer requires the retired timer to be gone, and the check passed.");
});

test("#2060 CONTROL: an assert that forgets the SURVIVING timer is caught", () => {
  const mutated = mutate((play, steps) => {
    const closing = steps.find((step) => step.module === "ansible.builtin.assert")!;
    const args = moduleAt(play, closing);
    args.that = asList(args.that).map(asText).filter((clause) => clause.includes("not in"));
  });
  provenBy(mutated, CLAUSES.assertSnapshotPresent,
    "the play could remove BOTH timers and still report success.");
});

test("#2060 CONTROL: an assert demanding the SURVIVING timer be gone too is caught", () => {
  // Third sibling of the same weakness: this clause names the snapshot timer as loudly as the real one and
  // asserts the opposite, so a check that asked only whether the name appears would pass a play that has
  // to remove the surviving timer to succeed.
  const mutated = mutate((play, steps) => {
    const closing = steps.find((step) => step.module === "ansible.builtin.assert")!;
    const args = moduleAt(play, closing);
    args.that = asList(args.that).map(asText)
      .map((clause) => clause.includes(" not in ") ? clause : clause.replace(" in ", " not in "));
  });
  provenBy(mutated, CLAUSES.assertSnapshotPresent,
    "an assert that succeeds only when the SURVIVING timer is also gone passed.");
});

/**
 * `stop-and-disable` fires only when NO systemd task mentions the retired timer at all — the state of this
 * playbook BEFORE #2059, rather than a mutation of it after. It is named here instead of skipped silently;
 * the task it guards is reached by `disable`, `stop` and `order`, each of which has a control above.
 */
const NO_MUTANT: string[] = [CLAUSES.stopAndDisable];

test("#2060: every clause the checker can report was WATCHED firing", () => {
  const expected = Object.values(CLAUSES).filter((clause) => !NO_MUTANT.includes(clause));
  assert.deepEqual([...proven].sort(), [...expected].sort(),
    "a clause in CLAUSES has no control that made it fire. An emptiness assertion passes perfectly "
    + "against a checker that examines nothing, so a clause nobody has watched fire is not coverage -- "
    + "add the mutant, or name the clause in NO_MUTANT with the reason it has none.");
});
