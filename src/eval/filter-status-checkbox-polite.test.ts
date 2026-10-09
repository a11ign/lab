/**
 * The §31 condition: a checkbox whose change synchronously rewrites a polite status region. The "about 1 time in 3"
 * announcement figure in `docs/known-gaps.md` §31 is only measurable on a page that carries this condition, and the
 * only fixture that activates a control today is the silent variant. This test pins the page to the three properties
 * that define the condition, so a later edit cannot quietly turn it into the button condition.
 *
 * It is kept OUT of `src/training/case-matrix.mjs` on purpose: a case that is intermittent by construction teaches the
 * model noise (`docs/not-working.md` §18), which is why its two predecessors were withdrawn. The last test checks that.
 *
 * Pure file reads — no browser, no worker, no model, milliseconds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PAGE = "src/eval/pages/books/filter-status-checkbox-polite.html";
const BUTTON_PAGE = "src/eval/pages/books/filter-status-good.html";
const MATRIX = "src/training/case-matrix.mjs";

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** The inline script bodies of a page, joined. A handler lives here, so its properties are read from here. */
const scriptOf = (html: string): string =>
  [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");

/**
 * Reads the three properties that define the condition. Each is a boolean, so a failing one is named.
 * Comments are removed first: the pages explain their own conditions in comments, and a comment that says
 * `role="status"` must not be read as an element.
 */
function conditionOf(raw: string) {
  const html = raw.replace(/<!--[\s\S]*?-->/g, "");
  const script = scriptOf(html);
  const statusTag = /<[^>]*role=["']status["'][^>]*>/i.exec(html)?.[0] ?? "";
  const statusId = /\bid=["']([^"']+)["']/i.exec(statusTag)?.[1];
  return {
    checkboxes: [...html.matchAll(/<input[^>]*type=["']?checkbox/gi)].length,
    buttons: [...html.matchAll(/<button[\s>]/gi)].length,
    // A polite live region: role="status" on an element the handler writes to.
    statusRegion: statusId !== undefined,
    statusWrittenByHandler: statusId !== undefined && script.includes(`getElementById('${statusId}')`),
    // A synchronous change handler: no timer anywhere in the page's script, which is stricter than the handler alone.
    changeHandler: /addEventListener\(\s*['"]change['"]/.test(script) || /\bonchange=/i.test(html),
    noTimers: !/\bsetTimeout\b/.test(script),
  };
}

/** The §31 condition: exactly one checkbox, no button control, and every property above. */
const isCheckboxPolite = (html: string): boolean => {
  const c = conditionOf(html);
  return c.checkboxes === 1 && c.buttons === 0 && c.statusRegion && c.statusWrittenByHandler && c.changeHandler && c.noTimers;
};

test("the checkbox page carries the §31 condition: one checkbox, a polite status region, a synchronous change handler", () => {
  const c = conditionOf(read(PAGE));
  assert.equal(c.checkboxes, 1, "exactly one <input type=\"checkbox\">");
  assert.equal(c.buttons, 0, "no <button> control: that is the other condition");
  assert.ok(c.statusRegion, "an element with role=\"status\" and an id");
  assert.ok(c.statusWrittenByHandler, "the handler writes to that status element");
  assert.ok(c.changeHandler, "a change handler on the checkbox");
  assert.ok(c.noTimers, "no setTimeout in the page's script: the update is synchronous");
});

test("positive control: the same predicate finds the button condition on filter-status-good, so it can tell the two apart", () => {
  const good = conditionOf(read(BUTTON_PAGE));
  assert.equal(good.checkboxes, 0, "the button page has no checkbox");
  assert.ok(good.buttons > 0, "the button page has a <button> control");
  assert.ok(good.statusRegion, "and the same polite status region");
  assert.equal(isCheckboxPolite(read(BUTTON_PAGE)), false, "so the predicate refuses it");
  assert.equal(isCheckboxPolite(read(PAGE)), true, "and accepts the checkbox page");
});

test("the case matrix does not name the page, and it is readable, so the absence is a finding and not an unread file", () => {
  const matrix = read(MATRIX);
  // Positive control: a known filter-status case IS named in the matrix, so the scan really reads the file.
  assert.match(matrix, /filter-status-silent/);
  assert.ok(!matrix.includes("filter-status-checkbox-polite"), "the page must not be added to the case matrix");
});
