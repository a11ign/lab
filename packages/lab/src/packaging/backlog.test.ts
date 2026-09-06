// "WHERE IS THE BACKLOG" HAD NO ANSWER, AND THAT IS WHY THIS TEST EXISTS.
//
// Open work lived in `known-gaps.md` and `not-working.md`, which are RECORDS -- known-gaps says so in its
// own header. Neither is a tracker, and neither can be read as one: section numbers are not unique
// (`not-working` carries four `§18`, two `§20`, two `§15`, two `§14`), entries are not in numeric order,
// and "closed" is spelled at least fourteen ways across the two. So "what is open" could not be answered
// by grep, only by reading 2,700 lines and inferring -- and an item nobody can find is an item nobody does,
// which is this repo's own rule about anything relying on a human to remember.
//
// `docs/backlog.md` was that one place from 2026-09-02 to 2026-09-06. GITHUB ISSUES IS NOW, and this
// guard has been repointed rather than retired, because the PROPERTY it protects is unchanged: open work
// must be findable mechanically, and a record entry that declares itself open must say where it is
// tracked.
//
// WHAT MOVED, AND WHY IT IS THE SAME ARGUMENT. The backlog was written because two records could not be
// read as a task list. It became 1,049 lines with 51 struck-through closed rows kept deliberately, and
// "what is open" needed inferring which strikethroughs were current -- measured on 2026-09-06 at five
// stale dispatches in one day, plus three rows already addressed on unmerged branches, which no reading
// of a FILE could catch because a file records claims and not branches. The backlog's own header put it
// best about itself: two copies of a status is exactly the shape that drifts.
//
// SO THE TARGET IS AN ISSUE NUMBER, NOT A BACKLOG ROW. `— OPEN` in a record must be followed by the issue
// tracking it. That is checkable offline with no network and no `gh`, which is what keeps this in
// `npm test` rather than in a gate somebody dispatches; it does not verify the issue is OPEN, or that it
// exists, and it says so rather than implying more than it can show.
//
// Only that direction is enforced, deliberately and for the original reason: an issue may exist with no
// record entry at all (a defect found today has nowhere else to be), so requiring the converse would
// refuse exactly the case the tracker is for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const RECORDS = ["docs/known-gaps.md", "docs/not-working.md"];

/**
 * A heading declares itself open, and names the issue tracking it: `— OPEN #45`, or `— OPEN (#45)`.
 *
 * PERMISSIVE ABOUT PUNCTUATION, STRICT ABOUT THE NUMBER. These headings are typed by hand, and a guard
 * that refuses one over a bracket teaches people to drop the marker rather than to add the issue — which
 * would disable this check by the one route it cannot see, since a heading with no marker is invisible
 * to it by design.
 */
