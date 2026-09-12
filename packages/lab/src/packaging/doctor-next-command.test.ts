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

import { spawnSync } from "node:child_process";

import { workerControlFix, nextCommand, isRunnableCommand, readyFrom, gatingChecks, addCheck, allChecks,
  doctorRun, errorDocument } from "../../../worker-fleet/src/doctor.mjs";

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
  // THE NON-GATING SET IS NAMED, and this is the one place a literal is right: these are DECISIONS, and
  // the point is that adding a fourth is a deliberate, visible act rather than a default. It was
  // `everything except dataset` until three more checks turned out to exist -- which this assertion
  // caught, as it should have.
  assert.deepEqual(allChecks().filter((n) => !gatingChecks().includes(n)).sort(),
    ["dataset", "fleet reach", "host memory", "primary checkout"],
    "these are the checks declared NOT to decide readiness. Adding one is a decision: say why beside its "
    + "GATES entry, and change this list in the same commit");
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

test("#1077: EVERY check the source adds is declared — the table is complete, not merely consulted", () => {
  // THE CASE THE SYNTHETIC NAME DID NOT REACH. My "an undeclared check throws" test drove a made-up name
  // and passed, while the REAL doctor had three checks missing from GATES -- so `npm run doctor --json`
  // threw, exit 1, zero bytes of JSON, on the command CLAUDE.md tells an agent to run first.
  //
  // The cause is the enumeration I built the table from: `add\("[a-z-]+"` matched ten names and **silently
  // dropped every multi-word one** -- `fleet reach`, `host memory`, `primary checkout`. **A population
  // built from a character class that could not express three of its members.** `[^"]+` finds all
  // thirteen, and this asserts the two sets are equal rather than that the table is non-empty.
  const source = readFileSync(fileURLToPath(new URL("../../../worker-fleet/src/doctor.mjs", import.meta.url)), "utf8");
  const added = [...new Set([...source.matchAll(/\badd\("([^"]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(added, allChecks().sort(),
    `these differ: the source adds ${added.length} distinct checks and GATES declares ${allChecks().length}. `
    + "Every added check must declare whether it gates, or `doctor` throws on its next real run");
  // And the control on the pattern itself: it must be able to express a multi-word name, or the equality
  // above is between two sets that both exclude the same three and agree for the wrong reason.
  assert.ok(added.some((name) => name.includes(" ")),
    `no multi-word check name was found among ${added.join(", ")} -- the pattern has narrowed back to one `
    + "that cannot see the names it missed the first time");
});

// ---------------------------------------------------------------------------------------------------
// #1082: a `--json` run that CANNOT produce JSON still produces JSON.
//
// Measured on `1e74e3d0`: a check threw and `doctor --json` exited 1 with ZERO BYTES on stdout, the whole
// failure on stderr where a `--json` consumer never looks. "Could not ask" and "no output" are different
// facts for a caller and only the first is actionable -- the second is indistinguishable from a command
// that was never run at all.
//
// `2>&1` is NOT the fix, which is what separates this from #1068's watch job: THAT stdout is prose, so
// merging stderr in was free. This one is a PARSED format, and redirecting into it produces invalid JSON --
// worse than nothing, because a consumer that parses gets a syntax error instead of a document.
// ---------------------------------------------------------------------------------------------------

/** The text a real check would carry up. Deliberately ordinary prose: the assertion is that THIS reaches
 *  the document, so a message the tool could have invented instead would prove nothing. */
const CHECK_FAILURE = "the scorer did not answer within 20s";
const throwingStep = () => { throw new Error(CHECK_FAILURE); };

/** Runs `doctorRun` with its streams captured, so stdout and stderr can be asserted on separately. */
async function runCapturing(steps: (() => unknown)[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await doctorRun({ steps, json: true, out: (l: string) => out.push(l), err: (l: string) => err.push(l) });
  return { code, out, err };
}

test("#1082 ACCEPTANCE: a check that throws still puts a PARSEABLE document on stdout, and the exit is not 0", async () => {
  const { code, out, err } = await runCapturing([throwingStep]);

  // Parsed, not pattern-matched: a regex over the text would pass on a fragment that no consumer can read,
  // which is the exact failure -- output that looks like an answer and is not one.
  const doc = JSON.parse(out.join("\n"));

  assert.equal(doc.ready, false, "a run that could not complete is not ready");
  assert.match(String(doc.error), new RegExp(CHECK_FAILURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `the REAL failure text must survive into the document; got ${JSON.stringify(doc.error)}`);
  assert.ok("checks" in doc, "`checks` is PRESENT -- an absent key crashes a consumer reading `.checks[]`");
  assert.deepEqual(doc.checks, [],
    "and EMPTY rather than partial: a partial list reads exactly like a complete verdict, and nothing in it "
    + "distinguishes a check missing because it passed from one missing because the run died under it");

  // Asserted HERE, beside the body, so the two cannot drift: a document saying `ready: false` under exit 0
  // tells a shell the opposite of what it tells a parser.
  assert.notEqual(code, 0, "the exit code still reports failure");
  assert.equal(err.length, 0, "and in --json mode NOTHING goes to stderr that stdout did not already say");
});

test("#1082: nothing that is not JSON reaches stdout -- the whole of it parses, in one piece", async () => {
  const { out } = await runCapturing([() => {}, throwingStep, () => { throw new Error("never reached"); }]);
  assert.equal(out.length, 1, `stdout is ONE document, not a document plus a line about it; got ${out.length} writes`);
  assert.doesNotThrow(() => JSON.parse(out[0]),
    "a `console.log` beside the document would corrupt it for every consumer -- the failure this exists to "
    + "prevent, not to introduce");
});

test("#1082 CONTROL: a step that RETURNS still renders the ordinary document, through the same call", async () => {
  // Without this, `return errorDocument(...)` unconditionally satisfies every assertion above while
  // destroying the tool. So this drives the SAME entry point over a step that succeeds -- and it is a
  // control only because it would go red under that mutation: the error document carries no `next_command`
  // and an empty `checks`, so the membership assertion below could not hold.
  //
  // Not hand-built. A document assembled in the test is a fixture agreeing with a fixture, which is how
  // #1077 shipped a guard whose only input was a name the real tool never used.
  const { out } = await runCapturing([() => addCheck("dataset", true, "control: a check that returns", null)]);
  const doc = JSON.parse(out.join("\n"));

  assert.ok(!("error" in doc), "no `error` key -- its presence is the signal that NO verdict exists");
  assert.ok("next_command" in doc, "the ordinary document still answers the field CLAUDE.md tells an agent to read");
  assert.ok(doc.checks.some((c: { name: string, detail: string }) => c.detail === "control: a check that returns"),
    `the step's own check must reach the document; got ${JSON.stringify(doc.checks.map((c: { name: string }) => c.name))}`);
});

test("#1082: driven as a real process -- real stdout, real exit code, not a captured fixture", () => {
  // #1077's lesson, applied before the fact: the synthetic name was the only name I ever gave that check,
  // and the real command threw. The assertions above share one injected `out`; this one shares nothing with
  // them -- it spawns node, reads the bytes on fd 1, and reads the status the shell would read.
  const doctorUrl = new URL("../../../worker-fleet/src/doctor.mjs", import.meta.url).href;
  const script = `import { doctorRun } from ${JSON.stringify(doctorUrl)};\n`
    + `process.exit(await doctorRun({ steps: [() => { throw new Error(${JSON.stringify(CHECK_FAILURE)}); }], json: true }));\n`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });

  assert.notEqual(run.status, 0, `the process must fail; it exited ${run.status}. stderr: ${run.stderr}`);
  const doc = JSON.parse(run.stdout);
  assert.equal(doc.ready, false);
  assert.deepEqual(doc.checks, []);
  assert.match(String(doc.error), new RegExp(CHECK_FAILURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the real failure text, off the real stdout");
});

test("#1082: `errorDocument` carries a non-Error throw too, rather than printing [object Object]", () => {
  assert.equal(errorDocument("a string was thrown").error, "a string was thrown");
  assert.deepEqual(errorDocument(new Error("x")), { ready: false, error: "x", checks: [] });
});
