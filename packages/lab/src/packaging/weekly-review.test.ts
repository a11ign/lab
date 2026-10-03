// no-token: TITLE_PREFIX -- every test drives pure functions over injected data; TITLE_PREFIX is only the expected title string, and nothing here spawns `gh`.
/**
 * THE WEEKLY OUTSIDER REVIEW'S FILING (#3183): the judgement half of the V1 rehearsal, filed by a schedule and
 * never a gate.
 *
 * Every decision is a pure function over data its caller reads, so nothing here touches the network. Each
 * refusal has a test that fails before the change, and each emptiness assertion sits beside the fixture that
 * is its positive control.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { fileRefusalReason } from "agent-org/src/row-file.mjs";
import {
  TITLE_PREFIX, bodyReadFromSources, buildBody, eligible, extractQuestions, extractRequirements, filingPlan,
  ineligibleFromBody, ineligibleSessions, isoWeek, isoWeekLabel, recheckLastWeek, reviewTitle, reviewWindow,
} from "../../../../scripts/weekly-review.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");
const RELEASE = read("RELEASE.md");
const TRY_IT = read("docs/try-it.md");

const FIXTURE_RELEASE = [
  "**Two requirements, and both must hold:**",
  "",
  "1. **A stranger runs it.** Somebody who built nothing",
  "   reads the output.",
  "2. **Only the public documents.** Nothing else.",
  "",
  "**Most recent rehearsal:** never.",
].join("\n");
const FIXTURE_TRY_IT = ["## What we would like back", "", "1. **Did it see the page?** Look at the counts.",
  "2. **Was it worth the minutes?**", "", "And, whenever it happens: where did you get stuck?"].join("\n");

const NOON = (iso: string) => new Date(`${iso}T12:00:00Z`);
const input = (over: Record<string, unknown> = {}) => ({
  label: "2026-W40", window: { since: "2026-09-26", until: "2026-10-03" }, closedCount: 1, builders: ["worker-1"],
  unattributed: [], requirements: extractRequirements(FIXTURE_RELEASE), questions: extractQuestions(FIXTURE_TRY_IT),
  commit: "abc1234", waitsOnOutsiderRepo: false, ...over,
});

// ---- 1. the week, and the filing is idempotent ------------------------------------------------------------

test("the ISO week is right at the year boundary", () => {
  assert.deepEqual(isoWeek(NOON("2026-12-31")), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek(NOON("2027-01-01")), { year: 2026, week: 53 }); // a Friday: its Thursday is in 2026
  assert.deepEqual(isoWeek(NOON("2027-01-04")), { year: 2027, week: 1 });
  assert.equal(isoWeekLabel(NOON("2026-10-03")), "2026-W40");
});

test("a list already holding this week's title files nothing; an empty list files exactly one", () => {
  const date = NOON("2026-10-05");
  const filed = filingPlan({ date, existingTitles: ["unrelated", reviewTitle(date)] });
  assert.equal(filed.file, false);
  assert.match(filed.reason, /already filed/);
  const control = filingPlan({ date, existingTitles: [] });
  assert.equal(control.file, true);
  assert.equal(control.title, `${TITLE_PREFIX} 2026-W41`);
  assert.equal(filingPlan({ date, existingTitles: ["Weekly outsider review 2026-W40"] }).file, true);
});

test("the window is the seven days ending at the run", () => {
  assert.deepEqual(reviewWindow(NOON("2026-10-05")), { since: "2026-09-28", until: "2026-10-05" });
});

// ---- 2. the body is READ from the two documents ------------------------------------------------------------

test("a reworded requirement appears reworded in the body, and wrapped lines are joined", () => {
  const before = extractRequirements(FIXTURE_RELEASE);
  assert.equal(before[0].text, "**A stranger runs it.** Somebody who built nothing reads the output.");
  const reworded = extractRequirements(FIXTURE_RELEASE.replace("A stranger runs it", "A newcomer runs it"));
  const body = buildBody(input({ requirements: reworded }));
  assert.match(body, /A newcomer runs it/);
  assert.doesNotMatch(body, /A stranger runs it/);
  assert.equal(bodyReadFromSources(body, { requirements: reworded, questions: extractQuestions(FIXTURE_TRY_IT) }), null);
});

test("a body carrying a literal copy not read from the files is REFUSED", () => {
  const stale = buildBody(input()); // text typed from the OLD wording
  const now = extractRequirements(FIXTURE_RELEASE.replace("A stranger runs it", "A newcomer runs it"));
  const refusal = bodyReadFromSources(stale, { requirements: now, questions: extractQuestions(FIXTURE_TRY_IT) });
  assert.match(refusal ?? "", /REFUSING.*1 item/);
});

test("a document with no list is refused rather than read as an empty list", () => {
  assert.throws(() => extractRequirements("# nothing here"), /no "requirements list"/);
  assert.throws(() => extractQuestions("## What we would like back\n\nprose only"), /holds no numbered item/);
});

test("the real documents yield requirements 1..N and the four questions, and the body passes row-file's contract", () => {
  const requirements = extractRequirements(RELEASE);
  const questions = extractQuestions(TRY_IT);
  assert.deepEqual(requirements.map((r) => r.n), requirements.map((_, i) => i + 1));
  // The count derived a second way: the numbered items RELEASE.md's own list holds, which the extractor must not drop or invent.
  assert.equal(requirements.length, (RELEASE.match(/^\d+\. \*\*/gm) ?? []).length);
  assert.notEqual(requirements.length, 0, "control: the document holds a list");
  assert.equal(questions.length, 4);
  const body = buildBody(input({ requirements, questions, waitsOnOutsiderRepo: true }));
  assert.equal(bodyReadFromSources(body, { requirements, questions }), null);
  assert.equal(fileRefusalReason(body), null);
  assert.match(body, /^Waiting-for: closed #3182$/m);
  assert.doesNotMatch(buildBody(input()), /Waiting-for/);
});