const OPEN_MARKER = /—\s*OPEN\b\s*\(?(#\d+)?\)?\s*$/;

/**
 * Headings a record declares open, and the issue each names — PURE over the heading list, so the rule can
 * be driven with synthetic headings.
 *
 * That is not tidiness here, it is the only way this guard can be shown to work: there are ZERO `— OPEN`
 * headings in either record today, so every assertion over the real files passes on an empty set. A check
 * whose population is empty is a check that has never been exercised, and this repo's rule is that a guard
 * never shown to fail is not a verified guard.
 */
export function openHeadings(headings: string[]): { title: string; issue: string | null }[] {
  return headings
    .map((heading) => ({ heading, match: heading.match(OPEN_MARKER) }))
    .filter(({ match }) => match !== null)
    .map(({ heading, match }) => ({
      // Strip the leading number and the trailing marker, leaving the claim itself.
      title: heading.replace(/^\d+\.\s*/, "").replace(OPEN_MARKER, "").trim(),
      issue: match?.[1] ?? null,
    }));
}

/** Every `## ` heading in a record, as text. */
const headingsOf = (doc: string) => [...read(doc).matchAll(/^## (.+)$/gm)].map(([, heading]) => heading);

test("the backlog exists and says what it is for", () => {
  const backlog = read("docs/backlog.md");
  assert.match(backlog, /^# Backlog/m, "docs/backlog.md must open with its own heading");
  // A backlog that has emptied itself is a real state; one that never had rows is a broken reader, and
  // the two must not look alike. This suite would otherwise pass having examined nothing.
  assert.ok(backlog.split("\n").filter((l) => l.startsWith("|")).length > 5,
    "the backlog has almost no rows -- either everything is genuinely done, or this test is reading the wrong file");
});

// #93's mechanical half: `docs/backlog.md` was still readable as the tracker for four days after the move
// (§19 above fixed that in prose), and NOTHING pinned the fix -- so the file's own top could drift back to
// silence with no test noticing, the same way CLAUDE.md's own pointer (#87) drifted for the same reason.
// `docs/backlog-ready.md` already has this guard (`backlog-ready.test.ts`'s "signpost, not a deletion"
// test); this is the sibling pin for the file that guard does not cover.
test("the top of the file says it is a RECORD, not the tracker -- the banner cannot silently drop out", () => {
  const head = read("docs/backlog.md").split("\n").slice(0, 12).join("\n");
  // The row's own acceptance command, run as an assertion rather than by hand: `head -12 docs/backlog.md
  // | grep -qi 'record|retired|not the tracker'`.
  assert.match(head, /record|retired|not the tracker/i,
    "the first 12 lines of docs/backlog.md no longer say the file is a RECORD -- this is how it read as "
    + "the tracker for four days after GitHub Issues took over, and it is exactly this line moving out of "
    + "the first screen that would let it happen again");
  assert.match(head, /github\.com\/DanBeckDev\/a11y-witness\/issues/i,
    "the banner must say WHERE the tracker actually is, not only that this file is not it -- a reader who "
    + "learns 'not here' with nowhere to go next is back to inferring, which is the defect this file was "
    + "created to end");
});

test("every record entry marked OPEN names the issue tracking it", () => {
  // Mutation-safety, and it must not be `open.length > 0`. That was the first version and it FAILED on
  // 2026-09-03 for the one reason it should not: §20 was closed, no `— OPEN` heading remained, and the
  // guard reported the format as broken. Zero open entries is a legitimate state and a good one; a
  // changed marker format is a broken reader. Asserting on the open COUNT collapses them, which is this
  // repo's oldest defect -- "nothing found" and "we could not ask" reading the same -- inside the guard
  // written to stop the tracker drifting.
  //
  // So the format is proved INDEPENDENTLY of how many entries are open: a record whose headings carry no
  // state marker at all has changed shape, whatever the open count is.
  const marked = RECORDS.flatMap(headingsOf)
    .filter((heading) => /—\s*OPEN\b|\bCLOSED\b/.test(heading));
  assert.ok(marked.length > 0,
    "no heading in either record carries a state marker (`— OPEN` or `CLOSED`) -- the heading format "
    + "changed and this guard went blind. This is about the FORMAT: zero OPEN entries would be fine.");

  const untracked = RECORDS.flatMap((doc) =>
    openHeadings(headingsOf(doc))
      .filter(({ issue }) => issue === null)
      .map(({ title }) => `  ${doc}: ${title}`));

  assert.deepEqual(untracked, [],
    "These entries declare themselves OPEN in a record but name no issue:\n"
    + untracked.join("\n")
    + "\n\nGitHub Issues is what answers 'what is open'; a record holds the DETAIL and the lesson. Write"
    + "\nthe heading as `— OPEN #<n>` so the entry points at the thing that carries its state, rather"
    + "\nthan asserting a status of its own -- two copies of a status is the shape that drifts, and this"
    + "\nfile's own history is the evidence: docs/backlog.md was created to be that answer and became a"
    + "\nsecond copy within four days.");
});

test("PROOF: the rule bites — there are zero OPEN headings today, so the real files cannot show it works", () => {
  // THE POPULATION IS EMPTY, AND THAT IS EXACTLY WHY THIS IS HERE. Every assertion above passes over an
  // empty set of open headings, which is indistinguishable from a broken reader -- the shape this repo
  // has paid for in a signal-type scrape that asserted over nothing and passed. Driven with synthetic
  // headings, so the rule is exercised whatever the records happen to contain.
  const tracked = openHeadings(["12. A thing that is not done — OPEN #45"]);
  assert.deepEqual(tracked, [{ title: "A thing that is not done", issue: "#45" }]);

  assert.deepEqual(openHeadings(["12. A thing that is not done — OPEN"]),
    [{ title: "A thing that is not done", issue: null }],
    "a bare `— OPEN` with no issue must be REPORTED, not skipped -- if this ever returns [], the guard "
    + "has stopped seeing the exact heading it exists to catch");

  assert.deepEqual(openHeadings(["12. A thing that is not done — OPEN (#45)"])[0].issue, "#45",
    "brackets are punctuation, and refusing over them teaches people to drop the marker instead");

  assert.deepEqual(openHeadings(["12. CLOSED 2026-09-06 — it was the memo all along"]), [],
    "a CLOSED heading must not be read as open, or the guard demands an issue for finished work");
});

test("a record must not say OPEN and CLOSED under one number", () => {
  // The converse the comment at the top declines to enforce IN GENERAL, narrowed to the one shape that is
  // mechanically decidable -- and it went wrong within two days of the backlog existing. §20 was closed on
  // 2026-09-01 by adding a NEW `## 20. CLOSED ...` section above the old one, and the old one kept its
  // `— OPEN` marker. So `not-working` asserted both states at once, the guard above dutifully required a
  // backlog row for finished work, and the backlog carried it until 2026-09-03.
  //
  // That is this file's own subject one level in: "closed" spelled fourteen ways, now including "recorded
  // as a sibling section rather than over the entry it closes". A `### The original entry` line above a
  // `##` heading does not demote it -- the fix is to demote the heading, and this refuses the state that
  // makes forgetting to possible.
  const numbered = (doc: string) =>
    [...read(doc).matchAll(/^## (\d+)\.\s*(.+)$/gm)].map(([, number, rest]) => ({ number, rest }));

  const offenders = RECORDS.flatMap((doc) => {
    const byNumber = new Map<string, string[]>();
    for (const { number, rest } of numbered(doc)) {
      byNumber.set(number, [...(byNumber.get(number) ?? []), rest]);
    }
    return [...byNumber.entries()]
      .filter(([, headings]) =>
        // OPEN_MARKER, not a second spelling of it. Written as `/—\s*OPEN\s*$/` here until 2026-09-06,
        // which stopped matching the moment the marker was allowed to carry an issue number -- a fact
        // stated twice, drifting the same day the first copy moved. The shared constant cannot drift.
        headings.some((h) => OPEN_MARKER.test(h)) && headings.some((h) => /\bCLOSED\b/.test(h)))
      .map(([number, headings]) => `${doc} §${number}:\n    ` + headings.join("\n    "));
  });

  assert.deepEqual(offenders, [],
    "A record declares the same numbered entry both OPEN and CLOSED. Demote the superseded heading to a\n"
    + "`###` subsection of the closure rather than leaving it beside it — while both stand, 'what is open'\n"
    + "has two answers and the backlog will carry a row for work that is done:\n  "
    + offenders.join("\n  "));
});

test("the backlog states an order, and says what the order is FOR", () => {
  const backlog = read("docs/backlog.md");
  assert.match(backlog, /^## The order these should be done in$/m,
    "docs/backlog.md must state an order -- a list of open work with no sequence is a list of open work"
    + " that gets done in the sequence somebody happens to read it in.");
  // The house convention, quoted from known-gaps.md. It is load-bearing rather than decorative: three
  // backlog items change the capture path, and each one landed alone costs a ~8 h recapture. An order
  // section that does not explain ITSELF gets reordered by the next person on cost or on convenience.
  assert.match(backlog, /CONSUMES what/,
    "the order section must state the rule it orders BY, not just the sequence");
});

test("every document the backlog points at exists", () => {
  const cited = [...read("docs/backlog.md").matchAll(/\]\(\.\/([^)#]+?)(?:#[^)]*)?\)/g)]
    .map(([, path]) => `docs/${path}`);
  assert.ok(cited.length > 0, "the backlog cites no documents -- the link format changed");
  for (const path of new Set(cited)) {
    assert.doesNotThrow(() => read(path), `docs/backlog.md links to ${path}, which does not exist`);
  }
});
