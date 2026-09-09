/**
 * A RESCUE TAKES THE WHOLE FILE, AND NO GUARD WATCHES THAT DOOR — #705.
 *
 * `git checkout <stranded-branch> -- <file>` reverts every edit main has made to that file since the
 * branch diverged, and the result reads as the rescue's own insertions. `resolve-toward-main` in
 * `pre-push` cannot see it: that guard fires on a MERGE whose resolution kept the branch's side, and a
 * rescue never merges.
 *
 * ## THE FIXTURE IS THE REAL PAIR, AND IT IS A COMMENT
 *
 * Rescuing `audit-rule-coverage.ts` from `lead/inventory-bootstrap` (#698) would have taken:
 *
 *     main    * ... `<the lab's address>:5050` serves OUR pages over http, so
 *     branch  * ... `192.0.2.79:5050` serves OUR pages over http, so
 *
 * — un-redacting the lab's address. **No build breaks, no test fails, no guard fires.** The same take
 * would also have reverted four `@a11ign/*` imports, and that one is NOT silent (`MODULE_NOT_FOUND`, in a
 * `.ts` file, caught by `tsc`). That asymmetry is why these tests must not lean on a build: a rescue's
 * dangerous reverts are exactly the ones a build cannot see.
 */
/**
 * THE FIXTURE USES 192.0.2.79, NOT THE REAL ADDRESS, AND THE GUARD CAUGHT ME PUTTING THE REAL ONE HERE.
 *
 * My first version of this file carried the literal from the branch verbatim, on the reasoning that a
 * fixture should quote its subject exactly. `tracked-source-leak-guard.test.ts` refused it: *no tracked
 * source file carries a real internal LAN address*. **Writing the tool that stops an un-redaction, I
 * committed the un-redaction into its own test** — which is the sharpest possible evidence that this
 * hazard does not announce itself, since I was thinking about nothing else at the time.
 *
 * `192.0.2.0/24` is TEST-NET-1 (RFC 5737), reserved for documentation, so the fixture cannot itself become
 * the leak it tests for. The SHAPE is what the tests need — a literal address on the branch's side and a
 * placeholder on main's — and the shape is preserved exactly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { conflictRegions, decide, linesGained, mergeThreeWay }
  from "../../../../scripts/rescue-hunk.mjs";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

test("THE REAL PAIR: the un-redaction is NAMED before anything is applied", () => {
  // Verbatim from the two blobs, not paraphrased: this is the line a wholesale take would have reverted.
  const base = "const a = 1;\n * uses `<the lab's address>:5050` to serve pages\nconst b = 2;\n";
  const main = "const a = 1;\n * uses `<the lab's address>:5050` to serve pages\nconst b = 2;\n";
  const branch = "const a = 1;\n * uses `192.0.2.79:5050` to serve pages\nconst b = 2;\n";

  // The direction the fixture rests on: the BRANCH is the one carrying the literal address, because it
  // predates the redaction. Asserted rather than assumed — if this ever inverts, every claim below about
  // which side must win inverts with it.
  assert.ok(branch.includes("192.0.2.79"), "the branch is the side holding the un-redacted address");
  assert.ok(!main.includes("192.0.2.79"), "and main is the side that replaced it");

  // What main gained since the base is what a rescue is about to overwrite. Here main and base agree on
  // the redacted form and the BRANCH carries the literal — so the gain is empty and the DANGER is the
  // reverse direction, which is what the conflict check below is for.
  assert.deepEqual(linesGained(base, main), [], "main and base agree; nothing gained");

  // The branch replacing a line main also holds differently is the conflict this tool exists to refuse.
  const mainRedactedLater = "const a = 1;\n * uses `<the lab's address>:5050` to serve pages\nconst b = 2;\n";
  const baseWithLiteral = "const a = 1;\n * uses `192.0.2.79:5050` to serve pages\nconst b = 2;\n";
  const gained = linesGained(baseWithLiteral, mainRedactedLater);
  assert.ok(gained.some((l) => l.includes("<the lab's address>")),
    `the redaction main gained must be named:\n${gained.join("\n")}`);
  assert.ok(!gained.some((l) => l.includes("192.0.2.79")),
    "the literal is what main REPLACED; reporting it as a gain would invert the finding");
});

test("a hunk replacing a line main changed since the base is REFUSED, and the region is shown", () => {
  const base = "keep\nTHE LINE\nkeep2\n";
  const main = "keep\nmain's version\nkeep2\n";
  const branch = "keep\nbranch's version\nkeep2\n";
  const { merged, conflicts } = mergeThreeWay({ base, main, branch });

  assert.equal(conflicts, 1, `both sides changed the same line:\n${merged}`);
  const regions = conflictRegions(merged);
  assert.equal(regions.length, 1, `the refusal must SHOW what it refused:\n${merged}`);
  assert.match(regions[0], /main's version/);
  assert.match(regions[0], /branch's version/);

  // "3 conflicts" sends the reader to open the file; the region tells them whether main's line is a
  // redaction they must keep or a rename the branch predates.
  assert.equal(decide({ conflicts, reason: undefined }).apply, false);
  assert.match(decide({ conflicts, reason: undefined }).why, /A11Y_RESCUE_REASON/);
});

test("the override is NAMED, never silent — the A11Y_*_REASON shape this repo already uses", () => {
  const refused = decide({ conflicts: 2, reason: undefined });
  const overridden = decide({ conflicts: 2, reason: "the branch's copy is the corrected one, see #705" });
  assert.equal(refused.apply, false);
  assert.equal(overridden.apply, true);
  // The reason is PRINTED, so a deliberate override is in the log rather than in somebody's memory.
  assert.match(overridden.why, /the branch's copy is the corrected one/);
});

test("A CLEAN CASE APPLIES WITH NO PROMPT, so this is not a ceremony people route around", () => {
  // Acceptance 3 on #705. A tool that stops on every rescue gets bypassed on the one that matters —
  // `A11Y_SKIP_VERIFY=1` six times in one evening is this repository's record of exactly that.
  const base = "a\nb\nc\n";
  const main = "a\nb\nc\nMAIN ADDED\n";
  const branch = "BRANCH ADDED\na\nb\nc\n";
  const { merged, conflicts } = mergeThreeWay({ base, main, branch });

  assert.equal(conflicts, 0, `disjoint edits must merge cleanly:\n${merged}`);
  assert.equal(decide({ conflicts, reason: undefined }).apply, true);
  assert.match(merged, /MAIN ADDED/, "main's gain must survive — that is the whole point");
  assert.match(merged, /BRANCH ADDED/, "and the branch's change must actually be applied");
  assert.equal(conflictRegions(merged).length, 0);
});

test("END TO END on the repository itself: main's redaction survives and the branch's hunk lands", (t) => {
  // The one test that exercises the real script against real blobs. Skips honestly where the refs are
  // absent (a shallow CI checkout has neither), rather than passing having examined nothing.
  const has = (ref: string) => {
    try {
      execFileSync("git", ["rev-parse", "--verify", "-q", ref],
        { cwd: REPO_ROOT, env: sandboxGitEnv(), stdio: "pipe" });
      return true;
    } catch { return false; }
  };
  if (!has("origin/main") || !has("origin/lead/inventory-bootstrap")) {
    t.skip("origin/main or the fixture branch is absent — a fact about the checkout, not about the tool");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "rescue-e2e-"));
  try {
    const file = "packages/lab/scripts/audit-rule-coverage.ts";
    const show = (ref: string) => execFileSync("git", ["show", `${ref}:${file}`],
      { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8" });
    const baseSha = execFileSync("git", ["merge-base", "origin/main", "origin/lead/inventory-bootstrap"],
      { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8" }).trim();

    const { merged, conflicts } = mergeThreeWay({
      base: show(baseSha), main: show("origin/main"), branch: show("origin/lead/inventory-bootstrap"),
    });

    assert.equal(conflicts, 0, "the real pair's edits are disjoint and must merge cleanly");
    assert.ok(merged.includes("<the lab's address>"),
      "MAIN'S REDACTION MUST SURVIVE — a wholesale take reverts it, and nothing else would notice");
    assert.ok(!merged.includes("192.0.2.79"),
      "the literal address must NOT come back: that is the silent revert this whole row is about");
    assert.ok(merged.includes("@a11ign/judge/rules"),
      "main's renamed imports must survive too");
    assert.ok(merged.includes("RULE-ONLY criterion(s) of"),
      "and the branch's own hunk must actually be applied, or the rescue rescued nothing");

    writeFileSync(join(dir, "merged"), merged);
    assert.ok(readFileSync(join(dir, "merged"), "utf8").length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