test("neither the script nor docs/weekly-review.md quotes the documents' text (positive control: the documents do)", () => {
  const items = [...extractRequirements(RELEASE), ...extractQuestions(TRY_IT)];
  const leading = (text: string) => text.replace(/[*`_]/g, "").split(/\s+/).slice(0, 6).join(" ");
  const plain = (text: string) => text.replace(/[*`_]/g, "").replace(/\s+/g, " ");
  for (const { text } of items) assert.ok(plain(`${RELEASE}\n${TRY_IT}`).includes(leading(text)), "control: the source holds it");
  for (const file of ["scripts/weekly-review.mjs", "docs/weekly-review.md"]) {
    for (const { text } of items) assert.ok(!plain(read(file)).includes(leading(text)), `${file} copies "${leading(text)}"`);
  }
});

// ---- 3 and 4. who is ineligible --------------------------------------------------------------------------

test("the ineligible list is the sessions that built the closed rows; an empty one for a non-empty window is refused", () => {
  const rows = [
    { number: 1, sessionLabels: ["worker-2"] },
    { number: 2, sessionLabels: ["worker-1", "worker-2"] },
    { number: 3, sessionLabels: [], claimedBy: ["worker-9"] }, // the label was dropped on close; the claim record stays
    { number: 4, sessionLabels: [] },
  ];
  assert.deepEqual(ineligibleSessions(rows), { builders: ["worker-1", "worker-2", "worker-9"], unattributed: [4] });
  assert.deepEqual(ineligibleSessions([]), { builders: [], unattributed: [] }); // nothing closed, nothing to refuse
  const noBuilders = [{ number: 4, sessionLabels: [] }];
  assert.throws(() => ineligibleSessions(noBuilders), /not one names a builder/);
  // POSITIVE CONTROL: the same fixture with one closed row that has a builder yields it.
  assert.deepEqual(ineligibleSessions([...noBuilders, { number: 5, sessionLabels: ["worker-5"] }]).builders, ["worker-5"]);
});

test("eligible is false for a listed session and true for an unlisted one", () => {
  assert.equal(eligible("worker-1", ["worker-1", "worker-2"]), false);
  assert.equal(eligible("worker-7", ["worker-1", "worker-2"]), true);
});

test("the body's Ineligible line reads back as the list it was built from", () => {
  const body = buildBody(input({ builders: ["worker-1", "worker-2"], unattributed: [9] }));
  assert.deepEqual(ineligibleFromBody(body), ["worker-1", "worker-2"]);
  assert.match(body, /#9/);
});

// ---- 5. the next week's re-check -------------------------------------------------------------------------

test("the re-check comments when the reader was a listed builder and stays silent when it was not", () => {
  const body = buildBody(input({ builders: ["worker-1", "worker-2"] }));
  const listed = recheckLastWeek({ body, comments: ["Reviewer-session: worker-2\nreading..."], closed: true });
  assert.match(listed.comment ?? "", /Re-check: the reader `worker-2` is in this row's own ineligible list/);
  const stranger = recheckLastWeek({ body, comments: ["Reviewer-session: `worker-7`"], closed: true });
  assert.equal(stranger.comment, null);
});

test("the re-check says nothing twice, nothing on an unread open row, and something on a closed row naming no reader", () => {
  const body = buildBody(input());
  const first = recheckLastWeek({ body, comments: ["Reviewer-session: worker-1"], closed: true }).comment ?? "";
  assert.notEqual(first, "");
  assert.equal(recheckLastWeek({ body, comments: ["Reviewer-session: worker-1", first], closed: true }).comment, null);
  assert.equal(recheckLastWeek({ body, comments: [], closed: false }).comment, null);
  assert.match(recheckLastWeek({ body, comments: ["a reading with no reviewer line"], closed: true }).comment ?? "", /cannot be told/);
  assert.equal(recheckLastWeek({ body: "a row this script did not file", comments: [], closed: true }).comment, null);
});

// ---- 6. the workflow -------------------------------------------------------------------------------------

test("the workflow has schedule and workflow_dispatch only, and permissions that write issues and nothing else", () => {
  const workflow = parseYaml(read(".github/workflows/weekly-review.yml")) as {
    on: Record<string, unknown>; permissions: Record<string, string>;
  };
  assert.deepEqual(Object.keys(workflow.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.equal(workflow.permissions.issues, "write");
  const writes = Object.entries(workflow.permissions).filter(([, level]) => level !== "read").map(([scope]) => scope);
  assert.deepEqual(writes, ["issues"]);
  // POSITIVE CONTROL for the shape check: a pull_request trigger and a broader scope are both seen as such.
  const bad = parseYaml("on:\n  pull_request:\n  schedule: []\npermissions:\n  issues: write\n  contents: write\n") as typeof workflow;
  assert.ok("pull_request" in bad.on);
  assert.deepEqual(Object.entries(bad.permissions).filter(([, level]) => level !== "read").map(([scope]) => scope), ["issues", "contents"]);
});
