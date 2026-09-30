/**
 * #2800 — NOTHING COMPARED THE CONTROL HOST'S INSTALLED UNITS TO THEIR REPOSITORY COPIES.
 *
 * The units on the control host were the #2656 copies while the repository held the #2734 ones, and nobody
 * noticed for two days (#2784). `control-unit-drift.mjs` reads the host and says which unit differs, is
 * missing, or is installed and shipped by nobody -- and says `CANNOT_TELL`, never "no drift", when it
 * could not look. Every case here drives it through an injected host reader, so it runs offline; the one
 * live reading (done-when 4) is posted on #2784 and this file proves only what fixtures can.
 *
 * POSITIVE CONTROLS, so "no findings" cannot stand for two different things: the differing and matching
 * fixtures are asserted to differ before the reader runs on them, the unreadable host is asserted NOT to
 * equal the matching host's reading, and the derivation over the real playbooks is asserted non-empty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXIT, KIND, VERDICT, checkoutSource, controlUnitDrift, deriveShippedUnits, exitCodeFor, parseHostListing,
} from "../../../control/src/control-unit-drift.mjs";

const TIMER = "a11y-fleet-auto-off.timer";
const SERVICE = "a11y-fleet-auto-off.service";
const SHIPPED: Record<string, string> = {
  [TIMER]: "[Timer]\nOnUnitActiveSec=10s\n",
  [SERVICE]: "[Service]\nExecStart=/bin/true\n",
};

/** A playbook shaped like `auto-off-schedule.yml`'s install play, for the units it names. */
const playbook = (hosts: string, units: string[]) => `---
- name: The play that installs
  hosts: ${hosts}
  vars:
    some_units:
${units.map((unit) => `      - ${unit}`).join("\n")}
  tasks:
    - name: Install the unit files
      ansible.builtin.copy:
        src: "files/{{ item }}"
        dest: "/etc/systemd/system/{{ item }}"
      loop: "{{ some_units }}"
`;

const source = (playbooks: string[], texts: Record<string, string> = SHIPPED) => ({
  playbooks: () => playbooks,
  shippedText: (unit: string) => {
    if (!(unit in texts)) throw new Error(`ENOENT ${unit}`);
    return texts[unit];
  },
});

const drift = (readHost: () => Record<string, string> | null | undefined,
  playbooks = [playbook("a11y_control", [TIMER, SERVICE])]) =>
  controlUnitDrift({ readHost, ...source(playbooks) });

test("a matching host yields no finding, and the fixture really matches", () => {
  const reading = drift(() => ({ ...SHIPPED }));
  assert.deepEqual(reading, { verdict: VERDICT.CLEAN, findings: [] });
});

test("a unit whose installed copy differs yields a finding naming that unit", () => {
  const installed = { ...SHIPPED, [TIMER]: "[Timer]\nOnUnitActiveSec=5min\n" };
  assert.notEqual(installed[TIMER], SHIPPED[TIMER], "positive control: the fixture must actually differ");
  const reading = drift(() => installed);
  assert.equal(reading.verdict, VERDICT.DRIFT);
  assert.deepEqual(reading.findings.map(({ unit, kind }) => ({ unit, kind })), [{ unit: TIMER, kind: KIND.DIFFERS }]);
  assert.notDeepEqual(reading, drift(() => ({ ...SHIPPED })), "a differing host must not read like a matching one");
});

test("a shipped unit absent from the host is `missing-on-host` -- the re-installed-never case", () => {
  const installed = { [TIMER]: SHIPPED[TIMER] };
  assert.ok(!(SERVICE in installed), "positive control: the service really is absent from the fixture");
  const reading = drift(() => installed);
  assert.deepEqual(reading.findings.map(({ unit, kind }) => ({ unit, kind })), [{ unit: SERVICE, kind: KIND.MISSING }]);
});

test("a unit installed on the host and shipped by nobody is `not-shipped`", () => {
  const reading = drift(() => ({ ...SHIPPED, "a11y-retired.timer": "[Timer]\n" }));
  assert.equal(reading.verdict, VERDICT.DRIFT);
  assert.deepEqual(reading.findings.map(({ unit, kind }) => ({ unit, kind })),
    [{ unit: "a11y-retired.timer", kind: KIND.NOT_SHIPPED }]);
});

test("a foreign unit on the host that is not one of ours is nobody's finding", () => {
  assert.equal(drift(() => ({ ...SHIPPED, "ssh.service": "[Service]\n" })).verdict, VERDICT.CLEAN);
});

