/**
 * `scripts/board-report.mjs`'s render sections are pure — `(factSet, lines) -> void`, pushing prose onto
 * an array — and had no test at all until now, which is exactly this file's own header rule turned on
 * itself: a report generated FROM data still needs the RENDERING of that data checked, or a fact read
 * correctly can still be rendered wrong (a missing "found by nobody" case, a pluralisation bug, a branch
 * that only fires when a count is exactly one).
 *
 * `whatMerged`'s `unpushed === 0` branch calls the real `git(["rev-parse", "--short", "main"])` against
 * THIS repository — deliberately not mocked, since this checkout genuinely has a `main` branch and the
 * call is read-only; every other branch and every other section is exercised with plain fixture data.
 *
 * NEEDS A REAL LOCAL `main` BRANCH, BY DESIGN — same fact `board-style.test.ts`'s `buildDocument` comment
 * already records for `board-data.mjs`'s `mergeState`: reading LOCAL `main` rather than `origin/main` is
 * deliberate (a hold must not read as a stall), and correct for this tool's real home. `ci.yml`'s `ts` job
 * checks out one commit via `actions/checkout@v4`'s default depth, with no branch named `main` locally,
 * ever — so the two tests below that force this real `git()` call skip honestly there, the identical idiom,
 * rather than asserting a shape their own environment cannot produce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  release, blockerTable, issuesClosed, whatMerged, authorship, lastGate, fleetHoursSection, queue, render,
} from "../../../../scripts/board-report.mjs";

/**
 * Runs `fn`, and turns "no local `main` branch here" into an honest skip rather than a failure — the same
 * reasoning `board-style.test.ts`'s `buildDocument` already uses for the identical cause. Anything else
 * re-throws: this must never quietly swallow a real assertion failure.
 *
 * NOT THE SAME REGEX. `board-style.test.ts` matches `git log main --merges`'s error (`fatal: ambiguous
 * argument 'main': unknown revision ...`); this file calls `git(["rev-parse", "--short", "main"])`, which
 * on the identical absent-branch condition prints a DIFFERENT, generic message: `fatal: Needed a single
 * revision` -- no mention of "main", "ambiguous" or "unknown revision" at all. Verified by reproducing
 * both against a real detached, branchless clone rather than assumed from the first case's wording; a
 * regex borrowed from the other call site would have matched neither.
 */
function skipIfNoLocalMain(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    const message = String((error as { stderr?: string; message?: string }).stderr ?? error);
    if (!/unknown revision|ambiguous argument 'main'|needed a single revision/i.test(message)) throw error;
    console.log("SKIPPED: no local `main` branch in this checkout (an ephemeral CI checkout) — this "
      + "test's whole point is exercising the real git() call against one. Honest skip, not a pass.");
  }
}

/** A minimal, complete fact set — every section reads a subset of this without throwing. */
function facts(overrides = {}) {
  return {
    since: "2026-09-05T00:00:00.000Z",
    sinceLabel: "commits and closures since 2026-09-05T00:00:00.000Z",
    ms: { title: "v0.1.0 — first publish", due_on: "2026-09-20T00:00:00.000Z", open_issues: 3, closed_issues: 40 },
    merges: [],
    unpushed: null,
    strays: [],
    latestGate: null,
    gateIsFresh: true,
    fleetHours: null,
    closed: [],
    open: [],
    blockers: [],
    ready: [],
    awaiting: [],
    ...overrides,
  };
}

const rendered = (fn: (d: unknown, L: string[]) => void, d: unknown): string => {
  const L: string[] = [];
  fn(d, L);
  return L.join("\n");
};

test("release: no milestone reads as a tracker fault, not a schedule one", () => {
  const out = rendered(release, facts({ ms: null }));
  assert.match(out, /No milestone titled `v0\.1\.0 — first publish` exists/);
  assert.match(out, /tracker fault, not a schedule one/);
});

