/**
 * WCAG 3.3.7 Redundant Entry: an email-and-confirm form, the same form asking once, and a password-and-confirm
 * form are a corpus trio, recorded BEFORE any probe exists (a11ign/a11ign#4353, child of #4084 outcome 2).
 *
 * The citation is the Understanding page's own body text (https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry),
 * re-read 2026-10-09: "Information previously entered by or provided to the user that is required to be entered
 * again in the same process is either: auto-populated, or available for the user to select", and for the
 * negative "Security measures such as preventing a password string from being shown or copied ... If the system
 * requires the user to manually create a password that is not displayed, having users re-validate their new
 * string is allowed as an exception". That page (and technique G221) shows NO email-and-confirm form: calling it
 * "W3C's own textbook failure" is a reading of "process" ("series of user actions where each action is required
 * in order to complete an activity"), not a quotation.
 *
 * ## What the checker says about each page TODAY (what a probe row must turn)
 *
 * See the pull request: the reading is a function of the criterion's status in `criterion-coverage.ts`, so it
 * is the same for all three pages. This file pins the PAGES, not the checker.
 *
 * ## What differs
 *
 * bad vs good: the second field (its label and its input), and nothing else. The comparison deletes those two
 * lines and demands byte equality; it normalises nothing, so a second difference fails it.
 * bad vs exception: the exception page's fields are `type="password"`, and its labels pair up the same way the
 * bad page's do, so a label-similarity heuristic cannot tell them apart and a rule reading the field type can.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(HERE, name), "utf8");
const bad = read("email-confirm-bad.html");
const good = read("email-once-good.html");
const exception = read("password-confirm-exception.html");

/** Every `<input>` tag on the page that takes typed text (anything but a button, a checkbox or a hidden field). */
const typedInputs = (html: string): string[] =>
  [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((tag) => !/type="(?:submit|checkbox|radio|hidden|button)"/.test(tag));

const attr = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>])`));
  return m ? (m[1] ?? "") : undefined;
};

/** The text of the label for each typed input, in page order. */
const labels = (html: string): string[] => [...html.matchAll(/<label\b[^>]*>([^<]*)<\/label>/g)].map((m) => m[1]!.trim());

/** The page with the second field's label and input lines deleted. */
const withoutSecondField = (html: string): string => html.replace(/ {2}<label for="email-confirm">[^\n]*\n {2}<input id="email-confirm"[^\n]*\n/, "");

test("positive: the bad page has exactly two text inputs, the second required with no autocomplete and no value", () => {
  const inputs = typedInputs(bad);
  assert.equal(inputs.length, 2);
  assert.equal(attr(inputs[1]!, "required"), "", "the second field is required");
  assert.equal(attr(inputs[1]!, "autocomplete"), undefined, "nothing tells the browser what the second field holds");
  assert.equal(attr(inputs[1]!, "value"), undefined, "nothing is pre-filled");
  assert.equal(attr(inputs[0]!, "value"), undefined, "the first field is not pre-filled either");
  assert.deepEqual(labels(bad), ["Email", "Confirm your email"]);
});

test("negative: the good page asks for the email once", () => {
  const inputs = typedInputs(good);
  assert.equal(inputs.length, 1);
  assert.deepEqual(labels(good), ["Email"]);
});

test("control: the bad and good pages are byte-identical outside the second field", () => {
  assert.equal(withoutSecondField(bad), good);
});

test("control: a second difference is NOT absorbed by the comparison", () => {
  assert.notEqual(withoutSecondField(bad.replace("Create account", "Sign up")), good, "a reworded button must fail the byte comparison, or the pair proves nothing");
  assert.notEqual(withoutSecondField(bad), bad, "the deletion removes something, or the byte comparison is vacuous");
});

test("negative: the exception page's second field is a password field beside a first password field", () => {
  const inputs = typedInputs(exception);
  assert.equal(inputs.length, 2);
  assert.equal(attr(inputs[0]!, "type"), "password");
  assert.equal(attr(inputs[1]!, "type"), "password");
  assert.equal(attr(inputs[1]!, "required"), "", "it asks twice and requires the second answer, as the bad page does");
  assert.equal(attr(inputs[1]!, "value"), undefined);
  assert.deepEqual(labels(exception), ["New password", "Confirm new password"]);
});

test("control: a label-similarity heuristic cannot tell the exception page from the bad page", () => {
  const confirmsFirst = (html: string): boolean => {
    const [first, second] = labels(html).map((l) => l.toLowerCase());
    return second!.startsWith("confirm") && second!.includes(first!);
  };
  assert.equal(confirmsFirst(bad), true);
  assert.equal(confirmsFirst(exception), true, "the negative only controls for a label guess if the labels pair up the same way");
  assert.equal(confirmsFirst(good.replace("</form>", '<label for="x">Confirm email</label></form>')), true, "positive control for the heuristic itself");
});

test("no page carries a script or an autocomplete that could pre-fill the second field", () => {
  for (const html of [bad, good]) {
    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /\bautocomplete=/i);
  }
  assert.doesNotMatch(exception, /<script\b/i);
});
