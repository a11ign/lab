/**
 * A CHECK ABOUT A CREDENTIAL'S ABSENCE MUST BE SHOWN TO FIRE, for the same reason
 * `board-liveness.test.ts` says it about board editions: the state it watches for (a token nobody revoked)
 * is silent by construction, so the verdict logic is pinned with a pure function driven by synthetic
 * inputs -- no network, no clock, no `gh`.
 *
 * THREE STATES ON TWO AXES (present: true/false/"unknown" x due: before/after 2026-11-20), and the
 * combination that matters most is not "present after due" -- it is "unknown after due", because that is
 * the one a lazier design collapses into either "fine" (masking a live outage) or "broken" (false-alarming
 * every push once the repo's default token, which structurally cannot list org secrets, is all that ever
 * asks). `tokenLivenessVerdict` must keep it a THIRD thing, loud, never silently either of the other two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { DUE_DATE, EXIT, tokenLivenessVerdict } from "../../../../scripts/npm-token-liveness.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BEFORE = "2026-09-10";
const AFTER = "2026-11-25";

test("gone, before the due date: ALIVE -- an early revoke is not a finding", () => {
  const v = tokenLivenessVerdict({ today: BEFORE, present: false });
  assert.equal(v.code, EXIT.ALIVE);
});

test("gone, after the due date: ALIVE -- this is the outcome the row is written to make boring", () => {
  const v = tokenLivenessVerdict({ today: AFTER, present: false });
  assert.equal(v.code, EXIT.ALIVE);
  assert.match(v.headline, /is gone/);
});

test("present, before the due date: ALIVE -- it exists to cover the first publish and is not late yet", () => {
  const v = tokenLivenessVerdict({ today: BEFORE, present: true });
  assert.equal(v.code, EXIT.ALIVE, "a token that still has a legitimate reason to exist is not a finding");
});

test("present, exactly on the due date, counts as due", () => {
  const v = tokenLivenessVerdict({ today: DUE_DATE, present: true });
  assert.equal(v.code, EXIT.STOPPED, "the due date itself is in scope, not the day after it");
});

test("STOPPED: present after the due date names all three possible causes, and refuses to guess which", () => {
  const v = tokenLivenessVerdict({ today: AFTER, present: true });
  assert.equal(v.code, EXIT.STOPPED);
  assert.match(v.detail, /trusted publishing was never configured/);
  assert.match(v.detail, /left behind/);
  assert.match(v.detail, /nobody looked/);
  assert.match(v.detail, /do not simply delete it/i,
    "the row's own text: deleting first destroys the evidence for which of the three it is");
});

test("unknown, before the due date: ALIVE -- an unprivileged token asking is the expected shape this early", () => {
  const v = tokenLivenessVerdict({ today: BEFORE, present: "unknown" });
  assert.equal(v.code, EXIT.ALIVE);
});

test("CANNOT_TELL: unknown after the due date is its OWN state, never folded into ALIVE or STOPPED", () => {
  // THE CASE THE HEADER SAYS MATTERS MOST. A CI job running on the repo's default token will read
  // "unknown" on every ordinary push, forever, unless a human deliberately grants a scoped read
  // credential -- so if this collapsed to ALIVE, an unrevoked token would report as fine for as long as
  // nobody grants that credential, which defeats the entire row. If it collapsed to STOPPED, the very
  // first ordinary push after 2026-11-20 would raise a false alarm regardless of the token's real state.
  const v = tokenLivenessVerdict({ today: AFTER, present: "unknown" });
  assert.equal(v.code, EXIT.CANNOT_TELL);
  assert.notEqual(v.code, EXIT.ALIVE);
  assert.notEqual(v.code, EXIT.STOPPED);
  assert.match(v.headline, /PAST DUE/);
  assert.match(v.detail, /org-admin/);
});

test("EXIT codes are three genuinely distinct integers", () => {
  const codes = new Set([EXIT.ALIVE, EXIT.STOPPED, EXIT.CANNOT_TELL]);
  assert.equal(codes.size, 3);
});

test("the workflow that runs this has no schedule key -- it must fire on push, never on a cron", () => {
  // The exact reason `board-liveness.test.ts` pins the same thing: a watchdog that is itself scheduled is
  // disabled by the same 60-day inactivity rule it exists to catch, so moving this onto a cron would
  // silently remove the one property that makes it work.
  const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/npm-token-liveness.yml"), "utf8");
  assert.doesNotMatch(workflow, /^\s*schedule:/m,
    "npm-token-liveness.yml must never gain a `schedule:` trigger -- see board-liveness.yml's own header "
    + "for why a watchdog cannot be a cron");
  assert.match(workflow, /^\s*push:/m, "it must trigger on push, which cannot be disabled by inactivity");
});
