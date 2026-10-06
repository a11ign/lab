/**
 * #3421 (chairman messaging B5): THE LIAISON'S BRIEF BINDS IT, AND THE FACTS IT NAMES ARE THE ONES IT MAY STATE.
 *
 * Three things are read: the brief carries the sentences that bind the seat; every `{{placeholder}}` it names is in the
 * closed vocabulary; and the roster has the seat, persistent, with a brief that exists.
 *
 * THE VOCABULARY IS RESTATED, NOT IMPORTED. The list is `PLACEHOLDER_NAMES` in a11ign/agent-org's
 * `src/messaging/placeholders.mjs` (B3, #3420), and ADR 0041 forbids this repository importing across the boundary.
 * So the copy below is the pin on this side, and `placeholders.test.mjs` pins the other: a name added there is a name
 * the brief must learn, and this test fails until it does. The comparison runs BOTH ways for that reason: a name the
 * brief invents, and a name the vocabulary has that the brief never teaches.
 *
 * Positive controls: each obligation is run against a copy of the brief with it broken, so a checker that finds
 * nothing to check cannot pass (`.claude/rules/guards-and-assertions.md`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const read = (relPath: string) => readFileSync(resolve(ROOT, relPath), "utf8");
const BRIEF = ".agent-org/roles/liaison.md";
const SESSIONS = ".agent-org/roles/sessions.json";

/** B3's `PLACEHOLDER_NAMES`, restated (a11ign/agent-org `src/messaging/placeholders.mjs`, read at 6849076). */
const VOCABULARY = [
  "issue:<number>.number", "issue:<number>.state", "issue:<number>.labels",
  "pr:<number>.number", "pr:<number>.state", "pr:<number>.review",
  "run:<id>.status", "run:<id>.conclusion",
  "ready.count",
  "last-merge.age",
  "unit:<unit>.state",
  "comment:<id>.quote",
  "fleet.workers-up", "fleet.workers-down",
  "gate.last-tick.age",
  "release:<repo>.latest",
];

/** The shape that matters is `kind[:id].field`; which id a brief writes in the id's place is not part of the name. */
const GRAMMAR = /^([a-z]+(?:-[a-z]+)*)(?::(.+))?\.([a-z]+(?:[-.][a-z]+)*)$/;
const canonical = (spec: string): string => {
  const match = GRAMMAR.exec(spec);
  assert.ok(match, `"${spec}" is not of the form kind[:id].field`);
  const [, kind, id, field] = match;
  return `${kind}${id === undefined ? "" : ":"}.${field}`;
};
const VOCABULARY_CANONICAL = VOCABULARY.map(canonical);

/** Every `{{...}}` a text names, as canonical names; `unchecked:` wraps a placeholder and is looked through. */
function placeholdersNamed(text: string): string[] {
  return [...text.matchAll(/\{\{([^}]*)\}\}/g)].map(([, inner]) => canonical(inner.replace(/^unchecked:/, "")));
}

/** Placeholders the brief names that the vocabulary does not have, and vocabulary names the brief never names. */
function vocabularyProblems(text: string): string[] {
  const named = new Set(placeholdersNamed(text));
  return [
    ...[...named].filter((name) => !VOCABULARY_CANONICAL.includes(name)).map((name) => `names {{${name}}}, which is not in the vocabulary`),
    ...VOCABULARY_CANONICAL.filter((name) => !named.has(name)).map((name) => `never teaches {{${name}}}`),
  ];
}

/** The sentences that bind the seat, each verbatim. Deleting any one must fail its own obligation and no other. */
const BINDING: Array<[string, string]> = [
  ["says it is the liaison and not the chairman's assistant", "**You are the organisation's liaison, not the chairman's assistant.**"],
  ["decides nothing", "**You decide nothing.**"],
  ["never writes as the chairman", "**You never write as the chairman.**"],
  ["never says the chairman approved without a ledger inbound line", "you never say \"the chairman approved\" about anything unless a ledger\ninbound line shows it"],
  ["takes no credentials, deletions or spending", "**You never take a credential, a deletion or spending.**"],
  ["says it could not check, when a read fails", "**\"I could not check X\"** is sendable and is the right answer."],
  ["asks ceo through prompt:session and names what clears it", "name in the text what clears it"],
];

const missingBinding = (text: string): string[] => BINDING.filter(([, sentence]) => !text.includes(sentence)).map(([name]) => name);

type Roster = { live: Array<{ name: string; persistent?: boolean; brief: string }> };
const liaisonEntry = (roster: Roster) => roster.live.find((entry) => entry.name === "liaison");

test("the brief says in its first paragraph that it is the organisation's liaison", () => {
  const firstParagraph = read(BRIEF).split("\n\n").find((block) => !block.startsWith("#")) ?? "";
  assert.match(firstParagraph, /^\*\*You are the organisation's liaison, not the chairman's assistant\.\*\*/);
});

test("the brief carries every binding sentence", () => {
  assert.deepEqual(missingBinding(read(BRIEF)), []);
});

