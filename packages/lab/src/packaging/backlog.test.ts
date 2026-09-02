// "WHERE IS THE BACKLOG" HAD NO ANSWER, AND THAT IS WHY THIS TEST EXISTS.
//
// Open work lived in `known-gaps.md` and `not-working.md`, which are RECORDS -- known-gaps says so in its
// own header. Neither is a tracker, and neither can be read as one: section numbers are not unique
// (`not-working` carries four `§18`, two `§20`, two `§15`, two `§14`), entries are not in numeric order,
// and "closed" is spelled at least fourteen ways across the two. So "what is open" could not be answered
// by grep, only by reading 2,700 lines and inferring -- and an item nobody can find is an item nobody does,
// which is this repo's own rule about anything relying on a human to remember.
//
// `docs/backlog.md` is now the one place. This keeps it from becoming a THIRD copy that drifts: an entry
// explicitly marked `— OPEN` in a record must appear on the backlog. Only that direction is enforced,
// deliberately -- the backlog also holds items with no record entry at all (a defect found today has
// nowhere else to be), so requiring the converse would refuse exactly the case it is for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const RECORDS = ["docs/known-gaps.md", "docs/not-working.md"];

/** Compare on MEANING, not on punctuation: a title is re-typed by hand into the backlog, and a curly
 *  quote or a dropped backtick must not read as a missing item. */
const normalise = (s: string) =>
  s.toLowerCase().replace(/[`*_]/g, "").replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();

/** Headings a record has explicitly declared still open. */
function openHeadings(): { doc: string; title: string }[] {
  return RECORDS.flatMap((doc) =>
    [...read(doc).matchAll(/^## (.+)$/gm)]
      .map(([, heading]) => heading)
      .filter((heading) => /—\s*OPEN\s*$/.test(heading))
      .map((heading) => ({
        doc,
        // Strip the leading number and the trailing marker, leaving the claim itself.
        title: heading.replace(/^\d+\.\s*/, "").replace(/—\s*OPEN\s*$/, "").trim(),
      })));
}

test("the backlog exists and says what it is for", () => {
  const backlog = read("docs/backlog.md");
  assert.match(backlog, /^# Backlog/m, "docs/backlog.md must open with its own heading");
  // A backlog that has emptied itself is a real state; one that never had rows is a broken reader, and
  // the two must not look alike. This suite would otherwise pass having examined nothing.
  assert.ok(backlog.split("\n").filter((l) => l.startsWith("|")).length > 5,
    "the backlog has almost no rows -- either everything is genuinely done, or this test is reading the wrong file");
});

test("every record entry marked OPEN is on the backlog", () => {
  const backlog = normalise(read("docs/backlog.md"));
  const open = openHeadings();

  // Mutation-safety: if the regex above stops matching, this test would pass having found no work to
  // check. Both records carry at least one explicitly-open entry as of 2026-09-02.
  assert.ok(open.length > 0,
    "found no headings marked '— OPEN' in either record -- the heading format changed and this guard went blind");

  const missing = open
    .filter(({ title }) => !backlog.includes(normalise(title)))
    .map(({ doc, title }) => `  ${doc}: ${title}`);

  assert.deepEqual(missing, [],
    "These entries are marked OPEN in a record but are not on docs/backlog.md:\n"
    + missing.join("\n")
    + "\n\nOpen work belongs on the backlog. The record holds the DETAIL and the lesson; the backlog is"
    + "\nthe one place that answers 'what is open'. Add a row linking to the entry rather than restating"
    + "\nit -- two copies of a status is the shape that drifts.");
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
