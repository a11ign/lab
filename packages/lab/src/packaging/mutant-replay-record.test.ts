// no-token: gh -- reads docs/mutant-replay.md and pr-open.mjs as text; nothing spawns and nothing reaches GitHub
/**
 * #2415: THE REPLAY RECORD AND THE CODE CANNOT DISAGREE.
 *
 * `ceo` ruled (#928, ruling 1) that the first deliverable is a REPLAY, not a feature: the generator ships only if it
 * surfaces the path the reviewer named on at least 2 of the 3 refusals the row names, and closes as a recorded null
 * result otherwise. So `docs/mutant-replay.md` carries a verdict line, and this file holds three things to it:
 *
 *   1. the record NAMES all three PRs at the commits the reviewer refused, quoting the path the reviewer named, and says for
 *      each whether a survivor covered it and which operators found it (operators that exist in `OPERATORS`);
 *   2. its verdict is `SHIP` exactly when at least 2 of the 3 were found;
 *   3. the wiring in `pr-open.mjs` is present exactly when the verdict is `SHIP`.
 *
 * Both directions of (2) and (3) are checked by `verdictFor` and `wiredIn` against fixtures, because a check that
 * has only ever read the one record in the tree has only ever been shown to agree with it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OPERATORS } from "../../../guards/src/mutant-survivors.mjs";

const REPO = join(import.meta.dirname, "../../../..");
const RECORD = readFileSync(join(REPO, "docs/mutant-replay.md"), "utf8");
const PR_OPEN = readFileSync(join(REPO, "packages/agent-org/src/pr-open.mjs"), "utf8");

/** The three refusals the row names, at the commits the reviewer refused (2026-09-24). */
const REFUSED: Record<string, string> = { "2384": "9eee4fdb", "2368": "011da083", "2392": "0c929352" };
const MIN_FOUND = 2;

type Replay = { pr: string; commit: string; quote: string; found: boolean; operators: string[]; survivor: string };

