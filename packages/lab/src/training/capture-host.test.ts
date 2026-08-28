import { test } from "node:test";
import assert from "node:assert/strict";
import { nonAuthoritativeHostNotice, LAB_REPO_PATH } from "./capture-host.mjs";

/**
 * A capture driven from a laptop puts that laptop in the critical path twice — it serves the corpus pages
 * and it drives the dispatch — and neither is visible from the command. The only place the dependency was
 * ever stated is a battery guard's refusal, which is how it came to be answered with `--allow-battery`
 * rather than understood. A guard that fires without explaining what it protects gets overridden.
 */
const laptop = { cwd: "/Users/someone/repos/a11y-witness", servesPages: true };

test("a driving host is told it is load-bearing, and told what the lab command is", () => {
  const notice = nonAuthoritativeHostNotice(laptop)!;
  assert.match(notice, /load-bearing/);
  assert.match(notice, /SERVES THE CORPUS PAGES/);
  assert.match(notice, /DRIVES THE DISPATCH/);
  // Naming the alternative is the point. A warning that says "this is risky" and stops there is a warning
  // people learn to scroll past.
  assert.match(notice, /lab:job -- -e job=capture-only/);
});

test("the LAB says nothing, so the notice cannot become noise where it does not apply", () => {
  assert.equal(nonAuthoritativeHostNotice({ cwd: LAB_REPO_PATH, servesPages: true }), null);
  assert.equal(nonAuthoritativeHostNotice({ cwd: `${LAB_REPO_PATH}/packages/lab`, servesPages: true }), null);
});

test("a path that merely STARTS like the lab's is not the lab", () => {
  // `/opt/a11y-scratch` shares a prefix and is a different machine's checkout. String-prefix matching
  // without the separator is the classic version of this, and it would silence the notice on the one host
  // most likely to need it — somebody's copy sitting next to the real one.
  assert.notEqual(nonAuthoritativeHostNotice({ cwd: "/opt/a11y-scratch", servesPages: true }), null);
});

test("real-page runs are told they drive the run but NOT that they serve pages", () => {
  // They fetch from the live web, so the page-server dependency genuinely does not apply. A notice that
  // overstates gets discounted, and then the true half goes with it.
  const notice = nonAuthoritativeHostNotice({ ...laptop, servesPages: false })!;
  assert.doesNotMatch(notice, /SERVES THE CORPUS PAGES/);
  assert.match(notice, /DRIVES THE DISPATCH/);
});
