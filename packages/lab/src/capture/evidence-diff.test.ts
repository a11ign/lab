// The tool that decides whether a capture optimisation costs a 2,122-capture recapture. If it says
// "safe" when evidence changed, a whole corpus silently becomes a mix of two pipelines — so the tests
// below are mostly about it refusing to say "safe".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareCapture, summarise, readCapture, isUsableCapture } from "./evidence-diff.mjs";

const capture = (over: Record<string, unknown> = {}) => ({
  transcript: ["heading, level 1, Museum 004 controls", "Print this report"],
  structure: {
    headings: ["Museum 004 controls, heading, level 1"], landmarks: [], formFields: ["Print this report, button"],
    tableCells: [], links: [], lists: [], graphics: [],
  },
  interaction: { controls: ["Print this report, button"], stateChanges: [], formChanges: [], postSubmitFields: [], focusOrder: [] },
  ...over,
});

test("an identical capture is SAME", () => {
  assert.equal(compareCapture(capture(), capture()).verdict, "SAME");
});

test("wording NVDA varies — case and whitespace — is not a difference", () => {
  const noisy = capture({ transcript: ["Heading, level 1,   Museum 004 controls", "Print this report"] });
  assert.equal(compareCapture(capture(), noisy).verdict, "SAME");
});

test("phrases heard in a different order are SAME, not a change", () => {
  // A capture is allowed to hear the same things in a different order; it is not allowed to stop
  // hearing them. That is why the transcript is compared as a set.
  const reordered = capture({ transcript: ["Print this report", "heading, level 1, Museum 004 controls"] });
  assert.equal(compareCapture(capture(), reordered).verdict, "SAME");
});

test("a lost transcript phrase is DRIFT, and the phrase is named", () => {
  const shorter = capture({ transcript: ["heading, level 1, Museum 004 controls"] });
  const result = compareCapture(capture(), shorter);
  assert.equal(result.verdict, "DRIFT");
  assert.deepEqual(result.phrases.lost, ["print this report"]);
});

test("a lost heading is CHANGED — signals read that field", () => {
  const stripped = capture({
    structure: { ...capture().structure, headings: [] },
  });
  const result = compareCapture(capture(), stripped);
  assert.equal(result.verdict, "CHANGED");
  assert.equal(result.changes[0].field, "structure.headings");
  assert.deepEqual(result.changes[0].lost, ["museum 004 controls, heading, level 1"]);
});

test("a control that stopped being found is CHANGED — this is the custom-control signal", () => {
  const noControls = capture({
    interaction: { ...capture().interaction, controls: [] },
  });
  assert.equal(compareCapture(capture(), noControls).verdict, "CHANGED");
});

test("a GAINED field value is CHANGED too — absence is evidence in this corpus", () => {
  // custom-control's bad pages prove a 4.1.2 failure by finding NO controls. A change that starts
  // finding one destroys the case just as surely as losing one.
  const extra = capture({
    interaction: { ...capture().interaction, controls: ["Print this report, button", "Cancel, button"] },
  });
  const result = compareCapture(capture(), extra);
  assert.equal(result.verdict, "CHANGED");
  assert.deepEqual(result.changes[0].gained, ["cancel, button"]);
});

test("one CHANGED capture forces a recapture, however many were SAME", () => {
  const results = [
    { comparison: compareCapture(capture(), capture()) },
    { comparison: compareCapture(capture(), capture({ structure: { ...capture().structure, headings: [] } })) },
  ];
  const summary = summarise(results);
  assert.equal(summary.evidenceChanged, true);
  assert.match(summary.recommendation, /bump CAPTURE_PROTOCOL_VERSION and recapture/i);
});

test("an all-SAME sample clears the change to ship without invalidating the cache", () => {
  const results = [1, 2, 3].map(() => ({ comparison: compareCapture(capture(), capture()) }));
  const summary = summarise(results);
  assert.equal(summary.evidenceChanged, false);
  assert.match(summary.recommendation, /safe to ship WITHOUT invalidating/);
});

test("widespread drift is not waved through as NVDA variance", () => {
  const drifted = capture({ transcript: ["heading, level 1, Museum 004 controls"] });
  const results = [1, 2, 3].map(() => ({ comparison: compareCapture(capture(), drifted) }));
  const summary = summarise(results);
  assert.equal(summary.evidenceChanged, false, "drift is not a field change");
  assert.equal(summary.driftIsWidespread, true);
  assert.match(summary.recommendation, /re-run to separate NVDA variance/);
});

