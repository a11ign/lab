// no-token: gh
//
// Pure file reads and regexes. Nothing spawns, and nothing is imported but node:fs.

/**
 * #1933: `--` INSIDE AN XML COMMENT, AND THE FILE HAD NEVER PARSED.
 *
 * Measured 2026-09-22, while the chairman built five new bare-metal workers from USB media. The first
 * box came up at "Your password has expired and must be changed" and would not log on — on a fleet whose
 * whole design is a BLANK password confined to console logon by `LimitBlankPasswordUse`, with
 * credential-free auto-logon on top, because NVDA needs a real desktop session and nobody is there to
 * type anything.
 *
 * Investigating that turned up something nobody was looking for:
 * `provisioning/bare-metal/autounattend.xml` HAS NEVER BEEN WELL-FORMED XML. A comment contained a bare
 * `--`, which XML forbids inside `<!-- -->`, and a parser refuses the WHOLE DOCUMENT on it:
 *
 *     not well-formed (invalid token): line 359, column 42
 *
 * It surfaced only because a new comment was being added and the file was parsed to check that edit.
 *
 * WHY IT MATTERS MORE THAN A TYPO. Windows Setup reads this file to create the account, enable
 * auto-logon and hand off to the bootstrap. A parser that rejects it tells a headless box in another
 * room nothing at all: the install proceeds as though no answer file were supplied, and the first
 * evidence is a machine sitting at a logon prompt it should never have been able to show.
 *
 * THIS TEST DOES NOT CLAIM TO HAVE PROVED THAT LINK. The ten existing workers were PXE-built through
 * iVentoy, a different path with its own injection step, and a lenient parser upstream explains them
 * perfectly well. "It has worked so far" is not a claim about well-formedness. This removes a defect
 * that could produce the incident, and pins the rule so nobody has to wonder again.
 *
 * NO XML PARSER IS IMPORTED, deliberately. Node ships none, `fast-xml-parser` is not a dependency, and
 * the only one resolvable in this tree (`@xmldom/xmldom`) is TRANSITIVE — a test built on a package no
 * `package.json` asks for silently stops running the day an unrelated upgrade drops it. The rule that
 * actually broke is exact and needs no parser, so it is checked directly and the limit is stated rather
 * than papered over: this pins the `--` rule and the blank-password contract, NOT full well-formedness.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UNATTEND_FILES = [
  "../../../worker-fleet/src/provisioning/bare-metal/autounattend.xml",
  "../../../worker-fleet/src/local-worker/autounattend.xml",
];

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Every `<!-- ... -->` body in `xml`. */
const commentBodies = (xml: string) => [...xml.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);

test("#1933: no comment in any shipped autounattend.xml contains a bare `--`", () => {
  for (const rel of UNATTEND_FILES) {
    const offenders = commentBodies(read(rel)).filter((body) => body.includes("--"));
    assert.deepEqual(offenders.map((o) => o.trim().slice(0, 70)), [],
      `${rel}: a comment contains \`--\`, which XML forbids inside <!-- -->, and a parser rejects the `
      + "WHOLE FILE on it. Use an em dash. This is how this very file spent its entire life unparseable, "
      + "and how a headless box gets built with no answer file and no error.");
  }
});

test("#1933 POSITIVE CONTROL: the detector really fires on the construct that broke", () => {
  // Without this the assertion above passes just as happily against a regex that matches nothing, and an
  // emptiness assertion whose control nobody can point at is the one this repository refuses by rule.
  assert.deepEqual(commentBodies("<root><!-- a -- b --></root>").filter((b) => b.includes("--")),
    [" a -- b "], "the exact shape found in the real file must be detected");
  assert.deepEqual(commentBodies("<root><!-- a — b --></root>").filter((b) => b.includes("--")), [],
    "and the em-dash fix those files now use must NOT be reported, or the check cries wolf");
  assert.equal(commentBodies("<root><!-- one --><!-- two --></root>").length, 2,
    "two comments are two bodies -- a lazy match would swallow everything between the first `<!--` and "
    + "the last `-->` and report one, hiding every offender but the outermost");
});

test("#1933: the blank-password contract the whole fleet rests on is still declared", () => {
  // The row began as an expired password, and the answer to "what should it be" is that there must not
  // be one. If an edit ever puts a value in either element, auto-logon stops, `LimitBlankPasswordUse`
  // stops confining the account to the console, and a headless box goes silent with no error anywhere.
  const xml = read(UNATTEND_FILES[0]);

  assert.match(xml, /<Name>witness<\/Name>/, "the worker account is `witness`");
  // BOTH, and counted: the LocalAccount's password and AutoLogon's must each be empty. Asserting one
  // would let the other carry a value, and it is AutoLogon's that silently costs the desktop session.
  const emptyPasswords = [...xml.matchAll(/<Password>\s*<Value>(.*?)<\/Value>/gs)].map((m) => m[1]);
  assert.equal(emptyPasswords.length, 2, "exactly two Password/Value pairs: the account, and auto-logon");
  assert.deepEqual(emptyPasswords, ["", ""],
    "both are BLANK BY DESIGN -- see roles/worker/tasks/account.yml's header for the security maths: a "
    + "blank password is console-only under LimitBlankPasswordUse, and SSH key auth is unaffected");
  assert.match(xml, /<AutoLogon>[\s\S]*?<Enabled>true<\/Enabled>/, "auto-logon stays on");
});

test("#1933: the expiry window is closed in `specialize`, the only pass that can close it", () => {
  // THE TRAP THIS PINS. `account.yml` and `provision-nvda-worker.ps1` both set PasswordNeverExpires, but
  // both run over SSH -- which needs the box up, which needs auto-logon, which is what the expiry breaks.
  // `FirstLogonCommands` cannot do it either: an expired password makes auto-logon ITSELF fail, so the
  // box stops at an interactive prompt and first-logon commands never run. Only `specialize`, during
  // setup and before any logon exists, is early enough.
  const xml = read(UNATTEND_FILES[0]);
  const specialize = xml.split('<settings pass="specialize">')[1]?.split("</settings>")[0] ?? "";
  assert.ok(specialize.length > 0, "the specialize pass exists");
  assert.match(specialize, /net accounts \/maxpwage:unlimited/,
    "the password-age clock is stopped during setup, not after first logon -- after is too late");
  const oobe = xml.split('<settings pass="oobeSystem">')[1] ?? "";
  assert.doesNotMatch(oobe, /maxpwage/,
    "and it is NOT in oobeSystem, which runs after the logon it is meant to protect");
});