test("a host that cannot be read is CANNOT_TELL, never an empty finding list reading as clean", () => {
  const clean = drift(() => ({ ...SHIPPED }));
  const unreadable: Record<string, () => Record<string, string> | null | undefined> = {
    "an unresolvable name": () => { throw new Error("ssh: Could not resolve hostname"); },
    "a refused key": () => { throw new Error("Permission denied (publickey)"); },
    "an empty answer (null)": () => null,
    "an empty answer (undefined)": () => undefined,
    "an empty answer (no units)": () => ({}),
  };
  for (const [name, readHost] of Object.entries(unreadable)) {
    const reading = drift(readHost);
    assert.equal(reading.verdict, VERDICT.CANNOT_TELL, name);
    assert.ok(reading.reason, `${name}: says why it could not tell`);
    assert.notDeepEqual(reading, clean, `${name}: must not equal the matching host's reading`);
    assert.equal(exitCodeFor(reading), EXIT.CANNOT_ASK, name);
  }
});

test("the exit code is the tristate: quiet, attention, cannot ask", () => {
  assert.equal(exitCodeFor(drift(() => ({ ...SHIPPED }))), EXIT.QUIET);
  assert.equal(exitCodeFor(drift(() => ({ [TIMER]: "x", [SERVICE]: "y" }))), EXIT.ATTENTION);
  assert.equal(new Set(Object.values(EXIT)).size, Object.keys(EXIT).length, "every outcome has its own code");
});

test("the compared set is DERIVED from the playbooks: a unit pair added to one is compared unedited", () => {
  const added = ["a11y-new-thing.timer", "a11y-new-thing.service"];
  const texts = { ...SHIPPED, [added[0]]: "[Timer]\n", [added[1]]: "[Service]\n" };
  const playbooks = [playbook("a11y_control", [TIMER, SERVICE]), playbook("a11y_control", added)];
  const reading = controlUnitDrift({ readHost: () => ({ ...SHIPPED }), ...source(playbooks, texts) });
  assert.deepEqual(reading.findings.map(({ unit, kind }) => ({ unit, kind })),
    [...added].sort().map((unit) => ({ unit, kind: KIND.MISSING })));
});

test("only plays targeting a11y_control count: a lab play's units are not on the control host", () => {
  const derived = deriveShippedUnits({ playbooks: () => [playbook("a11y_lab", ["a11y-lab-only.timer"]),
    playbook("a11y_control", [TIMER])] });
  assert.deepEqual(derived, { units: [TIMER] });
});

test("a derivation that finds nothing is CANNOT_TELL, not 'nothing ships so nothing drifts'", () => {
  const reading = drift(() => ({ ...SHIPPED }), [playbook("a11y_lab", ["a11y-lab-only.timer"])]);
  assert.equal(reading.verdict, VERDICT.CANNOT_TELL);
});

test("a derived unit with no repository copy is CANNOT_TELL", () => {
  const reading = controlUnitDrift({ readHost: () => ({ ...SHIPPED }),
    ...source([playbook("a11y_control", [TIMER, SERVICE])], { [TIMER]: SHIPPED[TIMER] }) });
  assert.equal(reading.verdict, VERDICT.CANNOT_TELL);
});

test("over the REAL playbooks the derivation finds the auto-off pair and not the lab's corpus pair", () => {
  const derived = deriveShippedUnits(checkoutSource);
  assert.ok("units" in derived, "positive control: the real playbooks derive a non-empty set");
  assert.deepEqual(derived.units, [SERVICE, TIMER].sort());
  assert.ok(!derived.units.some((unit) => unit.startsWith("a11y-corpus-snapshot")),
    "the corpus-snapshot pair ships to a11y_lab, not the control host");
  // And the repository agrees with itself: the shipped copies read back as a clean host.
  const installed = Object.fromEntries(derived.units.map((unit) => [unit, checkoutSource.shippedText(unit)]));
  assert.equal(controlUnitDrift({ readHost: () => installed, ...checkoutSource }).verdict, VERDICT.CLEAN);
});

test("the ssh listing round-trips a unit's text, and a truncated one is refused", () => {
  const text = "[Unit]\nDescription=with spaces = and\nnewlines\n";
  const line = `a11y-x.timer ${Buffer.from(text).toString("base64")}`;
  assert.deepEqual(parseHostListing(`${line}\n--end-of-units--\n`), { "a11y-x.timer": text });
  assert.deepEqual(parseHostListing("--end-of-units--\n"), {}, "an honest empty directory parses to empty");
  assert.throws(() => parseHostListing(`${line}\n`), /truncated/);
  assert.throws(() => parseHostListing(""), /truncated/, "an empty ssh answer is refused, not read as empty");
});
