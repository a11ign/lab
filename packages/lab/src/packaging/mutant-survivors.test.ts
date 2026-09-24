// no-token: gh -- nothing here spawns gh, git or a test run: the diff, the file reads and every mutant run are injected
/**
 * #2415: THE MACHINE-CHOSEN MUTANT GENERATOR (`packages/guards/src/mutant-survivors.mjs`), driven with no repository.
 *
 * The three rulings it builds to each have a test here: ADVISORY (a survivor never moves the exit code), CAPPED
 * (the cap is said, with the number cut), and BOUNDED (over budget it says "DID NOT FINISH" and how many never
 * ran, and never lists fewer without saying so). The operator cases use the reviewer's OWN mutants from the
 * three refusals the replay reads (`docs/mutant-replay.md`), so an operator that stopped finding them fails here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAcceptanceSection } from "../../../agent-org/src/acceptance-commands.mjs";
import { main as prOpenMain, survivorsOfThisTree, withBody, withSurvivorsSection } from "../../../agent-org/src/pr-open.mjs";
import {
  OPERATORS, applyMutant, changedLines, chooseMutants, hunt, mutateRunner, renderSurvivors, survivorsFor,
} from "../../../guards/src/mutant-survivors.mjs";

/** The one mutated text an operator gives a line, by its id, or the list of them. */
const mutantsOf = (id: string, line: string) => {
  const operator = OPERATORS.find((o) => o.id === id)!;
  return operator.sites(line).map((s) => line.slice(0, s.start) + s.replacement + line.slice(s.end));
};

const DIFF = [
  "diff --git a/packages/lab/scripts/build.mjs b/packages/lab/scripts/build.mjs",
  "--- a/packages/lab/scripts/build.mjs",
  "+++ b/packages/lab/scripts/build.mjs",
  "@@ -10,0 +11,2 @@ function x() {",
  "@@ -20 +22 @@ y",
  "@@ -30,2 +33,0 @@ z",
  "diff --git a/docs/x.md b/docs/x.md",
  "--- a/docs/x.md",
  "+++ b/docs/x.md",
  "@@ -1 +1 @@",
  "diff --git a/gone.mjs b/gone.mjs",
  "--- a/gone.mjs",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
].join("\n");

test("changedLines reads the added lines of each hunk: a count, a bare line, and a pure deletion adds none", () => {
  const changed = changedLines(DIFF);
  assert.deepEqual([...changed.get("packages/lab/scripts/build.mjs")!].sort((a, b) => a - b), [11, 12, 22]);
  assert.deepEqual([...changed.get("docs/x.md")!], [1]);
  // A deleted file has no `+++ b/` header, so its `@@ -1,3 +0,0` hunk is attributed to no file at all.
  assert.equal(changed.has("gone.mjs"), false);
  assert.equal(changed.has("/dev/null"), false);
});

test("arg-empty finds the reviewer's #2384 mutant, and leaves a definition and a literal argument alone", () => {
  const line = "    rejectedAsTruncated: rejectedAsTruncated(rejected),";
  assert.deepEqual(mutantsOf("arg-empty", line), ["    rejectedAsTruncated: rejectedAsTruncated([]),"]);
  assert.deepEqual(mutantsOf("arg-empty", "function writeProvenance(baseText, records, census) {"), []);
  assert.deepEqual(mutantsOf("arg-empty", "  handle(request) {"), []);
  // A signature whose `{` is on the next line is still a definition, by the word before its name.
  assert.deepEqual(mutantsOf("arg-empty", "export function writeProvenance(baseText, records)"), []);
  assert.deepEqual(mutantsOf("arg-empty", "export function* walk(nodes)"), []);
  // A keyword before a parenthesis is not a call: `if (ready)` must not become `if ([])`.
  for (const line of ["  if (ready) go();", "  while (more) step();", "  const f = async (event) => 1;", "  return (value);",
    "  await (pending);", "  switch (kind) {", "  } catch (error) {", "  const c = new Thing;"]) {
    assert.deepEqual(mutantsOf("arg-empty", line), [], line);
  }
  // A method call's callee is the whole dotted path, so its ARGUMENTS are the sites and its receiver is not.
  assert.deepEqual(mutantsOf("arg-empty", "  results.finish(id, body);"), ["  results.finish([], body);", "  results.finish(id, []);"]);
  assert.deepEqual(mutantsOf("arg-empty", "  send(res, 400, null, undefined, true);"), ["  send([], 400, null, undefined, true);"]);
  // Two calls on one line are two sites; a comma inside a string does not split an argument.
  assert.equal(mutantsOf("arg-empty", "  join(a, split(b, ',', c));").length, 3);
});

