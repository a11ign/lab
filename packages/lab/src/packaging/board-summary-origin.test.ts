/**
 * THE 21:00 CHECK MUST ASK THE COPY THE 08:00 EDITION READS, which is `origin/main` and not the working
 * tree.
 *
 * `board-report.yml` checks out `ref: main` on a GitHub runner. A summary in somebody's working tree, or
 * on an unmerged branch, does not exist as far as the edition is concerned — and this check reported
 * *"the 08:00 edition will render"* on the strength of the local file. **Correct about what it examined,
 * and examining the wrong copy**: a gate that does not exercise what ships, where the thing that ships is
 * the version on `origin/main`.
 *
 * It cost twice in one evening (#91). A rewritten summary was committed locally and the push was refused
 * three times — a non-fast-forward, a worktree with no toolchain, and a genuine test failure — and each
 * time the check went on saying the edition would render. Separately a correction to a FALSE achievement
 * was pushed to a branch while `origin/main` kept the false sentence, caught only because somebody ran
 * `git show origin/main:...` by hand. **A person cannot be the backstop for this**: the failure is silent
 * and the check is reassuring.
 *
 * DRIVEN AGAINST THE PURE VERDICT, because the state this exists for — written locally, absent from
 * `origin/main` — is otherwise reachable only by arranging an unpushed commit at the moment the test
 * runs. The IO (`git fetch`, `git show`) stays in the script; every decision is here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { summaryVerdict } from "../../../../scripts/board-summary-check.mjs";

const DAY = "2026-09-07";
const OK = "a hand-written summary, well under the cap.";
const asked = (text: string | null) => ({ text, asked: true, why: "read from origin/main" });

test("present on origin/main and matching locally: the edition will render", () => {
  const v = summaryVerdict({ day: DAY, present: true, localText: OK, remote: asked(OK) });
  assert.equal(v.code, 0);
  assert.match(v.message, /on origin\/main.*will render/);
});

test("WRITTEN LOCALLY, ABSENT FROM origin/main: refused, naming the unpushed file", () => {
  // The defect this row exists for. The old check reported "will render" here.
  const v = summaryVerdict({ day: DAY, present: true, localText: OK, remote: asked(null) });
  assert.equal(v.code, 1, "a summary the edition cannot see must not read as one it can");
  assert.match(v.message, /working tree and NOT on origin\/main/);
  assert.match(v.message, /unpushed/, "the message must name the state, not just refuse");
  assert.match(v.message, /push it/, "and say what to do tonight");
});

test("PRESENT ON BOTH BUT DIFFERENT: refused, and it names both word counts", () => {
  // The second incident: a correction on a branch while origin/main kept the previous version. Both files
  // exist and both are non-empty, so only a comparison can tell them apart.
  const v = summaryVerdict({
    day: DAY, present: true, localText: "one two three four five", remote: asked(OK),
  });
  assert.equal(v.code, 1);
  assert.match(v.message, /is NOT the one in your working tree/);
  assert.match(v.message, /5 words local, 7 on origin\/main/,
    "a reader must see WHICH is which; 'they differ' sends them to diff it themselves");
});

test("over the cap ON origin/main is refused, and the count is the remote one", () => {
  // A local trim that was never pushed changes nothing about what the edition will refuse.
  const long = Array.from({ length: 121 }, (_, i) => `w${i}`).join(" ");
  const v = summaryVerdict({ day: DAY, present: true, localText: "short", remote: asked(long) });
  assert.equal(v.code, 1);
  assert.match(v.message, /121 words on origin\/main/);
});

test("COULD NOT FETCH is its own state, and it is never reported as fine", () => {
  // "I could not ask" and "it is not there" demand opposite responses, and only one of them is somebody's
  // fault. Collapsing them is this repo's oldest defect; a network blip must not read as a missing summary
  // and must certainly not read as a summary that will render.
  const v = summaryVerdict({
    day: DAY, present: true, localText: OK,
    remote: { text: null, asked: false, why: "could not fetch origin/main: no route to host" },
  });
  assert.equal(v.code, 2, "INCONCLUSIVE, distinct from both 0 and 1");
  assert.match(v.message, /CANNOT SAY/);
  assert.match(v.message, /could not fetch/, "it must carry WHY it could not ask");
});

test("absent everywhere falls through to the script's own write-one message", () => {
  // The pre-existing state, unchanged: the verdict returns no message and `main` prints the original
  // NO SUMMARY text and its --post comment. Pinned so the extraction cannot silently swallow it.
  const v = summaryVerdict({ day: DAY, present: false, localText: "", remote: asked(null) });
  assert.equal(v.code, 1);
  assert.equal(v.message, "", "an empty message is the signal to fall through, not a silent pass");
});

/**
 * AND THE WIRING, because a correct verdict handed the wrong input is the defect returning by its own
 * front door.
 *
 * Every test above drives `summaryVerdict` directly, which is what makes the four states reachable — and
 * it means none of them can see `main()` passing the LOCAL file as `remote`. That is not a hypothetical:
 * it is precisely what the script did before #91, and a mutation restoring it left all six green.
 *
 * So this asserts the connection rather than the decision. `main()` must obtain `remote` from
 * `summaryOnOriginMain`, and must not build it out of a `readFileSync` of the local path — which is the
 * one substitution that reproduces the original bug while every other check still passes.
 */
test("main() feeds the verdict the ORIGIN copy, not the local file", () => {
  const src = readFileSync(new URL("../../../../scripts/board-summary-check.mjs", import.meta.url), "utf8");
  const main = src.slice(src.indexOf("function main()"));
  assert.ok(main.length > 0, "main() not found -- this guard is reading the wrong thing");

  assert.match(main, /const remote = summaryOnOriginMain\(day\)/,
    "main() must read the summary from origin/main. The 08:00 edition renders from there, so a check "
    + "fed the working tree is correct about what it examined and examining the wrong copy -- which is "
    + "the whole of #91.");
  assert.doesNotMatch(main, /remote\s*=\s*\{[^}]*readFileSync\(file/,
    "main() must not construct `remote` from the local file: that is the pre-#91 behaviour exactly, and "
    + "the pure verdict cannot tell it apart because it is handed a well-formed object either way.");
  assert.match(main, /localText: present \? readFileSync\(file, "utf8"\) : ""/,
    "the LOCAL text is still read, and passed as localText -- it is what makes the two-copies-differ "
    + "state detectable at all. Only its ROLE changed: evidence for a comparison, never the verdict.");
});
