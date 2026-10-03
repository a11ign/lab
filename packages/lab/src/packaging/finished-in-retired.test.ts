/**
 * THE ROW FORM AND `docs/row-filing.md` NO LONGER DOCUMENT `Finished-in:` (#3059).
 *
 * `Finished-in:` was a row field that no code read: `cross-repo-row-completion.mjs` was never merged into
 * `a11ign/agent-org` and `ceo` ruled it is not to be built (#928, 2026-10-02). #2907 followed the doc, carried a valid
 * line, and its row stayed open 3.5 hours. A pull request in `a11ign/agent-org` closes its row with the full form
 * `Closes a11ign/a11ign#N` instead (#2995), so the two documents say that.
 *
 * Positive controls, so an emptied or misread file is not a pass: each file is read and is longer than a floor, the doc
 * carries the full form inside a section about a row finishing in another repository (so the section was REPLACED, not
 * merely deleted), and the form still carries its other inputs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO_ROOT}${path}`, "utf8");

const DOC = "docs/row-filing.md";
const FORM = ".github/ISSUE_TEMPLATE/backlog-row.yml";
const DOC_FLOOR = 10_000;
const FORM_FLOOR = 2_000;
const RETIRED_FIELD = "Finished-in";

/** The `## ` section of `markdown` whose heading mentions `needle`, heading line included. */
function sectionMentioning(markdown: string, needle: RegExp): string | undefined {
  return markdown.split(/^(?=## )/m).find((section) => needle.test(section.split("\n", 1)[0]));
}

test("#3059: neither the filing guide nor the row form mentions the retired field", () => {
  for (const path of [DOC, FORM]) {
    assert.equal(read(path).includes(RETIRED_FIELD), false, `${path} still says ${RETIRED_FIELD}`);
  }
});

test("#3059: both files were read and are not emptied", () => {
  assert.ok(read(DOC).length > DOC_FLOOR, `${DOC} is shorter than ${DOC_FLOOR} characters`);
  assert.ok(read(FORM).length > FORM_FLOOR, `${FORM} is shorter than ${FORM_FLOOR} characters`);
});

test("#3059: the guide's section on another repository gives the full form and cites #2995", () => {
  const section = sectionMentioning(read(DOC), /another repository|agent-org/i);
  assert.ok(section, "no section about a row finishing in another repository");
  assert.ok(section.includes("Closes a11ign/a11ign#"), "the section lost the full form");
  assert.ok(section.includes("#2995"), "the section does not cite #2995");
  assert.equal(section.includes("#3009"), false, "the section cites #3009, which is not the ruling");
});

test("#3059: the row form has no finished-in input and keeps its other inputs", () => {
  const form = read(FORM);
  assert.doesNotMatch(form, /^\s*id:\s*finished-in\s*$/m);
  for (const id of ["claude-md", "fleet"]) {
    assert.match(form, new RegExp(`^\\s*id:\\s*${id}\\s*$`, "m"), `the form lost its ${id} input`);
  }
});