test("cond-false finds the reviewer's #2392 mutant: a ternary's test forced false, so the field never renders", () => {
  const line = "  label ? `<label for=\"ref\">${label}</label>` : \"\";";
  assert.deepEqual(mutantsOf("cond-false", line), ["  false ? `<label for=\"ref\">${label}</label>` : \"\";"]);
  assert.deepEqual(mutantsOf("cond-false", "  if (a && (b || c)) run();"), ["  if (false) run();"]);
  assert.deepEqual(mutantsOf("cond-false", "  const x = a?.b ?? c;"), []);
});

test("return-null, sort-removed, spread-emptied and flip each find their own site and no other", () => {
  assert.deepEqual(mutantsOf("return-null", "  return total + 1;"), ["  return null;"]);
  assert.deepEqual(mutantsOf("return-null", "  return null;"), []);
  assert.deepEqual(mutantsOf("return-null", "  return ["), []);
  assert.deepEqual(mutantsOf("sort-removed", "  .sort((a, b) => a - b)"), ["  "]);
  assert.deepEqual(mutantsOf("spread-emptied", "  { ...(fault ? { fault } : {}), ok }"), ["  { ...[], ok }"]);
  assert.deepEqual(mutantsOf("spread-emptied", "  [...rows, 1]"), ["  [...[], 1]"]);
  assert.deepEqual(mutantsOf("flip", "  if (a === b && c < d) {}"), ["  if (a !== b && c < d) {}", "  if (a === b || c < d) {}", "  if (a === b && c <= d) {}"]);
  // `=>` and a generic's `<` are not comparisons.
  assert.deepEqual(mutantsOf("flip", "  const f = (a) => new Map<string, number>();"), []);
});

test("applyMutant changes exactly one line, and returns null for a mutant that does not exist", () => {
  const text = ["a", "  return x;", "  return y;"].join("\n");
  assert.equal(applyMutant(text, { line: 2, operator: "return-null", occurrence: 0 }), "a\n  return null;\n  return y;");
  assert.equal(applyMutant(text, { line: 2, operator: "return-null", occurrence: 1 }), null);
  assert.equal(applyMutant(text, { line: 9, operator: "return-null", occurrence: 0 }), null);
  assert.equal(applyMutant(text, { line: 2, operator: "no-such-operator", occurrence: 0 }), null);
});

test("chooseMutants reads only ADDED lines of SOURCE files, never a test file, a comment or a doc", () => {
  const files: Record<string, string> = {
    "a.mjs": "// f(x) === y, and  * g(z)\n  return one;\n  return two;",
    "a.test.ts": "  return three;",
    "b.ts": "  return four;",
    "notes.md": "  return five;",
  };
  const changed = new Map(Object.keys(files).map((f) => [f, new Set([1, 2, 3])]));
  const found = chooseMutants(changed, (f) => files[f] ?? null);
  assert.deepEqual(found.map((m) => `${m.file}:${m.line}`), ["a.mjs:2", "b.ts:1", "a.mjs:3"]);
  assert.equal(found[0].before, "return one;");
  assert.equal(found[0].after, "return null;");
});

test("chooseMutants deals round-robin across files, so one big file cannot spend the whole budget", () => {
  const big = Array.from({ length: 20 }, (_, i) => `  return v${i};`).join("\n");
  const files: Record<string, string> = { "big.mjs": big, "small.mjs": "  return s;" };
  const changed = new Map([["big.mjs", new Set(Array.from({ length: 20 }, (_, i) => i + 1))], ["small.mjs", new Set([1])]]);
  const order = chooseMutants(changed, (f) => files[f]).map((m) => m.file);
  assert.deepEqual(order.slice(0, 3), ["big.mjs", "small.mjs", "big.mjs"]);
  assert.equal(order.length, 21);
});

const M = (n: number) => ({ file: "f.mjs", line: n, operator: "arg-empty", occurrence: 0, before: `b${n}`, after: `a${n}` });

test("hunt: 0 kills, 1 survives, and 2 says nothing either way; a survivor is listed and never changes the result's exit", () => {
  const codes: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 1 };
  const result = hunt({ mutants: [M(1), M(2), M(3), M(4)], runMutant: (m) => codes[m.line], budgetSeconds: 60 });
  assert.deepEqual([result.total, result.ran, result.killed, result.unknown], [4, 4, 1, 1]);
  assert.deepEqual(result.survivors.map((m) => m.line), [2, 4]);
  assert.equal(result.finished, true);
});

