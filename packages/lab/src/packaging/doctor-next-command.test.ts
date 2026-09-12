/**
 * #1059: `doctor`'s `next:` line — the one field CLAUDE.md tells an agent to read and obey — sent a reader
 * to a script that had just refused to run.
 *
 *     FAIL  worker  could not query the local pool (DEPRECATED: … refusing: set A11Y_LOCAL_VM=1 …)
 *             fix: unlock the Mac if it is locked, then re-run …/worker-ctl.sh pool
 *     next: unlock the Mac if it is locked, then re-run …/worker-ctl.sh pool
 *
 * **Following it exactly reproduces the refusal**, and the correct remedy was already printed beside it:
 * *"Capture on the bare-metal fleet instead: npm run fleet:status."* Three defects in one line — not
 * followable, contradicting the message above it, and not a command at all.
 *
 * DRIVEN THROUGH THE FUNCTIONS THAT BUILD THE LINE, over injected check results — never asserted against
 * the current tree, which would pass the day the wording drifts and say nothing about what the tool does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { workerControlFix, nextCommand, isRunnableCommand, readyFrom, gatingChecks, addCheck, allChecks }
  from "../../../worker-fleet/src/doctor.mjs";

/** The refusal `worker-ctl.sh` actually prints, quoted from the #915 rehearsal. */
const DEPRECATION_REFUSAL = "could not query the local pool (DEPRECATED: worker-ctl.sh manages a local "
  + "UTM worker VM. UTM was a testing path and is not the fleet. Capture on the bare-metal fleet instead: "
  + "npm run fleet:status, npm run fleet:deploy. refusing: set A11Y_LOCAL_VM=1 to run this deprecated "
  + "local-VM script anyway.)";

test("#1059 ACCEPTANCE: a deprecation refusal's remedy names the FLEET, not the script that refused", () => {
  const { fix, note } = workerControlFix(DEPRECATION_REFUSAL);
  assert.equal(fix, "npm run fleet:status",
    "the remedy the refusal itself names — following the old one reproduced the refusal, which is the one "
    + "thing a fix line must never do");
  assert.match(String(note), /deprecated/i, "and the reason stays, in the field nothing executes");
  assert.match(String(note), /A11Y_LOCAL_VM=1/,
    "including the override, so somebody who genuinely wants the local VM is not left guessing");
});

test("#1059: `next_command` is that command, driven through the real builder over an injected check", () => {
  const { fix } = workerControlFix(DEPRECATION_REFUSAL);
  const next = nextCommand([{ ok: false, fix }]); // the `worker` check, failing
  assert.equal(next, "npm run fleet:status");
  assert.ok(isRunnableCommand(next), "and it is a command, which is the whole point of the field");
});

test("#1059: the old line FAILS the shape check — this is the assertion that would have caught it", () => {
  assert.equal(isRunnableCommand("unlock the Mac if it is locked, then re-run /x/worker-ctl.sh pool"), false,
    "an English imperative is not a command, however clear it is to a human");
  assert.equal(isRunnableCommand("wait — the pool is busy with another run"), false);
  for (const command of ["npm run fleet:status", "npx tsx x.ts", "node scripts/x.mjs", "git fetch origin",
    "/Users/x/worker-ctl.sh pool", "A11Y_LOCAL_VM=1 /x/y.sh pool", "./x.sh"]) {
    assert.ok(isRunnableCommand(command), `${command} is runnable and must pass`);
  }
});

test("#1059: a `next_command` that cannot be built is null, never a sentence", () => {
  // An ABSENT command and an UNRUNNABLE one are different reports, and only the first is actionable:
  // `null` means read the checks. `contention` is the live case — waiting is not a command — and it says
  // so with `null` plus a note rather than with an imperative nobody can execute.
  assert.equal(nextCommand([{ ok: false, fix: null }]), null, "`contention`: waiting is not a command");
  assert.equal(isRunnableCommand(null), false,
    "and `null` is not 'runnable' either — the caller distinguishes absent from unrunnable, not this");
  assert.equal(nextCommand([{ ok: true, fix: null }]), "npm run training:capture",
    "and an all-clear still names the command to run next");
});

