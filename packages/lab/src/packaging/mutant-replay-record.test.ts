// no-token: gh -- reads docs/mutant-replay.md and pr-open.mjs as text; nothing spawns and nothing reaches GitHub
/**
 * #2415: THE REPLAY RECORD AND THE CODE CANNOT DISAGREE.
 *
 * `ceo` ruled (#928, ruling 1) that the first deliverable is a REPLAY, not a feature: the generator ships only if it
 * surfaces the path the reviewer named on at least 2 of the 3 refusals the row names, and closes as a recorded null
 * result otherwise. The record reads NULL RESULT (`ceo`, 2026-09-25): one exact, one HALF, one miss. So `docs/mutant-replay.md` carries a verdict line, and this file holds three things to it:
 *
 *   1. the record NAMES all three PRs at the commits the reviewer refused, quoting the path the reviewer named, and says for
 *      each whether a survivor covered it and which operators found it (operators that exist in `OPERATORS`);
 *   2. its verdict is `SHIP` exactly when at least 2 of the 3 were found;
 *   3. the wiring in `pr-open.mjs` is present exactly when the verdict is `SHIP`, and the generator is registered as an
 *      npm script only then (`ceo`: unwired means unwired).
 *
 * A HALF is not a find: `Found:` is `yes`, `half` or `no`, and only `yes` counts. The strict reading is `ceo`'s, because
 * the looser one (file, line and kind) lets the author of the operators decide what counts as found.
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
const MIN_QUOTE = 40;

type Found = "yes" | "half" | "no";
type Replay = { pr: string; commit: string; quote: string; found: Found; operators: string[]; survivor: string };

/** The `### #<n> at `<sha>`` sections of a record, each read into its stated fields. */
function replaysIn(text: string): Replay[] {
  return text.split(/^### /m).slice(1).flatMap((section) => {
    const head = /^#(\d+) at `([0-9a-f]{8,40})`/.exec(section);
    if (!head) return [];
    const field = (name: string) => new RegExp(`^- ${name}: (.*)$`, "m").exec(section)?.[1].trim() ?? "";
    const quote = [...section.matchAll(/^> (.*)$/gm)].map((m) => m[1]).join(" ");
    const operators = field("Operators that found it").split(",").map((o) => o.trim().replace(/`/g, "")).filter((o) => o && o !== "none");
    const stated = field("Found");
    const found: Found = stated === "yes" || stated === "half" ? stated : "no";
    return [{ pr: head[1], commit: head[2], quote, found, operators, survivor: field("Survivor covering it") }];
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
const wiredIn = (source: string) => /mutant-survivors\.mjs|A11Y_SURVIVORS_BUDGET|## Survivors/.test(source);

/** Whether a `package.json` registers the generator as a script. */
const registeredIn = (packageJson: string) => Object.values(JSON.parse(packageJson).scripts ?? {}).some((c) => /mutant-survivors/.test(String(c)));

const replays = replaysIn(RECORD);
const found = replays.filter((r) => r.found === "yes").length;

test("the record names all three PRs at the commits the reviewer refused, and each quotes the path the reviewer named", () => {
  // The emptiness control: three sections were parsed, so the per-section assertions below ran three times.
  assert.deepEqual(replays.map((r) => r.pr).sort(), Object.keys(REFUSED).sort());
  for (const r of replays) {
    const at = `#${r.pr}`;
    assert.ok(r.commit.startsWith(REFUSED[r.pr]), `${at} is replayed at a commit that is not the refused ${REFUSED[r.pr]}`);
    assert.ok(r.quote.length >= MIN_QUOTE, `${at}: the reviewer's path is quoted from the refusal, not paraphrased`);
  }
});

test("each replay says whether a survivor covered the path, and a `yes` names the survivor and real operators", () => {
  for (const r of replays) {
    const at = `#${r.pr}`;
    if (r.found !== "no") {
      assert.notDeepEqual(r.operators, [], `${at}: found or half found, so an operator found it`);
      assert.match(r.survivor, /\S+:\d+/, `${at}: found or half found, so the surviving file:line is named`);
    } else {
      assert.deepEqual(r.operators, [], `${at}: not found, so no operator is credited`);
    }
    for (const id of r.operators) {
      assert.ok(OPERATORS.some((o) => o.id === id), `${at}: \`${id}\` is not an operator in mutant-survivors.mjs`);
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

test("the generator is an npm script only when the verdict is SHIP (the root package.json is the one that registers scripts)", () => {
  // The positive control lives in `registeredIn`'s fixtures below: the same reader says yes to a package that does register it.
  assert.equal(registeredIn(readFileSync(join(REPO, "package.json"), "utf8")), verdictOf(RECORD) === "SHIP");
});

test("a NULL RESULT record says what the operators missed and why, and that 1 exact plus a half is what was found", () => {
  assert.match(RECORD, /no operator replaces the\s+`<\$\{element\}>` interpolation/);
  assert.match(RECORD, /12 of 695/);
  assert.match(RECORD, /1 of 3 \(one exact, one half, one miss\)/);
  assert.equal(replays.find((r) => r.pr === "2392")?.found, "half", "#2392 is a half and a half is not a find");
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
    `- Found: ${f}`, `- Operators that found it: ${f === "no" ? "none" : "arg-empty"}`,
    `- Survivor covering it: ${f === "no" ? "none" : "a.mjs:1"}`].join("\n")),
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
  assert.deepEqual(read.map((r) => r.found), ["yes", "no", "yes"]);
  assert.deepEqual(read[0].operators, ["arg-empty"]);
  assert.deepEqual(read[1].operators, []);
});

test("a half is read as a half and is not counted: two exact plus a half is 2, one exact plus a half is 1", () => {
  const half = replaysIn(fixture("NULL RESULT", ["yes", "half", "no"]));
  assert.deepEqual(half.map((r) => r.found), ["yes", "half", "no"]);
  assert.equal(half.filter((r) => r.found === "yes").length, 1);
  assert.equal(verdictFor(half.filter((r) => r.found === "yes").length), "NULL RESULT");
  assert.equal(replaysIn(fixture("SHIP", ["yes", "half", "yes"])).filter((r) => r.found === "yes").length, 2);
});

test("wiredIn sees the import, the budget variable and the section heading, and none of them in a source without them", () => {
  assert.equal(wiredIn('import { survivorsFor } from "../../guards/src/mutant-survivors.mjs";'), true);
  assert.equal(wiredIn("const budget = env.A11Y_SURVIVORS_BUDGET;"), true);
  assert.equal(wiredIn("body + '\\n\\n## Survivors\\n'"), true);
  assert.equal(wiredIn('import { sandboxGitEnv } from "../../guards/src/git-env.mjs";'), false);
});

test("registeredIn sees a script that runs the generator, and not one that does not", () => {
  assert.equal(registeredIn('{"scripts":{"survivors":"node packages/guards/src/mutant-survivors.mjs run"}}'), true);
  assert.equal(registeredIn('{"scripts":{"mutate":"node packages/guards/src/mutation-check.mjs"}}'), false);
  assert.equal(registeredIn("{}"), false);
});