test("hunt: over budget it stops STARTING mutants, says so, and counts what never ran", () => {
  let clock = 0;
  const ran: number[] = [];
  const result = hunt({
    mutants: [M(1), M(2), M(3), M(4), M(5)],
    runMutant: (m) => { ran.push(m.line); clock += 40_000; return 1; },
    budgetSeconds: 100, now: () => clock,
  });
  // 0s, 40s and 80s are inside the 100s budget; 120s is not.
  assert.deepEqual(ran, [1, 2, 3]);
  assert.equal(result.finished, false);
  const text = renderSurvivors(result).join("\n");
  assert.match(text, /DID NOT FINISH: ran 3 of 5 mutants in the 100s budget; 2 were never run/);
  assert.match(text, /may be missing survivors/);
});

test("hunt: a failed restore stops the hunt at once, because every later reading would be off a changed tree", () => {
  const ran: number[] = [];
  const result = hunt({ mutants: [M(1), M(2), M(3)], runMutant: (m) => { ran.push(m.line); return m.line === 2 ? 3 : 0; }, budgetSeconds: 60 });
  assert.deepEqual(ran, [1, 2]);
  assert.equal(result.restoreFailed?.line, 2);
  assert.match(renderSurvivors(result).join("\n"), /the restore of `f.mjs:2` FAILED, so the hunt stopped/);
});

test("renderSurvivors says its cap and how many it cut, and says when it cut nothing", () => {
  const survivors = Array.from({ length: 7 }, (_, i) => M(i + 1));
  const hunted = { total: 9, ran: 9, killed: 2, unknown: 0, budgetSeconds: 60, survivors, finished: true, restoreFailed: null };
  const capped = renderSurvivors(hunted, { cap: 3 });
  assert.match(capped[0], /^Survivors: 7 of 9 mutants run survived/);
  assert.match(capped[0], /ADVISORY: nothing here refuses this PR/);
  assert.equal(capped.filter((l) => l.startsWith("- ")).length, 3);
  assert.ok(capped.includes("Cap: 3. 4 more survivors were CUT from this list."));
  assert.ok(renderSurvivors(hunted, { cap: 10 }).includes("Cap: 10. Nothing was cut."));
  assert.doesNotMatch(capped.join("\n"), /DID NOT FINISH/);
});

test("survivorsFor: survivors exit 0 (advisory), and only a failed restore exits 3", () => {
  const diff = ["+++ b/a.mjs", "@@ -1,0 +1,2 @@"].join("\n");
  const read = () => "  return one;\n  return two;";
  const alwaysSurvives = survivorsFor({ diff, read, runMutant: () => 1 });
  assert.equal(alwaysSurvives.hunt.survivors.length, 2);
  assert.equal(alwaysSurvives.exitCode, 0);
  assert.equal(survivorsFor({ diff, read, runMutant: () => 0 }).exitCode, 0);
  assert.equal(survivorsFor({ diff, read, runMutant: () => 3 }).exitCode, 3);
  // Positive control for the emptiness: a diff with no source line asks for no run at all.
  const none = survivorsFor({ diff: "+++ b/notes.md\n@@ -1 +1 @@", read, runMutant: () => { throw new Error("must not run"); } });
  assert.deepEqual([none.hunt.total, none.hunt.ran, none.exitCode], [0, 0, 0]);
});

test("mutateRunner returns mutation-check's own exit code, and puts back a file a killed check left mutated", () => {
  const dir = mkdtempSync(join(tmpdir(), "mutant-runner-"));
  const file = join(dir, "f.mjs");
  writeFileSync(file, "ORIGINAL\n");
  const mutant = { ...M(1), file: "f.mjs" };
  const argvSeen: string[][] = [];
  const spawnFake = (leave: string | null, status: number | null, said = "") => ((_cmd: string, argv: string[]) => {
    argvSeen.push(argv);
    if (leave !== null) writeFileSync(file, leave);
    return { status, stdout: said, stderr: "" };
  }) as never;
  const BITES = "THE GUARD BITES.";
  const DID_NOT = "THE GUARD DID NOT BITE.";
  assert.equal(mutateRunner({ cwd: dir, test: "T", spawn: spawnFake(null, 1, DID_NOT) })(mutant), 1);
  assert.equal(mutateRunner({ cwd: dir, test: "T", spawn: spawnFake(null, 0, BITES) })(mutant), 0);
  assert.ok(argvSeen[0].includes("--test=T") && argvSeen[0].includes("--file=f.mjs"));
  assert.match(argvSeen[0].find((a) => a.startsWith("--mutate="))!, /apply --file=f\.mjs --line=1 --operator=arg-empty --occurrence=0$/);
  assert.equal(mutateRunner({ cwd: dir, test: "T", spawn: spawnFake(null, null) })(mutant), 2);
  // The check "ran", left the mutant on disk, and exited 0: what it says is not to be believed.
  assert.equal(mutateRunner({ cwd: dir, test: "T", spawn: spawnFake("MUTATED\n", 0, BITES) })(mutant), 3);
  assert.equal(readFileSync(file, "utf8"), "ORIGINAL\n");
});

