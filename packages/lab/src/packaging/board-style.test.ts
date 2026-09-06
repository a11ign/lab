import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { collect } from "../../../../scripts/board-data.mjs";
import { document } from "../../../../scripts/board-document.mjs";

/* THE BOARD'S STYLE, ENFORCED ON THE RENDERED DOCUMENT AND NEVER ON THE TEMPLATE.
 *
 * A template can satisfy a rule its output then breaks -- a section that reads well with data and badly
 * without it, a heading assembled from a figure that turns out to be absent. The board reads the output,
 * so the output is what is asserted.
 *
 * The two rules come from board feedback on edition 1, which read like an engineer's post-mortem. The
 * style guides are copied into `docs/board/style/` so this is checked against them rather than against
 * anyone's memory of them.
 *
 * WHAT THESE ASSERTIONS ARE NOT. "Contains a verb" and "reads as a claim" are judgements, and what is
 * mechanised here is a PROXY for each: a curated verb set, no question form, no section numbering, and a
 * full stop. A document can satisfy every check below and still be badly written. What the proxies do
 * catch is the specific way edition 1 failed -- topic headings, numbered sections, and repository
 * internals on a page the board reads -- and the mutation test at the bottom proves they catch it.
 */

/** Everything before the appendix: the part the board reads for decisions. */
function decisionSections(md: string): string {
  const i = md.indexOf("## Appendix");
  return i === -1 ? md : md.slice(0, i);
}

const headings = (md: string): string[] =>
  md.split("\n").filter((l) => /^#{2,4}\s/.test(l)).map((l) => l.replace(/^#+\s*/, "").trim());

/** A finite verb, as a PROXY for "this heading makes a claim". Curated, not exhaustive. */
const VERB = /\b(is|are|was|were|has|have|had|will|would|can|cannot|must|should|may|do|does|did|stands?|costs?|needs?|makes?|made|found|finds?|set|sets|gives?|gave|buys?|reads?|carries|carried|consumed|arrives?|remains?|moves?|moved|means?|proves?|shows?|asks?|asked|recommends?|publish|publishes|published|leaves?|lets?|runs?|ran|took|takes?|explains?|measures?|opened?|stops?|tells?|says?|comes?|goes?|works?|adds?|drives?)\b/i;

function firstSentence(block: string): string {
  const prose = block.split("\n")
    .find((l) => l.trim() && !/^#/.test(l) && !/^[|>*-]/.test(l) && !/^\d+\./.test(l));
  return (prose ?? "").replace(/\*\*/g, "").trim();
}

// BUILT ONCE. Each call reaches the issue tracker over the network, and three sections asserting on
// three separately-fetched documents would be three different documents -- which is the "two correct
// counts over different windows" defect, arriving inside the test that polices it.
let cached: string | undefined;
function buildDocument(): string {
  cached ??= document(collect(new Date(Date.now() - 24 * 3600_000).toISOString()));
  return cached;
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("sections one to five carry no repository internals", () => {
  const body = decisionSections(buildDocument());
  const offences: string[] = [];
  const scan = (label: string, re: RegExp) => {
    for (const line of body.split("\n")) {
      if (re.test(line)) offences.push(`${label}: ${line.trim().slice(0, 100)}`);
    }
  };
  scan("code span", /`/);
  scan("file name", /\.(md|mjs|ts|json|yml)\b/);
  scan("issue number", /#\d+/);
  scan("commit identifier", /\b[0-9a-f]{7,}\b/);
  assert.deepEqual(offences, [],
    "the board reads outcomes and decisions, not the repository. Identifiers belong in the appendix, "
    + "described in words with the exact reference beside them.");
});

test("the document and every section open with a complete sentence, not a topic", () => {
  const md = buildDocument();
  const blocks = decisionSections(md).split(/\n(?=## )/);
  const bad: string[] = [];
  for (const block of blocks) {
    const s = firstSentence(block);
    if (!s) continue;
    if (!/\.$|\.\s*$/.test(s)) bad.push(`does not end in a full stop: ${s.slice(0, 80)}`);
    if (!VERB.test(s)) bad.push(`contains no verb, so it is a topic rather than an answer: ${s.slice(0, 80)}`);
  }
  assert.deepEqual(bad, [],
    "the first sentence of the document and of every section must be a complete answer someone could "
    + "act on");
});

test("every heading is a claim, so the headings alone tell the story", () => {
  const bad = headings(decisionSections(buildDocument())).filter((h) =>
    !VERB.test(h) || /\?$/.test(h) || /^\d+\.\s/.test(h));
  assert.deepEqual(bad, [],
    "a heading that is a topic, a question, or a numbered label does not carry the story on its own");
});

test("the checks above FAIL on edition 1, which is what makes them worth running", () => {
  // MUTATION CHECK, against the real thing rather than a contrived string: this is edition 1's actual
  // shape -- numbered topic headings, a question, and repository internals in the decision sections. A
  // style guard that has never been shown to reject anything is decoration.
  const editionOne = [
    "# a11y-witness — board report",
    "",
    "## 1. Are we on track",
    "",
    "AT RISK. 8 blockers remain, and #3 has no known size — see `docs/backlog.md` for the derivation.",
    "",
    "## 2. Time to V1",
    "",
    "V1 is not defined in `PLAN.md`.",
  ].join("\n");

  const body = decisionSections(editionOne);
  assert.match(body, /`/, "edition 1 carried code spans in its decision sections");
  assert.match(body, /#\d+/, "edition 1 carried issue numbers in its decision sections");
  assert.match(body, /\.md\b/, "edition 1 named markdown files in its decision sections");

  const bad = headings(body).filter((h) => !VERB.test(h) || /\?$/.test(h) || /^\d+\.\s/.test(h));
  assert.ok(bad.length >= 2,
    `the heading check must reject edition 1's topic headings; it rejected ${bad.length}`);
});

test("the style guides the document is written to are in the repository", () => {
  // Checked against the FILES, not against memory of them -- which is the whole reason they were copied
  // in. A guide that lives only in a message is a guide the next reader cannot check the document against.
  for (const name of ["executive.md", "eli15.md", "README.md"]) {
    assert.ok(existsSync(path.join(REPO, "docs/board/style", name)),
      `docs/board/style/${name} is missing, so the document is being checked against nothing`);
  }
});
