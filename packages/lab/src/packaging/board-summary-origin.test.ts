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

import { summaryVerdict, reportedVerdict, reportedDifferences }
  from "../../../../scripts/board-summary-check.mjs";

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
 * THE SAME QUESTION OF `reported.json`, WHICH CARRIES MORE (#131).
 *
 * The summary is one hand-written paragraph. `docs/board/reported/` holds every number the document
 * quotes that no gate can recompute — the gate outputs, the fleet-hours figure, the capacity note, every
 * achievement — and it had the identical gap. Three times on 2026-09-06 a correct, complete record sat on
 * the wrong side of a merge: a corrected achievement replacing one that had become FALSE, #22's
 * pre-registered median, and the refreshed real-page gate output. Each was found by a person running
 * `git show origin/main:...` by hand; none by a tool.
 */
const REPORTED = "docs/board/reported";
const record = (over: object = {}) => JSON.stringify({
  staleAfterHours: 24,
  gates: [{ command: "npm run rules:real-pages", output: "PASS — 84 of 84" }],
  achievements: [{ issue: 42, claim: "the scorer abstains out of support" }],
  fleetHours: { status: "reported", note: "54.11 worker-hours" },
  ...over,
});

test("an unmodified record reports agreement in ONE line and says nothing else", () => {
  // Or the line becomes noise everybody scrolls past, and the one night it matters it is scrolled past too.
  const v = reportedVerdict({ localText: record(), remote: asked(record()) });
  assert.equal(v.code, 0);
  assert.equal(v.message, `recorded figures: ${REPORTED} matches origin/main.`);
  assert.equal(v.message.split("\n").length, 1, "agreement is one line; only a difference earns detail");
});

test("EDITED LOCALLY AND NOT PUSHED: named by entry, with the command to see what publishes", () => {
  // The defect this row exists for, and the state an author is actually in at 21:00.
  const mine = record({ gates: [{ command: "npm run rules:real-pages", output: "PASS — 80 of 84" }] });
  const v = reportedVerdict({ localText: mine, remote: asked(record()) });
  assert.equal(v.code, 1, "a figure the edition cannot see must not read as one it can");
  assert.match(v.message, /gates\[npm run rules:real-pages\] — differs/,
    "naming the ENTRY is the point; 'the file differs' sends a reader to diff it themselves at 21:00");
  assert.match(v.message, new RegExp(`git show origin/main:${REPORTED}`),
    "and it must print the command that shows what will actually publish");
});

test("an entry added locally, and one only on origin/main, are different sentences", () => {
  // "I wrote something that will not publish" and "something will publish that I have not got" need
  // opposite responses, so they must never share a word.
  const extra = { issue: 99, claim: "a new achievement, unpushed" };
  const mine = JSON.parse(record()); mine.achievements.push(extra);
  const v = reportedVerdict({ localText: JSON.stringify(mine), remote: asked(record()) });
  assert.match(v.message, /achievements\[99\] — in your tree, NOT on origin\/main/);

  const other = reportedVerdict({ localText: record(), remote: asked(JSON.stringify(mine)) });
  assert.match(other.message, /achievements\[99\] — on origin\/main, NOT in your tree/);
});

test("INSERTING AN ENTRY DOES NOT RE-LABEL THE ONES AFTER IT", () => {
  // Position-keyed identity is the defect `withRealisticScale` already paid for: inserting one case
  // re-keyed every case after it. Here it would report the whole list as changed for one added gate, and
  // the real difference would be one line in a wall of noise -- a report nobody reads is a report.
  const remote = record({
    gates: [{ command: "gate:a", output: "A" }, { command: "gate:b", output: "B" }],
  });
  const local = record({
    gates: [{ command: "gate:new", output: "N" }, { command: "gate:a", output: "A" },
      { command: "gate:b", output: "B" }],
  });
  const differences = reportedDifferences(local, remote);
  assert.deepEqual(differences, ["gates[gate:new] — in your tree, NOT on origin/main"],
    "exactly one difference: the entry that was added. `gate:a` and `gate:b` moved position and did not "
    + "change, so neither is a finding.");
});

test("a reformat is not a finding: key order and indentation are not values", () => {
  // The edition reads values. Reporting whitespace would train people to ignore the line, which costs
  // more than the check is worth.
  //
  // NOTE THE TRAP THIS TEST WALKED INTO FIRST, since it is the reason the assertion is written this way:
  // `JSON.stringify(v, keys, 4)` treats its second argument as a key ALLOWLIST, and it applies at every
  // depth -- so "reversing the top-level key order" silently emptied every nested object and built a
  // genuinely different document. The guard correctly reported five differences and the TEST was wrong,
  // which is the right way round.
  const remote = record();
  const parsed = JSON.parse(remote);
  const reordered = JSON.stringify(
    Object.fromEntries(Object.keys(parsed).reverse().map((k) => [k, parsed[k]])), null, 4);
  assert.notEqual(reordered, remote, "the two spellings must really differ as TEXT, or this proves nothing");
  assert.deepEqual(reportedDifferences(reordered, remote), []);
});

test("the record missing from origin/main entirely is its own state", () => {
  // Every figure unpublished at once, and the edition prints `not reported` for each. That is a different
  // sentence from "one entry differs" and needs a different action.
  const v = reportedVerdict({ localText: record(), remote: asked(null) });
  assert.equal(v.code, 1);
  assert.match(v.message, /NOT on origin\/main at all/);
  assert.match(v.message, /Push it/);
});

test("COULD NOT FETCH is inconclusive for the record too, and never reported as fine", () => {
  const v = reportedVerdict({
    localText: record(),
    remote: { text: null, asked: false, why: "could not fetch origin/main: no route to host" },
  });
  assert.equal(v.code, 2);
  assert.match(v.message, /CANNOT SAY/);
  assert.match(v.message, /could not fetch/, "it must carry WHY it could not ask");
});

test("unreadable JSON is reported as unreadable, not as every entry differing", () => {
  // Diffing against a parse failure yields a true statement -- everything differs -- that hides the one
  // fact worth acting on. A count is where an investigation stops.
  const differences = reportedDifferences("{ not json", record());
  assert.equal(differences.length, 1, "one cause, one line -- not one line per entry");
  assert.match(differences[0], /your tree.*is not valid JSON/);
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

test("main() feeds the RECORD's verdict the origin copy too, and asks whatever the summary said", () => {
  // The identical substitution, one file along: handing `reportedVerdict` a local read as `remote` makes
  // it answer confidently about the wrong copy, and every pure test above still passes -- they are handed
  // a well-formed object either way. #91's own wiring guard exists because that is not hypothetical.
  const src = readFileSync(new URL("../../../../scripts/board-summary-check.mjs", import.meta.url), "utf8");
  const main = src.slice(src.indexOf("function main()"));

  // #159: the record is a DIRECTORY, and `git show origin/main:<dir>` returns a tree listing rather
  // than content -- so a port that kept `fileOnOriginMain` would have compared two listings and
  // reported nothing when an entry's CONTENT moved. The property is unchanged and the reader is not.
  assert.match(main, /dirOnOriginMain\(REPORTED\)/,
    "the record must be read from origin/main, which is the only copy the 08:00 job sees");
  assert.doesNotMatch(main, /remote:\s*\{[^}]*readFileSync\(reportedFile/,
    "and must never be constructed from the local file -- the pre-#91 shape, reached by a second door");

  // ASKED ON BOTH PATHS. A missing summary does not make an unpushed gate result any less unpushed, and
  // an early `process.exit` before the record is reported is exactly how the second fact stays invisible.
  const beforeNoSummary = main.slice(0, main.indexOf("NO SUMMARY FOR"));
  assert.ok(/const reported = reportedVerdict\(/.test(beforeNoSummary),
    "the record's verdict must be computed before either path exits, or the no-summary path reports "
    + "nothing about the figures -- which is the half of #131 that carries the numbers.");
  assert.equal((main.match(/reported\.code === EXIT\.WILL_RENDER/g) ?? []).length, 2,
    "both exit paths print it: the one where a summary exists, and the one where none does");
});

/* THE ONE PIECE OF #159 THAT NOTHING RAN.
 *
 * Every test above hands `reportedDifferences` hand-built JSON STRINGS, which is right for what they
 * check -- the entry-identity property, position-insensitivity, reformat-is-not-a-finding. But the
 * directory-to-object reconstruction those strings stand in for is the only genuinely new code in the
 * migration, and the sole thing validating it was a source-regex asserting `main()` mentions
 * `dirOnOriginMain`.
 *
 * A REGEX OVER SOURCE TEXT IS NOT A TEST OF BEHAVIOUR -- this repository's own rule, and it has already
 * paid for it: a signal-type scrape once asserted over an empty set and passed. Renaming a kind, changing
 * the layout under `reported/`, or breaking the order sort would leave that wiring assertion green.
 *
 * Found in review by `worker-audit`, who traced the chain end to end and noticed that the middle link
 * was the untested one.
 */
test("assembleReported rebuilds the pre-migration object from a directory", async () => {
  const { assembleReported } = await import("../../../../scripts/board-summary-check.mjs");
  const files = new Map([
    ["docs/board/reported/meta.json", JSON.stringify({ staleAfterHours: 24, fleetHours: { total: "1 h" } })],
    ["docs/board/reported/gates/b.json", JSON.stringify({ command: "second", order: 20 })],
    ["docs/board/reported/gates/a.json", JSON.stringify({ command: "first", order: 10 })],
    ["docs/board/reported/achievements/x.json", JSON.stringify({ issue: 7, order: 10 })],
  ]);
  const built = assembleReported((rel: string) => files.get(rel) ?? null, [...files.keys()]);

  // ORDER, NOT FILENAME. `b.json` sorts before `a.json` alphabetically and must come second, because the
  // authored order is what the document renders in and it is not the filename's business.
  assert.deepEqual(built.gates.map((g: { command: string }) => g.command), ["first", "second"],
    "entries must come back in their authored order, not the order the filesystem lists them");
  assert.deepEqual(built.achievements.map((a: { issue: number }) => a.issue), [7]);
  assert.equal(built.staleAfterHours, 24, "meta.json's scalars must survive into the assembled object");
  assert.deepEqual(built.fleetHours, { total: "1 h" });

  // A KIND WITH NO FILES IS AN EMPTY LIST, NEVER ABSENT: a caller reading `.gates` must not get
  // `undefined` and treat it as "no gates recorded" versus "the key is missing" — two states, one
  // reading, and this repo has paid for that conflation more than once.
  const empty = assembleReported(() => null, []);
  assert.deepEqual(empty.gates, []);
  assert.deepEqual(empty.achievements, []);

test("statedWritingTime: a summary with no stated time returns null -- the guard's failing case, driven directly", async () => {
  const { statedWritingTime } = await import("../../../../scripts/board-summary-check.mjs");
  // THE STYLE TEST READS TODAY'S SUMMARY, so before the rule's effective date it returns early and its
  // assertion is never exercised. This drives the same function with fixtures, which is what makes the
  // freshness check a verified guard rather than one that has only ever been seen to pass.
  assert.equal(statedWritingTime("Written overnight, so this is a forecast.", "07:45"), null);
  assert.deepEqual(statedWritingTime("Written at 07:30 on 8 September.", "07:45"),
    { stated: "07:30", driftMinutes: 15 });
  assert.equal(statedWritingTime("Written at 07:30 on 8 September.", "09:00")?.driftMinutes, 90);
});