test("mutateRunner does not read a CRASH as a survivor: exit 1 without mutate's own sentence says nothing either way", () => {
  const dir = mkdtempSync(join(tmpdir(), "mutant-crash-"));
  writeFileSync(join(dir, "f.mjs"), "X\n");
  const crashed = (() => ({ status: 1, stdout: "", stderr: "Error: Cannot find module" })) as never;
  const silentPass = (() => ({ status: 0, stdout: "", stderr: "" })) as never;
  assert.equal(mutateRunner({ cwd: dir, test: "T", spawn: crashed })({ ...M(1), file: "f.mjs" }), 2);
  assert.equal(mutateRunner({ cwd: dir, test: "T", spawn: silentPass })({ ...M(1), file: "f.mjs" }), 2);
});

// ---------------------------------------------------------------------------------------------------------------
// The wiring in `pr-open.mjs` (present exactly when `docs/mutant-replay.md` reads SHIP: mutant-replay-record.test.ts).
// ---------------------------------------------------------------------------------------------------------------

const BODY = "## Acceptance\n\nnode -e \"process.exit(0)\"\n\nCloses #1\n";
const SECTION = ["Survivors: 1 of 3 mutants run survived the named tests (ADVISORY).", "- `a.mjs:2` arg-empty: `f(x)` -> `f([])`"];
const noGit = () => "";

