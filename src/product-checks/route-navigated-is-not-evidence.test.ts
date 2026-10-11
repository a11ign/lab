/**
 * `routeChange.navigated` IS A TAUTOLOGY ON EVERY SUCCESSFUL ACTIVATION, so nothing may read it as evidence that
 * the view moved: read `titleBefore`/`titleAfter`/`headingBefore`/`headingAfter`, or `route.control === null` for
 * "was this even probed".
 *
 * Moved from the core's `route-navigated-is-not-evidence.test.ts` (ADR 0045 cut 1), whose walk covered
 * `packages/` and so reached this repository through the core's `packages/lab/` path. This is that walk over
 * THIS repository's own `src` and `scripts`. The core keeps the walk over its packages and the Python
 * featurizer, which are the core's files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { LAB_ROOT, labSources } from "./lab-sources.ts";

const SIGNAL_PREDICATES = "src/training/signal-predicates.mjs";
/** The files this guard's own design says a future row removes coverage for. */
const NAVIGATED_EXCEPTIONS = new Map([
  [SIGNAL_PREDICATES, "#1867 (Region widened): routeTitleIsStale mirrors addStaleRouteTitle's fix -- the same "
    + "corroborating signal for the same held-steady-heading shape"],
]);

function sources(): [string, string][] {
  return labSources(/\.(ts|mjs)$/).map((file) => [relative(LAB_ROOT, file), readFileSync(file, "utf8")]);
}

const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("every lab source that mentions routeChange is free of `.navigated` reads", () => {
  const consumers = sources().filter(([, text]) => text.includes("routeChange"));
  // The sentinel this scan proves it did not examine nothing: a walk that stopped finding files (a rename, a
  // moved root) must fail loud, not pass having walked an empty set.
  assert.ok(consumers.some(([path]) => path === SIGNAL_PREDICATES),
    `discovery did not find ${SIGNAL_PREDICATES}, which is known to mention routeChange today: the walk root `
    + "or the extension filter moved, and the scan below would otherwise pass having examined nothing");
  for (const [path, text] of consumers) {
    if (NAVIGATED_EXCEPTIONS.has(path)) continue;
    assert.doesNotMatch(withoutComments(text), /\.navigated\b/,
      `${path} reads \`.navigated\` outside a comment: routeChange.navigated is a tautology on every `
      + "successful activation, not evidence that the view moved.");
  }
});

test("no exception is silently outgrown: every excepted file still reads `.navigated` somewhere", () => {
  // A whole-file exception is coarser than the guard it replaces: if the fix that earned it were reverted, the
  // exception would keep exempting the file from a guard it no longer needs. This is the guard on the guard.
  const all = new Map(sources());
  assert.ok(NAVIGATED_EXCEPTIONS.size > 0, "the exception list is empty, so this loop examines nothing");
  for (const [path] of NAVIGATED_EXCEPTIONS) {
    const text = all.get(path);
    assert.ok(text, `${path} was not found by the discovery walk`);
    assert.match(withoutComments(text), /\.navigated\b/,
      `${path} no longer reads \`.navigated\` anywhere: remove it from NAVIGATED_EXCEPTIONS so the file `
      + "goes back under the ordinary guard above");
  }
});

test("the guard does not forbid the fields that carry real evidence", () => {
  // A guard that forbids a field is one over-broad edit away from silently deleting the evidence it protects.
  const code = withoutComments(readFileSync(`${LAB_ROOT}/${SIGNAL_PREDICATES}`, "utf8"));
  for (const field of ["titleBefore", "titleAfter", "headingBefore", "headingAfter"]) {
    assert.match(code, new RegExp(`\\b${field}\\b`), `${SIGNAL_PREDICATES} should still read ${field}`);
  }
  assert.match(code, /route\.control\b/, `${SIGNAL_PREDICATES} should still read route.control`);
});