test("positive control: deleting any one binding sentence from a copy fails that obligation and no other", () => {
  assert.equal(BINDING.length >= 7, true, "the table the controls run over is not empty");
  for (const [name, sentence] of BINDING) {
    const broken = read(BRIEF).replace(sentence, "");
    assert.deepEqual(missingBinding(broken), [name], `deleting "${name}" must fail exactly that obligation`);
  }
});

test("every placeholder the brief names is in the vocabulary, and every name in the vocabulary is taught", () => {
  assert.deepEqual(vocabularyProblems(read(BRIEF)), []);
});

test("positive control: a placeholder outside the vocabulary added to a copy fails, and so does one removed", () => {
  const added = `${read(BRIEF)}\nThe fleet is {{fleet.workers-green}}.\n`;
  assert.deepEqual(vocabularyProblems(added), ["names {{fleet.workers-green}}, which is not in the vocabulary"]);
  const removed = read(BRIEF).replaceAll("{{ready.count}}", "");
  assert.deepEqual(vocabularyProblems(removed), ["never teaches {{ready.count}}"]);
  assert.ok(placeholdersNamed(read(BRIEF)).length >= VOCABULARY.length, "the brief names the placeholders at all (the emptiness's control)");
});

/** What the brief must put in the liaison's hands for `chairman:watch` (a11ign/agent-org `docs/messaging.md`): each of its three verbs, the first spelled with the command. */
const WATCH_TEACHING: Array<[string, string]> = [
  ["add, with a thing and a message", "chairman:watch -- add <row|pr|run|unit> <id>\n   --message=<ref>"],
  ["list", "`list` for what is being watched"],
  ["remove", "`remove <row|pr|run|unit> <id>`"],
];
const missingWatchTeaching = (text: string): string[] => WATCH_TEACHING.filter(([, phrase]) => !text.includes(phrase)).map(([name]) => name);

test("the brief teaches chairman:watch and its three verbs", () => {
  assert.deepEqual(missingWatchTeaching(read(BRIEF)), []);
});

test("positive control: deleting any one part of the chairman:watch teaching from a copy fails that part", () => {
  assert.equal(WATCH_TEACHING.length >= 3, true, "the table the controls run over is not empty");
  for (const [name, phrase] of WATCH_TEACHING) {
    assert.deepEqual(missingWatchTeaching(read(BRIEF).replace(phrase, "")), [name], `deleting "${name}" must fail exactly that part`);
  }
  assert.equal(read(BRIEF).includes("chairman:watch"), true, "the brief names the command at all");
});

/**
 * What the brief must show for a reply about a row (a11ign/a11ign#3565): the whole working command, the `--dry-run` probe of it, and where the refusal's fix is printed.
 * The example's placeholders are held to the vocabulary by the test above, so a renamed placeholder fails there and not silently here.
 */
const ROW_REPLY_TEACHING: Array<[string, string]> = [
  ["the working command, end to end", 'agent-org chairman:reply "That work is {{issue:3542.state}}. Reference: #{{issue:3542.number}}."'],
  ["the --dry-run probe of it", 'agent-org chairman:reply --dry-run "That work is {{issue:3542.state}}. Reference: #{{issue:3542.number}}."'],
  ["the refusal prints the corrected text", "`corrected, send this instead:` line"],
  ["which placeholder carries which value", "`#{{issue:3542.number}}` reads `3542`; `{{issue:3542.state}}` reads `closed`"],
];
const missingRowReplyTeaching = (text: string): string[] => ROW_REPLY_TEACHING.filter(([, phrase]) => !text.includes(phrase)).map(([name]) => name);

test("the brief carries one working example of a reply about a row, its --dry-run probe, and where the refusal prints the fix", () => {
  assert.deepEqual(missingRowReplyTeaching(read(BRIEF)), []);
});

test("positive control: deleting any one part of the row-reply teaching from a copy fails that part", () => {
  assert.equal(ROW_REPLY_TEACHING.length > 0, true, "the table the controls run over is not empty");
  for (const [name, phrase] of ROW_REPLY_TEACHING) {
    // The --dry-run line contains the sending line's text only after its flag, so deleting the sending line alone is the one a naive `includes` could not tell from the probe.
    const broken = read(BRIEF).replace(phrase, "");
    assert.deepEqual(missingRowReplyTeaching(broken), [name], `deleting "${name}" must fail exactly that part`);
  }
});

test("the roster has a persistent liaison whose brief exists", () => {
  const entry = liaisonEntry(JSON.parse(read(SESSIONS)) as Roster);
  assert.ok(entry, "sessions.json has a live entry named liaison");
  assert.equal(entry.persistent, true);
  assert.equal(entry.brief, BRIEF);
  assert.ok(existsSync(resolve(ROOT, entry.brief)), `${entry.brief} exists`);
});

test("positive control: a roster without the entry, or without persistent, is not accepted", () => {
  assert.equal(liaisonEntry({ live: [] }), undefined);
  assert.notEqual(liaisonEntry({ live: [{ name: "liaison", brief: BRIEF }] })?.persistent, true);
});