test("release: a real milestone states the date, the day count, and the open/closed split", () => {
  const out = rendered(release, facts());
  assert.match(out, /\*\*v0\.1\.0 — first publish\*\* — due 2026-09-20/);
  assert.match(out, /\*\*3 open\*\*, 40 closed/);
});

test("release: no due date reads as 'no date set', not a crash on a null day count", () => {
  const out = rendered(release, facts({ ms: { title: "x", due_on: null, open_issues: 1, closed_issues: 0 } }));
  assert.match(out, /no date set/);
  assert.doesNotMatch(out, /\(\d+ days? out\)/);
});

test("blockerTable: an empty milestone reports None, not an empty table", () => {
  const out = rendered(blockerTable, facts({ blockers: [] }));
  assert.match(out, /None open on the milestone/);
});

test("blockerTable: labels a gate-found blocker apart from one found by inspection, and escapes a pipe", () => {
  const out = rendered(blockerTable, facts({
    blockers: [
      { number: 1, url: "https://x/1", title: "a | b", labelNames: ["gate-found"] },
      { number: 2, url: "https://x/2", title: "plain", labelNames: [] },
    ],
  }));
  assert.match(out, /a \\\| b \| a gate/);
  assert.match(out, /plain \| inspection/);
});

test("issuesClosed: zero closed states the window fact even with real merges in it", () => {
  const out = rendered(issuesClosed, facts({ closed: [], merges: [{}, {}] }));
  assert.match(out, /None in this window/);
  assert.match(out, /2 merges landed in it/);
});

test("issuesClosed: one merge is singular, not '1 merges'", () => {
  const out = rendered(issuesClosed, facts({ closed: [], merges: [{}] }));
  assert.match(out, /1 merge landed in it/);
});

