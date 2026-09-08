/**
 * A COMMAND SHOULD NOT COST A `package.json` EDIT — A3.
 *
 * Nineteen PRs edited one file for unrelated reasons: a changeset, a dependency bump and a new npm script
 * all land in `package.json`, so two of them collide for no reason connected to either. B4 (no two open
 * PRs touch the same file) is impractical while that is true, which is why this row comes first.
 *
 * The dispatcher's refusals are what this pins. A dispatcher that ignored an unrecognised name would run
 * nothing and exit 0, and "the command did nothing" and "there is no such command" would be the same
 * observation — the shape `refuseUnknownFlags` exists for, one layer up.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { decide } from "../../../../scripts/run.mjs";
import { COMMANDS } from "../../../../scripts/commands.mjs";

const FIXTURE = { alpha: { argv: ["node", "scripts/alpha.mjs"] } };

/** The refusal message for a name the fixture does not declare. */
function refusalFor(name: string): string {
  const d = decide([name], FIXTURE);
  assert.equal(d.action, "refuse", `${name} should have been refused`);
  return d.action === "refuse" ? d.message : "";
}

test("a known name runs, with everything after it passed through untouched", () => {
  const d = decide(["alpha", "--flag=1", "positional"], FIXTURE);
  assert.equal(d.action, "run");
  assert.deepEqual(d.action === "run" && d.argv,
    ["node", "scripts/alpha.mjs", "--flag=1", "positional"],
    "a command's own flags are its business -- re-parsing them here is what put a shell between the "
    + "operator and the command and sent four capture shards at `--worker=http://:8765`");
});

test("AN UNKNOWN NAME IS REFUSED, never ignored", () => {
  const d = decide(["alpaha"], FIXTURE);
  assert.equal(d.action, "refuse", "ignoring it would run nothing and exit 0, which reads exactly like a "
    + "command that ran and found nothing");
  assert.match(d.action === "refuse" ? d.message : "", /Did you mean alpha\?/,
    "a refusal that does not name the near miss makes the author guess");
});

test("no arguments prints the usage and REFUSES, rather than doing something", () => {
  const d = decide([], FIXTURE);
  assert.equal(d.action, "refuse");
  assert.match(d.action === "refuse" ? d.message : "", /--list/);
});

test("--list is its own action, and is not mistaken for a command name", () => {
  assert.equal(decide(["--list"], FIXTURE).action, "list");
});

test("the near-miss suggestion is cli-flags' Levenshtein, not a second spelling of it", () => {
  // This file had its own substring matcher until the test above caught it failing on a TRANSPOSITION --
  // the commonest typo, and the one a substring test structurally cannot see. `didYouMean` already
  // answers "which name did they mean" for flags; two answers to one question drift, and the wrong one
  // is only discovered by someone mistyping under pressure.
  assert.match(refusalFor("alpaha"), /Did you mean alpha\?/);
  assert.doesNotMatch(refusalFor("zzz"), /Did you mean/,
    "a suggestion for something nothing resembles is a guess, and a guess in a refusal is noise");
});

test("THE REAL CATALOGUE LOADS, and every entry names an argv that could run", () => {
  // Guard the guard: the tests above use a fixture, so a broken real catalogue would not fail any of
  // them. This is the one that reads what ships.
  const names = Object.keys(COMMANDS);
  assert.ok(names.length > 0, "scripts/commands.mjs declares no commands -- the dispatcher has nothing "
    + "to dispatch, and `commands-documented.test.ts` is guarding an empty set");
  for (const [name, command] of Object.entries(COMMANDS)) {
    assert.ok(Array.isArray(command.argv) && command.argv.length >= 2,
      `${name} needs an argv of at least [runner, script]`);
    assert.equal(decide([name], COMMANDS).action, "run", `${name} is declared and does not dispatch`);
  }
});