test("a capture the pipeline would reject is excluded, not counted as a change", () => {
  // Diffing a capture a real run would throw away blames the change for a bad guest. The run answers
  // a rejected capture by retrying; this tool answers it by not drawing a conclusion.
  const results = [
    { comparison: compareCapture(capture(), capture()) },
    { comparison: { verdict: "REJECTED", changes: [], phrases: null } as never },
  ];
  const summary = summarise(results);
  assert.equal(summary.evidenceChanged, false);
  assert.equal(summary.compared, 1, "rejected captures must leave the denominator");
  assert.match(summary.recommendation, /1 capture\(s\) were rejected/);
});

test("rejected captures do not drag the drift share around", () => {
  // One drift out of one comparison is widespread; three rejects alongside it must not dilute that.
  const drifted = capture({ transcript: ["heading, level 1, Museum 004 controls"] });
  const results = [
    { comparison: compareCapture(capture(), drifted) },
    ...[1, 2, 3].map(() => ({ comparison: { verdict: "REJECTED", changes: [], phrases: null } as never })),
  ];
  assert.equal(summarise(results).driftIsWidespread, true);
});

test("comparing NOTHING is not a pass", () => {
  // `evidenceChanged` is `counts.CHANGED > 0`, which is false when nothing was compared at all —
  // so a run in which every capture failed reported "evidence unchanged — safe to ship" and exited
  // 0. Observed on the first bare-metal worker: 48 of 48 captures failed with EHOSTUNREACH because
  // the box had gone to sleep, and this said the evidence was fine.
  //
  // The guard is asserted from BOTH directions, because the version that only checked the happy
  // path is what let this through: an empty run must not pass, and an ordinary one must not now
  // be flagged as empty.
  const empty = summarise([]);
  assert.equal(empty.compared, 0);
  assert.equal(empty.examinedNothing, true, "zero comparisons must be reported as unexamined");
  assert.match(empty.recommendation, /NOTHING WAS COMPARED — this is not a pass/);

  const allFailed = summarise(
    [1, 2, 3].map(() => ({ comparison: { verdict: "REJECTED", changes: [], phrases: null } as never })),
  );
  assert.equal(allFailed.compared, 0, "rejects leave the denominator, so this is still zero");
  assert.equal(allFailed.examinedNothing, true, "a sample that was entirely rejected examined nothing");

  const real = summarise([{ comparison: compareCapture(capture(), capture()) }]);
  assert.equal(real.examinedNothing, false, "a genuine comparison must not be called unexamined");
  assert.match(real.recommendation, /evidence unchanged/);
});

test("partial coverage is inconclusive, not a pass", () => {
  // The guard above fixed the extreme case and left the middle open, and the middle is what happened.
  // Measured 2026-08-21: a concurrent run stopped the page server two captures into a 48-capture check, and
  // this reported "2 compared: 2 same ... evidence unchanged — safe to ship WITHOUT invalidating the cache"
  // and exited 0. The skip note was printed and accurate; the verdict above it still said ship.
  //
  // The sample is stratified one case per family, so an uncompared capture is a family with no opinion
  // attached -- while the question being answered is "may I keep 2,122 cached captures?".
  const same = () => ({ comparison: compareCapture(capture(), capture()) });
  const skipped = () => ({ comparison: { verdict: "SKIPPED", changes: [], phrases: null } as never });

  const partial = summarise([same(), same(), ...Array.from({ length: 46 }, skipped)]);
  assert.equal(partial.compared, 2);
  assert.equal(partial.attempted, 48, "skipped captures stay in the denominator — they were asked for");
  assert.equal(partial.inconclusive, true, "2 of 48 must never read as a verdict");
  assert.match(partial.recommendation, /INCONCLUSIVE — only 2 of 48/);
  assert.doesNotMatch(partial.recommendation, /safe to ship/,
    "the exact sentence that made this dangerous");

  // And the other direction, because a guard only checked on the failing path is how the first one
  // shipped half-done: a fully compared sample must still be able to pass.
  const full = summarise(Array.from({ length: 6 }, same));
  assert.equal(full.coverage, 1);
  assert.equal(full.inconclusive, false, "full coverage must still be shippable");
  assert.match(full.recommendation, /evidence unchanged/);
});

