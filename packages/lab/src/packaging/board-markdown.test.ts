import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { toHtml, inline } from "../../../../scripts/board-markdown.mjs";
import { document } from "../../../../scripts/board-document.mjs";

/* THE TEST THAT WOULD HAVE CAUGHT IT, and the reason it is written against RENDERED OUTPUT rather than
 * against the converter's branches.
 *
 * Edition 1 of the board document shipped with two achievements rendered as headings with no body: the
 * paragraph fallback guessed "this line starts a new block" from a first character, so a paragraph
 * opening with inline code was claimed by nothing and dropped by a bare `i++`. Every unit test of the
 * converter's individual branches would still have passed -- the blockquote branch worked, the code
 * branch worked, and the text vanished between them.
 *
 * So the assertion that matters is a WHOLE-DOCUMENT one: no visible text may disappear between the
 * markdown and the HTML. It is the same shape as this repo's rule that a count-based check cannot see
 * content rot -- "the blockquote element is present" is a count, "the sentence inside it survived" is
 * the finding.
 */

/** The shape `reported.json` records for section 3, named so the assertion below is not `any`. */
type Achievement = { claim?: string; evidence?: string; reportedBy?: string };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Visible words, with markup removed, so the comparison is about CONTENT and not about syntax.
 *
 * The three normalisations below are each a SYNTAX token that is correctly absent from the rendered
 * output, and each was added only after seeing it reported as a loss and confirming by eye that the
 * content had in fact survived. Normalising away anything else would be weakening the test to make it
 * pass, which is the failure this whole file exists to catch one layer down. */
const words = (s: string): string[] => s
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // a link renders as its TEXT; the URL is an attribute
  .replace(/^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/gm, " ")  // table rules and <hr/> carry no words
  .replace(/[`*_>#|]/g, " ")
  .replace(/^\s*[-\d]+\.?\s/gm, " ")
  .split(/\s+/)
  // Trailing punctuation lands differently either side of a tag boundary -- `[link](url).` is one token
  // in the markdown and `link</a>.` splits into two in the HTML. That is a tokenisation artefact of this
  // comparison, not a loss, so edges are trimmed. The WORD is what must survive.
  .map((w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
  .filter(Boolean);

test("no visible text is lost between markdown and HTML", () => {
  const md = [
    "## A heading",
    "",
    "> `fleet:hours`, built and measured by orchestrator: 54.11 worker-hours over 5,395 captures.",
    "",
    "`agent/route-change-order-and-dialog-restore` carries two fixes, neither merged.",
    "",
    "- a bullet with `code` in it",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "**Bold** and *italic* and a [link](https://example.com).",
  ].join("\n");

  const before = words(md);
  const after = words(toHtml(md));
  const missing = before.filter((w: string) => !after.includes(w));
  assert.deepEqual(missing, [],
    `these words are in the markdown and not in the rendered HTML, so the converter dropped them: `
    + `${missing.join(", ")}`);
});

test("a paragraph opening with inline code survives -- the exact edition-1 defect", () => {
  const html = toHtml("> `fleet:hours`, built and measured: 54.11 hours.");
  assert.match(html, /54\.11 hours/,
    "a blockquote whose first line begins with inline code rendered empty. That shipped to a board.");
  assert.doesNotMatch(html, /<blockquote><\/blockquote>/);
});

test("the real board document loses no text either, and this cannot pass having read nothing", () => {
  // VACUITY GUARD. A whole-document assertion that runs against an empty document passes while
  // examining nothing -- this repo has shipped exactly that twice.
  const md = document({
    since: "2026-01-01T00:00:00Z",
    all: [], open: [], closed: [], milestones: [], release: null,
    merges: [], unpushed: 0, strays: [], latestGate: null, gateIsFresh: false,
    fleetHours: { status: "not instrumented", note: "no total exists." },
    achievements: [{
      claim: "A claim.",
      evidence: "`a-branch-name` proves it, verified by command.",
      issue: 1, reportedBy: "product-manager", at: "2026-01-01T00:00:00Z",
    }],
  });
  assert.ok(md.length > 3000, `the document is only ${md.length} chars; this assertion would be vacuous`);

  const missing = words(md).filter((w: string) => !words(toHtml(md)).includes(w));
  assert.deepEqual(missing, [], `the board document loses these words when rendered: ${missing.join(", ")}`);
});

test("every achievement in reported.json carries a non-empty evidence line", () => {
  // The board document promises that every claim carries its evidence. An entry with an empty or missing
  // `evidence` would render as a heading with no body -- the same SHAPE as the converter bug, arriving
  // from the data instead of from the renderer, and indistinguishable on the page.
  const raw = JSON.parse(readFileSync(path.join(REPO, "docs/board/reported.json"), "utf8"));
  const bad = (raw.achievements ?? [])
    .filter((a: Achievement) => !a.claim?.trim() || !a.evidence?.trim() || !a.reportedBy?.trim());
  assert.deepEqual(bad.map((a: Achievement) => a.claim ?? "(no claim)"), [],
    "these achievements would render as a claim with no source on the one page that promises none");
});

test("inline code is not confused with ordinary prose containing digits", () => {
  // The placeholder used to be a bare number in spaces, which prose can contain.
  assert.match(inline("a value of 0 in prose and `code` after it"), /a value of 0 in prose/);
  assert.match(inline("a value of 0 in prose and `code` after it"), /<code>code<\/code>/);
});
