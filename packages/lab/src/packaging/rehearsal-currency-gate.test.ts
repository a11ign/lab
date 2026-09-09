/**
 * `release:rehearsal-check` must REFUSE a release whose commit is not the one `RELEASE.md`'s own rehearsal
 * marker names -- #813's own mutation, made real. Tier 2 of `docs/proving-a-gate.md`'s recipe:
 * `rehearsal-currency.test.ts` proves the decision over injected inputs; this proves the COMMAND -- the
 * paths it composes, the exit code it returns, the sentence it prints.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPT = join(REPO, "packages/lab/scripts/check-rehearsal-currency.mjs");

const SHA = "8849f92df9903660315d0cdc9037e7e04276eece";
const OTHER_SHA = "f47339e2c1d4a5b6e7f8091a2b3c4d5e6f7a8b9c";

/** A minimal tree with the one file this gate reads. */
function planted(releaseMd: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "a11y-rehearsal-"));
  if (releaseMd !== null) writeFileSync(join(root, "RELEASE.md"), releaseMd);
  return root;
}

/** @returns the command's exit code and its combined output. */
function runGate(root: string, releaseSha: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, A11Y_REHEARSAL_ROOT: root, A11Y_REHEARSAL_RELEASE_SHA: releaseSha },
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

test("#813's own mutation, made real: a rehearsal that predates the release commit REFUSES, printing both", () => {
  const root = planted(`Prose.\n\n<!-- REHEARSAL:COMMIT ${SHA} -->\n\nMore prose.`);
  try {
    const { code, out } = runGate(root, OTHER_SHA);
    assert.equal(code, 1, "a release commit the rehearsal never ran against must not pass");
    assert.match(out, new RegExp(SHA), "the marked (stale) sha must be printed");
    assert.match(out, new RegExp(OTHER_SHA), "the actual release sha must be printed");
    assert.match(out, /FAIL/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("THE CONTROL: a release commit matching the marker passes, and says what it examined", () => {
  const root = planted(`Prose.\n\n<!-- REHEARSAL:COMMIT ${SHA} -->\n\nMore prose.`);
  try {
    const { code, out } = runGate(root, SHA);
    assert.equal(code, 0, `a matching commit must pass; the gate said: ${out}`);
    assert.match(out, /PASS/);
    assert.match(out, /rehearsal marker/, "a pass that does not say what it compared is not this repo's shape");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a RELEASE.md with no marker at all is a REFUSAL, never a quiet pass", () => {
  const root = planted("RELEASE.md with no rehearsal marker at all.");
  try {
    const { code, out } = runGate(root, SHA);
    assert.equal(code, 1);
    assert.match(out, /no rehearsal is on record/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing RELEASE.md entirely is a REFUSAL, never a crash", () => {
  const root = planted(null);
  try {
    const { code, out } = runGate(root, SHA);
    assert.equal(code, 1);
    assert.match(out, /no rehearsal is on record/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("INCONCLUSIVE is unreachable from this gate, by construction -- one marker, one question", () => {
  const scenarios = [
    { label: "matching commit", root: planted(`<!-- REHEARSAL:COMMIT ${SHA} -->`), sha: SHA },
    { label: "stale commit", root: planted(`<!-- REHEARSAL:COMMIT ${SHA} -->`), sha: OTHER_SHA },
    { label: "no marker", root: planted("nothing here"), sha: SHA },
  ];
  try {
    for (const { label, root, sha } of scenarios) {
      const { code, out } = runGate(root, sha);
      assert.ok(code === 0 || code === 1, `${label}: exit code was ${code}, expected 0 or 1 -- never 2`);
      assert.doesNotMatch(out, /INCONCLUSIVE/, `${label}: printed INCONCLUSIVE, which this gate must never reach`);
    }
  } finally {
    for (const { root } of scenarios) rmSync(root, { recursive: true, force: true });
  }
});