test("a capture that FAILED must count against coverage, not vanish from it", () => {
  // The failure path left no result at all, so a failed capture disappeared from the denominator rather than
  // reducing coverage. Measured 2026-08-22: one worker answered "NVDA is running but not speaking", that
  // case's second variant was never attempted, and the verdict read "46 compared: 46 same ... safe to ship"
  // — complete coverage of a sample two smaller than the one asked for.
  //
  // This is the same shape as the SKIPPED hole closed the day before, arriving by the path that never
  // reaches `results`. REJECTED is the right home: counted in `attempted`, excluded from `compared`, so the
  // coverage rule reports INCONCLUSIVE rather than a verdict.
  const same = () => ({ comparison: compareCapture(capture(), capture()) });
  const unusable = () => ({ comparison: { verdict: "REJECTED", changes: [], phrases: null } as never });

  const partial = summarise([...Array.from({ length: 46 }, same), unusable(), unusable()]);
  assert.equal(partial.compared, 46);
  assert.equal(partial.attempted, 48, "a capture that could not be made was still asked for");
  assert.equal(partial.inconclusive, true, "46 of 48 is not a verdict");
  assert.doesNotMatch(partial.recommendation, /safe to ship/);
});

/**
 * `readCapture`/`isUsableCapture` are the shared answer to a question four modules used to answer
 * differently (audit §9) — check-signals.mjs, export-screenreader-dataset.mjs, capture-cache.mjs and
 * capture-resume.mjs all import these now instead of keeping their own copy.
 */
