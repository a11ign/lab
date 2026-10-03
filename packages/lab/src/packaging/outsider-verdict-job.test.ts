// no-token: gh -- `gh` and `row-file` are injected fakes here, so no case reaches GitHub; the one real call, the leak refusal, throws before anything is spawned.
/**
 * The outsider verdict job's FILING and LABEL behaviour (#3184, `product-manager`'s ruling on the row): `scripts/outsider/verdict-job.mjs` files ONE
 * `regression` row per version, creates the `regression` label only when it is absent (nothing else creates it: ADR 0041, #3135), is idempotent
 * about both, and refuses a body that leaks before anything is sent. `gh` and `row-file` are injected, so no case here can reach GitHub.
 * `outsider-verdict-wired.test.ts` pins the decision, the workflow and the documents.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureRegressionLabel, fileOnce, fileThroughRowFile, regressionTitle, rowFileArgs, FILING_SESSION, REGRESSION_LABEL,
} from "../../../../scripts/outsider/verdict-job.mjs";

/** A fake `gh` over one label list: records every call, and `createFails` makes the create throw as a lost race does. */
function fakeGh({ labels, createFails = false, createdBeforeFail = false }: { labels: string[]; createFails?: boolean; createdBeforeFail?: boolean }) {
  const calls: string[][] = [];
  const present = [...labels];
  const run = (args: string[]): string => {
    calls.push(args);
    if (args[0] === "label" && args[1] === "list") return JSON.stringify(present.map((name) => ({ name })));
    if (args[0] === "label" && args[1] === "create") {
      if (createdBeforeFail) present.push(args[2]);
      if (createFails) throw new Error("HTTP 422: already_exists");
      present.push(args[2]);
      return "";
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  const creates = () => calls.filter((c) => c[1] === "create");
  return { run, calls, creates };
}

test("label ABSENT: the label is created once, with the name the rows are filed under", () => {
  const gh = fakeGh({ labels: ["bug", "out-of-release"] });
  ensureRegressionLabel(gh.run);
  assert.equal(gh.creates().length, 1);
  assert.equal(gh.creates()[0][2], REGRESSION_LABEL);
});

test("label PRESENT: nothing is created, so a second run neither errors nor duplicates", () => {
  const gh = fakeGh({ labels: ["bug", REGRESSION_LABEL] });
  ensureRegressionLabel(gh.run);
  assert.equal(gh.creates().length, 0);
  // The positive control for the line above: the same fake with the label missing DOES create, so "0 creates" is not a fake that never creates.
  const absent = fakeGh({ labels: ["bug"] });
  ensureRegressionLabel(absent.run);
  assert.equal(absent.creates().length, 1);
});

test("a create that LOSES A RACE (the label appeared between the list and the create) is read back and is not an error", () => {
  const gh = fakeGh({ labels: [], createFails: true, createdBeforeFail: true });
  assert.doesNotThrow(() => ensureRegressionLabel(gh.run));
});

test("a create that fails with the label STILL absent is an error carrying its cause, never swallowed", () => {
  const gh = fakeGh({ labels: [], createFails: true });
  assert.throws(() => ensureRegressionLabel(gh.run), (error: Error) =>
    /could not create the `regression` label/.test(error.message) && /already_exists/.test(String(error.cause)));
});

/** A fake of everything `fileOnce` touches, recording the order it was touched in. */
function fakeIo(existingTitles: string[]) {
  const events: string[] = [];
  return {
    events,
    io: {
      titlesFor: () => { events.push("list"); return existingTitles; },
      ensureLabel: () => { events.push("label"); },
      file: (title: string) => { events.push(`file:${title}`); },
    },
  };
}

test("a version with no row: the rows are read, THEN the label ensured, THEN the row filed -- in that order, because a missing label files nothing", () => {
  const { events, io } = fakeIo([]);
  const result = fileOnce({ version: "0.1.1", body: "body" }, io);
  assert.deepEqual(events, ["list", "label", `file:${regressionTitle("0.1.1")}`]);
  assert.equal(result.filed, true);
});

test("a version that already has a row files nothing and touches no label, however often it is read", () => {
  const { events, io } = fakeIo([regressionTitle("0.1.1")]);
  for (let reading = 0; reading < 3; reading++) assert.equal(fileOnce({ version: "0.1.1", body: "body" }, io).filed, false);
  assert.deepEqual(events, ["list", "list", "list"], "three readings of the same red version file nothing and create nothing");
});

test("a row filed for one version does not stop the next version's", () => {
  const { events, io } = fakeIo([regressionTitle("0.1.1")]);
  assert.equal(fileOnce({ version: "0.1.2", body: "body" }, io).filed, true);
  assert.deepEqual(events, ["list", "label", `file:${regressionTitle("0.1.2")}`]);
});

test("the row is filed through agent-org row-file as the job's own session, ready, out of release, and labelled regression", () => {
  const args = rowFileArgs("a title", "/tmp/body.md");
  assert.deepEqual(args.slice(0, 3), ["exec", "agent-org", "row-file"]);
  assert.ok(args.includes(`--session=${FILING_SESSION}`));
  assert.ok(args.includes("--ready"), "never `backlog`");
  const labels = args.flatMap((arg, i) => (args[i - 1] === "--label" ? [arg] : []));
  assert.deepEqual(labels, ["out-of-release", REGRESSION_LABEL]);
  assert.ok(!args.includes("create"), "row-file, never a bare `gh issue create`");
});

test("a body that leaks is REFUSED before anything is spawned", () => {
  // `pct exec <n>` is one of the shared leak patterns; refusing is a throw, so the spawn after it was never reached.
  assert.throws(() => fileThroughRowFile("a title", "run `pct exec 101` on the host"), /pct exec|leak|refus/i);
});