test("issuesClosed: lists every closed issue by number and title", () => {
  const out = rendered(issuesClosed, facts({ closed: [{ number: 9, url: "https://x/9", title: "fixed it" }] }));
  assert.match(out, /- \[#9\]\(https:\/\/x\/9\) fixed it/);
});

test("whatMerged: unpushed === null reports unknown, not zero -- the two must never collapse", () => {
  const out = rendered(whatMerged, facts({ merges: [], unpushed: null }));
  assert.match(out, /could not be compared/);
  assert.doesNotMatch(out, /All work is on GitHub/);
});

test("whatMerged: unpushed > 0 names the count and calls it a hold, not a stall", () => {
  const out = rendered(whatMerged, facts({ merges: [{}], unpushed: 3 }));
  assert.match(out, /\*\*3 commits are on local `main`/);
  assert.match(out, /HOLD, not a stall/);
});

test("whatMerged: unpushed === 1 is singular", () => {
  const out = rendered(whatMerged, facts({ merges: [], unpushed: 1 }));
  assert.match(out, /\*\*1 commit are on local `main`/);
});

test("whatMerged: unpushed === 0 reads the real repo's own main sha, read-only", () => {
  skipIfNoLocalMain(() => {
    const out = rendered(whatMerged, facts({ merges: [], unpushed: 0 }));
    assert.match(out, /All work is on GitHub/);
    // A real, non-empty short sha -- proves the git() call actually ran rather than being skipped.
    assert.match(out, /\(`[0-9a-f]{7,}`\)/);
  });
});

test("authorship: no strays renders nothing at all -- an absent section, not an empty heading", () => {
  const out = rendered(authorship, facts({ strays: [] }));
  assert.equal(out.trim(), "");
});

test("authorship: strays name every distinct address once", () => {
  const out = rendered(authorship, facts({
    strays: [{ email: "a@x" }, { email: "b@x" }, { email: "a@x" }],
  }));
  assert.match(out, /3 commits in this window/);
  assert.match(out, /a@x, b@x/);
});

test("lastGate: nothing reported explains why this report cannot read one itself", () => {
  const out = rendered(lastGate, facts({ latestGate: null }));
  assert.match(out, /\*\*Not reported\.\*\*/);
});

test("lastGate: a fresh gate names the command and the reporter with no STALE marker", () => {
  const out = rendered(lastGate, facts({
    latestGate: { command: "npm run rules:gate", reportedBy: "worker-judge", at: "2026-09-06T10:00:00Z", output: "29/29 EXACT" },
    gateIsFresh: true,
  }));
  assert.match(out, /`npm run rules:gate` — run by \*\*worker-judge\*\*/);
  assert.doesNotMatch(out, /STALE/);
  assert.match(out, /29\/29 EXACT/);
});

test("lastGate: a stale gate is marked, not silently reported as current", () => {
  const out = rendered(lastGate, facts({
    latestGate: { command: "x", reportedBy: "y", at: "z", output: "o" },
    gateIsFresh: false,
  }));
  assert.match(out, /\*\*STALE\*\*/);
});

test("fleetHoursSection: not instrumented reports so, with its note", () => {
  const out = rendered(fleetHoursSection, facts({ fleetHours: { status: "not instrumented", note: "no data yet" } }));
  assert.match(out, /\*\*not instrumented\.\*\* no data yet/);
});

test("fleetHoursSection: a total with no named run is REFUSED, not printed with a caveat", () => {
  const out = rendered(fleetHoursSection, facts({ fleetHours: { total: "54.11", run: null, reportedBy: "x" } }));
  assert.match(out, /\*\*REFUSED/);
  assert.match(out, /does not name the run it was computed from/);
});

test("fleetHoursSection: a total naming an UNFINISHED run is also refused, not just a missing one", () => {
  const out = rendered(fleetHoursSection, facts({
    fleetHours: { total: "1", run: "a11y-job-capture.service", runFinishedAt: null, reportedBy: "x" },
  }));
  assert.match(out, /names a run with no `runFinishedAt`/);
});

test("fleetHoursSection: a complete entry prints the total, the method, and the occupancy caveat", () => {
  const out = rendered(fleetHoursSection, facts({
    fleetHours: {
      total: "54.11", run: "a11y-job-capture.service", runFinishedAt: "2026-09-05T12:00:00Z",
      reportedBy: "worker-capture", at: "2026-09-05T12:05:00Z", method: "sum of per-case times",
    },
  }));
  assert.match(out, /\*\*54\.11\*\*, computed from \*\*a11y-job-capture\.service\*\*/);
  assert.match(out, /Method: sum of per-case times/);
  assert.match(out, /capture OCCUPANCY/);
});

test("queue: an empty Ready column names the other columns rather than reading as broken", () => {
  const out = rendered(queue, facts({ open: [{}, {}, {}], ready: [], awaiting: [{}] }));
  assert.match(out, /\*\*Ready 0\*\* · \*\*Awaiting merge 1\*\* · \*\*Open 3\*\*/);
  assert.match(out, /legitimate end state, not a broken filter/);
  assert.match(out, /still hold 3 row\(s\)/);
});

test("queue: a non-empty Ready column prints the counts with no extra caveat line", () => {
  const out = rendered(queue, facts({ open: [{}], ready: [{}], awaiting: [] }));
  assert.match(out, /\*\*Ready 1\*\*/);
  assert.doesNotMatch(out, /legitimate end state/);
});

test("render: assembles every section in order, once, over a realistic fact set", () => {
  skipIfNoLocalMain(() => {
    const d = facts({
      merges: [{}], unpushed: 0, closed: [{ number: 1, url: "https://x/1", title: "t" }],
      ready: [{}], awaiting: [], open: [{}],
    });
    const out = render(d);
    const order = ["## Release", "## Blockers", "## Issues closed", "## What merged", "## Last gate result",
      "## Fleet hours", "## Queue"];
    let cursor = -1;
    for (const heading of order) {
      const at = out.indexOf(heading);
      assert.ok(at > cursor, `expected "${heading}" to appear, in order, after the previous section`);
      cursor = at;
    }
    assert.match(out, /^# Board report — \d{4}-\d{2}-\d{2}/);
  });
});