test("the section is appended after a blank line and a heading, so Acceptance still reads what it read", () => {
  const extended = withSurvivorsSection(BODY, SECTION);
  assert.ok(extended.startsWith(BODY.trimEnd()));
  assert.match(extended, /\n\n## Survivors\n\nSurvivors: 1 of 3/);
  assert.deepEqual(extractAcceptanceSection(extended), extractAcceptanceSection(BODY));
  // Idempotent: a body that already carries one gets ITS section replaced, not a second.
  const twice = withSurvivorsSection(extended, ["Survivors: 0 of 3 mutants run survived the named tests (ADVISORY)."]);
  assert.equal(twice.match(/## Survivors/g)?.length, 1);
  assert.doesNotMatch(twice, /1 of 3/);
  assert.ok(twice.startsWith(BODY.trimEnd()), "replacing the old section keeps everything before it");
});

test("withBody swaps --body in place, and for --body-file writes a NEW file and leaves the author's alone", () => {
  assert.deepEqual(withBody(["--draft", "--body", "old", "--title", "t"], "new"), ["--draft", "--body", "new", "--title", "t"]);
  const dir = mkdtempSync(join(tmpdir(), "pr-body-src-"));
  const theirs = join(dir, "body.md");
  writeFileSync(theirs, "old");
  const args = withBody(["--body-file", theirs], "new");
  assert.notEqual(args[1], theirs);
  assert.equal(readFileSync(args[1], "utf8"), "new");
  assert.equal(readFileSync(theirs, "utf8"), "old");
});

/** `main` with every seam a fake, returning what `gh` was handed and what was printed. */
function driveMain(mode: string, survivors: unknown, body = BODY) {
  const sent: string[][] = [];
  const printed: string[] = [];
  const code = prOpenMain([mode, ...(mode === "edit" ? ["7"] : []), "--body", body], {
    runAcceptance: () => 0, runMutation: () => 0, survivors: survivors as never,
    run: (args: string[]) => { sent.push(args); }, git: (args: string[]) => (args.includes("--abbrev-ref") ? "b" : "o"), owner: () => null,
    prHead: () => ({ ref: "b", oid: "o" }), out: (l: string) => printed.push(l), err: () => {},
  });
  return { sent, printed, code };
}

test("main: a create sends the body WITH the section; an edit sends the body it was given; both exit as before", () => {
  const seen: string[] = [];
  const found = (given: string) => { seen.push(given); return { lines: SECTION, section: true }; };
  const created = driveMain("create", found);
  assert.deepEqual(seen, [BODY], "it is handed the body the author wrote");
  assert.equal(created.code, 0);
  assert.deepEqual(created.sent[0].slice(0, 2), ["pr", "create"], "the section changes the body and nothing else");
  const createdBody = created.sent[0][created.sent[0].indexOf("--body") + 1];
  assert.equal(createdBody, withSurvivorsSection(BODY, SECTION));
  assert.ok(created.printed.join("").includes(SECTION[1]));
  const edited = driveMain("edit", found);
  assert.equal(edited.sent[0][edited.sent[0].indexOf("--body") + 1], BODY, "an edit re-sends the author's body");
  assert.equal(edited.code, 0);
});

test("main: with no `survivors` seam nothing runs and the body is untouched (every other test's shape)", () => {
  const plain = driveMain("create", undefined);
  assert.equal(plain.sent[0][plain.sent[0].indexOf("--body") + 1], BODY);
});

test("main: a survivor list never changes the exit code -- a SKIPPED run is printed and sends the body as it was", () => {
  const skipped = driveMain("create", () => ({ lines: ["Survivors: SKIPPED -- x."], section: false }));
  assert.equal(skipped.code, 0);
  assert.ok(skipped.printed.includes("Survivors: SKIPPED -- x.\n"));
  assert.equal(skipped.sent[0][skipped.sent[0].indexOf("--body") + 1], BODY);
});

test("main: a section that would trip the leak scan is NOT appended, and the body goes as the author wrote it", () => {
  const leaky = { lines: [`- \`a.mjs:2\` arg-empty: \`host = "${["10", "1", "2", "3"].join(".")}"\``], section: true };
  const { sent, printed, code } = driveMain("create", () => leaky);
  assert.equal(code, 0);
  assert.equal(sent[0][sent[0].indexOf("--body") + 1], BODY);
  assert.ok(printed.some((l) => l.startsWith("Survivors: NOT APPENDED")));
});

test("survivorsOfThisTree: budget 0 and a body with no Acceptance command are SKIPPED, each saying why", () => {
  const never = () => { throw new Error("must not run"); };
  const off = survivorsOfThisTree(BODY, { git: noGit, diff: never, env: { A11Y_SURVIVORS_BUDGET: "0" }, runMutant: never });
  assert.deepEqual([off.section, off.lines[0]], [false, "Survivors: SKIPPED -- A11Y_SURVIVORS_BUDGET is 0."]);
  const bare = survivorsOfThisTree("Closes #1", { git: noGit, diff: never, env: {}, runMutant: never });
  assert.match(bare.lines[0], /^Survivors: SKIPPED -- the body names no Acceptance command/);
  const broken = survivorsOfThisTree(BODY, { git: () => { throw new Error("no origin/main\nsecond line"); }, env: {}, runMutant: never });
  assert.deepEqual([broken.section, broken.lines[0]], [false, "Survivors: SKIPPED -- it could not run (no origin/main)."]);
});

test("survivorsOfThisTree: names the Acceptance commands as the tests, and lists what the injected runner leaves alive", () => {
  const root = mkdtempSync(join(tmpdir(), "survivors-tree-"));
  writeFileSync(join(root, "a.mjs"), "  return one;\n  return two;\n");
  const diff = ["+++ b/a.mjs", "@@ -1,0 +1,2 @@"].join("\n");
  const git = (args: string[]) => (args[0] === "rev-parse" ? root : "base");
  const found = survivorsOfThisTree(BODY, { git, diff: () => diff, env: {}, runMutant: (m) => (m.line === 1 ? 1 : 0) });
  assert.equal(found.section, true);
  assert.match(found.lines[0], /^Survivors: 1 of 2 mutants run survived/);
  assert.ok(found.lines.some((l) => l.includes("`a.mjs:1` return-null: `return one;` -> `return null;`")));
});

test("WIRING: the CLI entry block hands `main` the real `survivors`, and `main` is off without it", () => {
  const source = readFileSync(join(import.meta.dirname, "../../../agent-org/src/pr-open.mjs"), "utf8");
  assert.match(source, /process\.exitCode = main\(process\.argv\.slice\(2\), \{ survivors: survivorsOfThisTree \}\)/);
  assert.match(source, /from "\.\.\/\.\.\/guards\/src\/mutant-survivors\.mjs"/);
});