test("#1059 MUTATION TARGET: pointing the remedy back at the deprecated script must fail the first test", () => {
  // The row's declared mutation, expressed here so a reviewer does not have to perform it: the assertion
  // above is an equality against the FLEET command, so any remedy naming `worker-ctl.sh` fails it. Deleting
  // the remedy is the mutation a text search agrees with — this keeps the field and changes what it names.
  const asIfReverted = { fix: "unlock the Mac if it is locked, then re-run /x/worker-ctl.sh pool" };
  assert.notEqual(asIfReverted.fix, "npm run fleet:status");
  assert.equal(isRunnableCommand(asIfReverted.fix), false,
    "and it fails the shape check too, so the two assertions are not one assertion written twice");
});

test("#1059: the other two local-VM remedies are commands as well", () => {
  // The deprecation branch is not the only one. If these had stayed prose, the fix would have moved the
  // defect one branch over rather than removing it.
  for (const observed of ["could not query the local pool (no VM named a11y-worker-2)",
    "could not query the local pool (something else entirely)"]) {
    const { fix } = workerControlFix(observed);
    assert.ok(isRunnableCommand(fix), `${observed} -> ${fix} must be runnable`);
  }
});

// --- #1073: the dataset check REPORTS and does not gate ---

test("#1073 ACCEPTANCE: a checkout whose only failing check is `dataset` reads READY", () => {
  // product-manager's ruling, and the case nobody runs because everybody here has a corpus: a stranger
  // clones the repo, configures a Windows worker, runs `npm run doctor`, and is told the tool is NOT READY
  // because they have not generated a TRAINING CORPUS they have no reason to want. `doctor` is the first
  // command the README names and CLAUDE.md tells an agent to obey its `next_command` — so a NOT READY on a
  // machine that is ready for the documented purpose teaches the reader the verdict is not about them.
  assert.equal(readyFrom([
    { name: "worker", ok: true }, { name: "judge", ok: true }, { name: "pages", ok: true },
    { name: "dataset", ok: false },
  ]), true);
});

test("#1073: a failing `worker` check still produces NOT READY — the gate narrows, it does not vanish", () => {
  // A readiness command that is always ready is worse than one that is never ready, because it is believed.
  // THE COUNT, NOT A FLOOR -- #1067's ratchet caught the first version of this, which was
  // `assert.ok(gatingChecks().length >= 5, …)`: a floor on a number the same assertion reported, in the PR
  // after the ratchet landed. `>= 5` is satisfied by 5 and by 9 and by 400. The vacuity risk here is the
  // LOOP being empty, so the honest assertion is that the loop examined every gating check -- a property,
  // derived on both sides, with no literal to drift.
  let examined = 0;
  for (const gating of gatingChecks()) {
    examined += 1;
    assert.equal(readyFrom([{ name: gating, ok: false }, { name: "dataset", ok: true }]), false,
      `${gating} decides readiness and a failure there must still read NOT READY`);
  }
  assert.equal(examined, gatingChecks().length, "the loop examined every gating check");
  assert.deepEqual(gatingChecks().sort(), allChecks().filter((n) => n !== "dataset").sort(),
    "and the gating set is every declared check except `dataset` -- the one entry #1073 makes report "
    + "rather than decide. Adding a check with `gates: false` must be a deliberate act that shows up here");
});

test("#1073: every check DECLARES whether it gates, and an undeclared one cannot inherit a default", () => {
  // Asserted by driving the real `add`, not by reading the table: a new check reaching a default silently
  // is the whole defect, so the forcing function has to be observable.
  assert.throws(() => addCheck("a-check-nobody-declared", false, "detail"), /declares no entry in GATES/,
    "an undeclared check must refuse rather than gate or not-gate by accident");
  // And the control: a declared one is accepted, or "throws on everything" satisfies the assertion above.
  assert.doesNotThrow(() => addCheck("dataset", true, "detail"));
});

test("#1073: the non-gating check is still REPORTED with its fix", () => {
  // "Not blocking" and "not shown" are different, and the second loses the lab path its diagnostic. The
  // printer keys on `!c.ok`, never on whether the check gates — asserted on the source, because the print
  // path writes to stdout from `main()` and has no seam.
  const source = readFileSync(fileURLToPath(new URL("../../../worker-fleet/src/doctor.mjs", import.meta.url)), "utf8");
  assert.match(source, /if \(\(!c\.ok \|\| c\.advisory\) && c\.fix\)/,
    "the fix line is printed for any failing check, gating or not");
  assert.doesNotMatch(source, /GATES\[[^\]]*\][^\n]*console\.log/,
    "and nothing in the print path consults GATES — a check that stopped deciding must not stop appearing");
});