/** The `### #<n> at `<sha>`` sections of a record, each read into its stated fields. */
function replaysIn(text: string): Replay[] {
  return text.split(/^### /m).slice(1).flatMap((section) => {
    const head = /^#(\d+) at `([0-9a-f]{8,40})`/.exec(section);
    if (!head) return [];
    const field = (name: string) => new RegExp(`^- ${name}: (.*)$`, "m").exec(section)?.[1].trim() ?? "";
    const quote = [...section.matchAll(/^> (.*)$/gm)].map((m) => m[1]).join(" ");
    const operators = field("Operators that found it").split(",").map((o) => o.trim().replace(/`/g, "")).filter((o) => o && o !== "none");
    return [{ pr: head[1], commit: head[2], quote, found: field("Found") === "yes", operators, survivor: field("Survivor covering it") }];
  });
}

/** The record's verdict, or null when there is not exactly one verdict line. */
function verdictOf(text: string): "SHIP" | "NULL RESULT" | null {
  const lines = [...text.matchAll(/^Verdict: (SHIP|NULL RESULT)\s*$/gm)];
  return lines.length === 1 ? (lines[0][1] as "SHIP" | "NULL RESULT") : null;
}

/** What the verdict MUST be for a count of paths found. */
const verdictFor = (found: number) => (found >= MIN_FOUND ? "SHIP" : "NULL RESULT");

/** Whether `pr-open.mjs`, as text, imports the generator. */
const wiredIn = (source: string) => /from "\.\.\/\.\.\/guards\/src\/mutant-survivors\.mjs"/.test(source);

const replays = replaysIn(RECORD);
const found = replays.filter((r) => r.found).length;

test("the record names all three PRs at the commits the reviewer refused, and each quotes the path the reviewer named", () => {
  // The emptiness control: three sections were parsed, so the per-section assertions below ran three times.
  assert.deepEqual(replays.map((r) => r.pr).sort(), Object.keys(REFUSED).sort());
  for (const r of replays) {
    assert.ok(r.commit.startsWith(REFUSED[r.pr]), `#${r.pr} is replayed at ${r.commit}, not the refused ${REFUSED[r.pr]}`);
    assert.ok(r.quote.length >= 40, `#${r.pr}: the reviewer's path is quoted from the refusal, not paraphrased (${r.quote.length} chars)`);
  }
});

test("each replay says whether a survivor covered the path, and a `yes` names the survivor and real operators", () => {
  for (const r of replays) {
    if (r.found) {
      assert.ok(r.operators.length > 0, `#${r.pr}: found, so an operator found it`);
      assert.match(r.survivor, /\S+:\d+/, `#${r.pr}: found, so the surviving file:line is named`);
    } else {
      assert.deepEqual(r.operators, [], `#${r.pr}: not found, so no operator is credited`);
    }
    for (const id of r.operators) {
      assert.ok(OPERATORS.some((o) => o.id === id), `#${r.pr}: \`${id}\` is not an operator in mutant-survivors.mjs`);
    }
  }
});

test("the verdict is SHIP only when at least 2 of the 3 were found, and the stated count is the counted one", () => {
  assert.equal(verdictOf(RECORD), verdictFor(found), `${found} of 3 found`);
  assert.match(RECORD, new RegExp(`^Found: ${found} of 3\\b`, "m"));
});

test("the wiring in pr-open.mjs is present exactly when the verdict is SHIP", () => {
  assert.equal(wiredIn(PR_OPEN), verdictOf(RECORD) === "SHIP");
});

test("the record says its replay was in-sample: the operators were written after the refusals were read", () => {
  assert.match(RECORD, /in-sample/i);
});

// ---------------------------------------------------------------------------------------------------------------
// The three checks above have only ever read ONE record. These read fixtures, in both directions.
// ---------------------------------------------------------------------------------------------------------------

const fixture = (verdict: string, founds: string[]) => [
  `Verdict: ${verdict}`, `Found: ${founds.filter((f) => f === "yes").length} of 3`,
  ...founds.map((f, i) => [`### #${2384 + i} at \`${Object.values(REFUSED)[i]}00\``, "> " + "x".repeat(45),
    `- Found: ${f}`, `- Operators that found it: ${f === "yes" ? "arg-empty" : "none"}`,
    `- Survivor covering it: ${f === "yes" ? "a.mjs:1" : "none"}`].join("\n")),
].join("\n\n");

test("verdictFor: 2 of 3 ships and 1 of 3 does not, and a record with two verdict lines has none", () => {
  assert.equal(verdictFor(3), "SHIP");
  assert.equal(verdictFor(2), "SHIP");
  assert.equal(verdictFor(1), "NULL RESULT");
  assert.equal(verdictFor(0), "NULL RESULT");
  assert.equal(verdictOf(fixture("SHIP", ["yes", "yes", "no"])), "SHIP");
  assert.equal(verdictOf(fixture("NULL RESULT", ["yes", "no", "no"])), "NULL RESULT");
  assert.equal(verdictOf(`${fixture("SHIP", ["yes", "yes", "no"])}\nVerdict: NULL RESULT\n`), null);
  assert.equal(verdictOf("no verdict here"), null);
});

test("replaysIn reads the fixture's three sections and counts the found ones", () => {
  const read = replaysIn(fixture("SHIP", ["yes", "no", "yes"]));
  assert.equal(read.length, 3);
  assert.deepEqual(read.map((r) => r.found), [true, false, true]);
  assert.deepEqual(read[0].operators, ["arg-empty"]);
  assert.deepEqual(read[1].operators, []);
});

test("wiredIn sees the import in the source and does not see it in a source without it", () => {
  assert.equal(wiredIn('import { survivorsFor } from "../../guards/src/mutant-survivors.mjs";'), true);
  assert.equal(wiredIn('import { sandboxGitEnv } from "../../guards/src/git-env.mjs";'), false);
});