test("readCapture: a missing file is null, never an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-diff-"));
  try {
    assert.equal(readCapture(dir, "no-such-case", "good"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readCapture: a malformed file THROWS naming the path, never silently reads as absent", () => {
  // MUTATION TARGET: two of the four original copies had no try/catch at all (a bare, path-less
  // SyntaxError crashed the whole run); one swallowed this to null (indistinguishable from "never
  // captured"). Both are wrong for a torn write, which is a real data-integrity fault.
  const dir = mkdtempSync(join(tmpdir(), "evidence-diff-"));
  try {
    const path = join(dir, "broken.bad.json");
    writeFileSync(path, "{ not json");
    assert.throws(() => readCapture(dir, "broken", "bad"), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /broken\.bad\.json/, "the error must name the file, not just the failure");
      assert.ok((e as Error & { cause?: unknown }).cause instanceof Error, "the parse error survives as `cause`");
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readCapture: a well-formed file round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-diff-"));
  try {
    writeFileSync(join(dir, "ok.good.json"), JSON.stringify({ screenReader: "NVDA", transcript: ["hi"] }));
    assert.deepEqual(readCapture(dir, "ok", "good"), { screenReader: "NVDA", transcript: ["hi"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isUsableCapture: NVDA plus a non-empty transcript is the only shape that passes", () => {
  assert.equal(isUsableCapture({ screenReader: "NVDA", transcript: ["a"] }), true);
});

test("isUsableCapture: no screenReader field at all is NOT usable", () => {
  // The exact gap `export-screenreader-dataset.mjs`'s old `usableCapture` had: this alone used to read as
  // usable there while capture-cache.mjs and capture-resume.mjs both refused it.
  assert.equal(isUsableCapture({ transcript: ["a"] }), false);
});

test("isUsableCapture: a non-NVDA screen reader is NOT usable", () => {
  assert.equal(isUsableCapture({ screenReader: "VoiceOver", transcript: ["a"] }), false);
});

test("isUsableCapture: an empty transcript is NOT usable, even with NVDA set", () => {
  assert.equal(isUsableCapture({ screenReader: "NVDA", transcript: [] }), false);
});

test("isUsableCapture: null (readCapture's own 'absent' answer) is NOT usable", () => {
  assert.equal(isUsableCapture(null), false);
});

test("a timing-only difference is NOT an evidence change", () => {
  // MEASURED 2026-09-06 on the run meant to decide whether three probe fixes moved the evidence:
  // `48 compared: 42 same, 0 drift, 6 changed`, and all six were form cases whose ONLY differing key was
  // `baselineWaitedMs` — 300->320, 324->308, 316->300, 324->311, 323->300, 313->300. The verdict was
  // CHANGED and the evidence was identical. Verbatim from `custom-control-role.good`'s stored diff.
  const before = { control: "save notification settings, button", kind: "submit", after: "",
    baselineQuiet: true, baselineWaitedMs: 300 };
  const after = { ...before, baselineWaitedMs: 320 };
  assert.equal(compareCapture(
    { interaction: { formChanges: [before] } },
    { interaction: { formChanges: [after] } },
  ).verdict, "SAME", "a wall-clock wait differs on every capture of every page; it is a property of the "
    + "run, not of the page, and comparing it makes an entry unequal to itself");
});

test("a CONTENT difference in the same entry is still caught", () => {
  // The half that stops the exclusion becoming the defect it fixes. `flatten` exists because this gate
  // compared object lists BY COUNT and reported SAME when an error message vanished; narrowing what it
  // compares must not reopen that. Same entry, same timing, only `after` moves — the exact 2026-09-01
  // case, whose stored example is an error message becoming empty.
  const before = { control: "Send, button", kind: "submit", after: "Error: name is required",
    baselineQuiet: true, baselineWaitedMs: 300 };
  assert.equal(compareCapture(
    { interaction: { formChanges: [before] } },
    { interaction: { formChanges: [{ ...before, after: "" }] } },
  ).verdict, "CHANGED", "the content of the channel 3.3.1, 4.1.2 and 4.1.3 are decided from must still "
    + "be compared — this is the defect `flatten` was written for");
});

test("the exclusion list is a DENY-list, so a new field defaults to being compared", () => {
  // An allow-list would make this gate go quietly blind to every field added after it was written, which
  // is the original defect wearing the remedy's clothes. A field nobody has classified must be COMPARED.
  const before = { control: "x", kind: "submit", after: "", baselineWaitedMs: 300 };
  assert.equal(compareCapture(
    { interaction: { formChanges: [before] } },
    { interaction: { formChanges: [{ ...before, somethingNewNobodyClassified: "b" }] } },
  ).verdict, "CHANGED", "an unclassified new key must register as a change, not be ignored");
});

test("a focus log differing ONLY in timestamps is not an evidence change", () => {
  // MEASURED 2026-09-06: `gate:stability` FAILED with `VARIES focusEvents counts 5,5,5,5,5` — identical
  // counts, differing content — on `image-missing-alt-behind-consent/good` and `nls.uk/join/`. Exactly TWO
  // canaries declare `probeFocus: true`, and exactly those two failed. 2 of 2, which is what makes it a
  // wall-clock field rather than page nondeterminism: real flakiness would have to be uncannily unlucky to
  // hit both and nothing else.
  const log = [
    { type: "focusin", id: 0, name: "Contact name", atMs: 3211 },
    { type: "focusout", id: 0, name: "Contact name", atMs: 5161 },
  ];
  const later = log.map((e) => ({ ...e, atMs: e.atMs + 37 }));
  assert.equal(compareCapture(
    { interaction: { focusEvents: { asked: true, checked: true, log } } },
    { interaction: { focusEvents: { asked: true, checked: true, log: later } } },
  ).verdict, "SAME", "every capture starts its clock afresh, so comparing `atMs` makes the log unequal "
    + "to itself on every run");
});

test("a focus log differing in WHO or ORDER is still caught", () => {
  // The half that stops the exclusion becoming the defect it fixes. `focusLossEvidence` decides 2.4.7 from
  // this log by pairing adjacent entries — it computes `heldMs` from DIFFERENCES, never from an absolute
  // value — so excluding `atMs` hides nothing a rule reads, and identity and sequence must still register.
  const log = [
    { type: "focusin", id: 0, name: "Contact name", atMs: 3211 },
    { type: "focusout", id: 0, name: "Contact name", atMs: 5161 },
  ];
  const renamed = [log[0], { ...log[1], name: "Something else" }];
  assert.equal(compareCapture(
    { interaction: { focusEvents: { asked: true, checked: true, log } } },
    { interaction: { focusEvents: { asked: true, checked: true, log: renamed } } },
  ).verdict, "CHANGED", "a control that stopped receiving focus must still register");

  const reordered = [log[1], log[0]];
  assert.equal(compareCapture(
    { interaction: { focusEvents: { asked: true, checked: true, log } } },
    { interaction: { focusEvents: { asked: true, checked: true, log: reordered } } },
  ).verdict, "CHANGED", "ORDER is the whole of F55's signature — an orphaned focusout is defined by what "
    + "precedes it — so a reordered log must never read as SAME");
});
