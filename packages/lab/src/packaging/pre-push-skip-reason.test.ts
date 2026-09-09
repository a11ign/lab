/**
 * A BYPASS NEEDS A REASON, AND THE REASON IS PRINTED.
 *
 * MEASURED 2026-09-09, by the session that maintains this hook. Nine pushes went out with a bare
 * `A11Y_SKIP_VERIFY=1`, because the hook takes minutes and the host was at load 15-35 with `mds_stores`
 * at 77%. It printed `SKIPPED by A11Y_SKIP_VERIFY=1 — nothing was verified.` every time, and that line
 * was scrolled past every time.
 *
 * Three of those pushes carried `tsc` errors THIS HOOK'S OWN `npm run typecheck` reports -- verified by
 * restoring one defect from a copy and running the hook's exact command, which exits 2 and names the
 * file. Two PRs sat BEHIND AND RED on the queue table as a result. **Four CI rounds and three red PRs,
 * for the minutes saved.**
 *
 * The guard existed, ran, covered the files, and said so. It did not stop the push because it had been
 * told not to -- which makes this a different failure from a guard that is wrong or missing, and the
 * remedy is different too. It is this repository's own recorded shape: A GUARD THAT ALREADY EXISTED, AND
 * A WEAKER CHECK SUBSTITUTED FOR IT -- three hand-rolled substitutes, wrong three times.
 *
 * So two things a reader cannot scroll past, matching `A11Y_STALE_BASE_REASON`, `A11Y_RESOLVE_REASON`
 * and `A11Y_PRIMARY_CHECKOUT_REASON`:
 *
 *   - THE LIST, by name. "nothing was verified" is true and abstract; "lint, typecheck, mjs parse check"
 *     is three specific things you are choosing not to do.
 *   - A REASON, required. A bare `=1` can be inherited from an exported variable, a wrapper script, or a
 *     habit from an hour ago. A sentence has to be written by whoever is pushing, now.
 *
 * DRIVES THE REAL, UNMODIFIED HOOK LOGIC, extracted between its own BEGIN/END markers -- never a
 * reimplementation, for the reason its siblings give: a second copy of a decision drifts from the first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HOOK_PATH = fileURLToPath(new URL("../../../../scripts/git-hooks/pre-push", import.meta.url));

/** The exact skip block, extracted between its own markers -- never retyped. */
function skipBlock(): string {
  const source = readFileSync(HOOK_PATH, "utf8");
  const match = /# BEGIN SKIP-VERIFY NEEDS A REASON\n([\s\S]*?)# END SKIP-VERIFY NEEDS A REASON/.exec(source);
  assert.ok(match, "expected the skip block bounded by its own markers in the pre-push hook");
  return match[1];
}

/**
 * `spawnSync`, never `execFileSync` -- the latter's success return is stdout ALONE, and every message
 * this block writes goes to `>&2`, including on the exit-0 path. The sentinel proves the block returned
 * control rather than the script having exited out of it.
 */
function runBlock(env: Record<string, string>): { status: number; stderr: string; reached: boolean } {
  const script = `set -euo pipefail\n${skipBlock()}\necho "REACHED_THE_REST_OF_THE_HOOK"\n`;
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return { status: r.status ?? -1, stderr: r.stderr, reached: (r.stdout ?? "").includes("REACHED_THE_REST") };
}

test("a bare A11Y_SKIP_VERIFY=1 is REFUSED, and the refusal lists what it would have skipped", () => {
  const { status, stderr, reached } = runBlock({ A11Y_SKIP_VERIFY: "1" });
  assert.equal(status, 1, "a bare =1 must not skip");
  assert.equal(reached, false, "and must not fall through into the rest of the hook either");
  assert.match(stderr, /no longer skips on its own/);
  for (const named of ["lint", "typecheck", "mjs parse check"]) {
    assert.match(stderr, new RegExp(named),
      `the refusal must NAME ${named} -- "nothing was verified" is what got scrolled past`);
  }
  assert.match(stderr, /A11Y_SKIP_VERIFY_REASON="<why>"/,
    "and must say exactly how to proceed deliberately -- a guard message has to be followable");
});

test("with a reason, it skips -- and prints BOTH the reason and the list of what did not run", () => {
  const { status, stderr, reached } = runBlock({
    A11Y_SKIP_VERIFY: "1",
    A11Y_SKIP_VERIFY_REASON: "docs-only change, verified by hand",
  });
  assert.equal(status, 0);
  assert.equal(reached, false, "skipping means skipping -- it must exit, not fall through");
  assert.match(stderr, /overridden: docs-only change, verified by hand/,
    "the reason is printed, not just the override, so it is in the log rather than in somebody's memory");
  assert.match(stderr, /lint, typecheck, mjs parse check and the corpus-gated checks did NOT run/);
});

test("a REASON with no A11Y_SKIP_VERIFY does nothing at all -- the reason is not itself an override", () => {
  const { status, reached } = runBlock({ A11Y_SKIP_VERIFY_REASON: "a leftover exported variable" });
  assert.equal(status, 0);
  assert.equal(reached, true, "the block must fall through to the real checks");
});

test("MUTATION TARGET: the pre-2026-09-09 block accepted a bare =1, which is the whole defect", () => {
  // Written out rather than described, so the difference is reproducible: this is what shipped, and it
  // is why nine pushes bypassed lint and typecheck without anyone deciding to.
  const old = `if [ "\${A11Y_SKIP_VERIFY:-0}" = "1" ]; then\n`
    + `  echo "pre-push: SKIPPED by A11Y_SKIP_VERIFY=1 — nothing was verified." >&2\n  exit 0\nfi\n`;
  const r = spawnSync("bash", ["-c", `set -euo pipefail\n${old}echo "REACHED"\n`], {
    encoding: "utf8", env: { PATH: process.env.PATH ?? "", A11Y_SKIP_VERIFY: "1" },
  });
  assert.equal(r.status, 0, "the old block skipped on a bare =1");
  assert.ok(!(r.stdout ?? "").includes("REACHED"));
  assert.ok(!/typecheck/.test(r.stderr ?? ""),
    "and never named what it was skipping -- one abstract sentence, scrolled past nine times");
});

test("the hook's own header documents the reason form, so the two cannot drift", () => {
  const source = readFileSync(HOOK_PATH, "utf8");
  assert.match(source, /A11Y_SKIP_VERIFY_REASON="<why>" A11Y_SKIP_VERIFY=1 git push/,
    "the usage line at the top must show the reason, or a reader copies the form that no longer works");
  assert.ok(!/^# {3}A11Y_SKIP_VERIFY=1 git push \.\.\.$/m.test(source),
    "and the bare form must not still be documented anywhere as the way to do it");
});
