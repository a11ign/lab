/**
 * #2557: A RECORD OF AN OUTSIDER'S RUN HAS FIXED FIELDS, AND A FIELD WITH NOTHING IN IT SAYS `NOT STATED`.
 *
 * The first outsider's reaction reached us relayed, in three shapes, and two things B1 asked for were not
 * stated by them: whether the output was worth their time, and whether the app was theirs. The failure this
 * file prevents is a SECOND record that fills those two fields with a reading of what the person probably
 * meant. So `Worth your time` is either `NOT STATED` or a blockquote of their own words, and an unquoted
 * sentence is refused because an unquoted sentence is a paraphrase.
 *
 * The check goes through `parseRecords` + `refusalsOf`, which are driven with real shapes below, rather
 * than through grep on the prose. **The real file is read through the same two functions the fixtures use**,
 * so a fixture that is refused and a file that is accepted were judged by one rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const NOT_STATED = "NOT STATED";

/** In the order the doc defines them. `Run` and `Date` are the two values of field 1. */
const FIELDS = [
  "Run",
  "Date",
  "Who",
  "Was the app theirs",
  "Was it behind a login",
  "Worth your time",
  "What they did about a finding",
  "Where they got stuck",
  "Source",
] as const;

const RECORD_HEADING = /^## Run (\d+)\s*$/;
const FIELD_LINE = /^- \*\*(.+?):\*\*[ \t]*(.*)$/;
const CONTINUATION = /^ {2,}\S/;
const EMAIL_SHAPED = /\S+@\S+/;
const YES_NO = new Set(["yes", "no", NOT_STATED]);

interface ParsedField {
  name: string;
  lines: string[];
}
interface ParsedRecord {
  heading: string;
  fields: ParsedField[];
}

/** A record is a `## Run N` section; a field is `- **Name:** value` plus its two-space-indented continuation. */
function parseRecords(markdown: string): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  let current: ParsedRecord | undefined;
  let field: ParsedField | undefined;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      current = RECORD_HEADING.test(line) ? { heading: line, fields: [] } : undefined;
      field = undefined;
      if (current) records.push(current);
      continue;
    }
    const opens = current ? FIELD_LINE.exec(line) : null;
    if (current && opens) {
      field = { name: opens[1], lines: [opens[2].trim()] };
      current.fields.push(field);
    } else if (field && CONTINUATION.test(line)) {
      field.lines.push(line.trim());
    } else {
      field = undefined;
    }
  }
  return records;
}

function valueOf(record: ParsedRecord, name: string): string[] {
  return (record.fields.find((f) => f.name === name)?.lines ?? []).filter((l) => l !== "");
}

function fieldOrderRefusals(record: ParsedRecord): string[] {
  const names = record.fields.map((f) => f.name);
  const missing = FIELDS.filter((f) => !names.includes(f)).map((f) => `missing field \`${f}\``);
  if (missing.length > 0) return missing;
  return names.join("|") === FIELDS.join("|") ? [] : [`fields out of order or repeated: ${names.join(", ")}`];
}

function valueRefusals(record: ParsedRecord): string[] {
  const refusals: string[] = [];
  for (const name of FIELDS) {
    if (record.fields.some((f) => f.name === name) && valueOf(record, name).length === 0) {
      refusals.push(`\`${name}\` is empty: say ${NOT_STATED}`);
    }
  }
  return refusals;
}

/** Whether `Worth your time` is `NOT STATED` or nothing but blockquote lines with words in them. */
function worthIsQuotedOrNotStated(lines: string[]): boolean {
  if (lines.length === 1 && lines[0] === NOT_STATED) return true;
  return lines.every((l) => l.startsWith(">") && l.slice(1).trim() !== "");
}

function shapeRefusals(record: ParsedRecord): string[] {
  const refusals: string[] = [];
  const one = (name: string) => valueOf(record, name).join(" ");
  if (!/^[1-9]\d*$/.test(one("Run"))) refusals.push("`Run` is not a positive integer");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(one("Date")) && one("Date") !== NOT_STATED && valueOf(record, "Date").length > 0) {
    refusals.push("`Date` is neither YYYY-MM-DD nor NOT STATED");
  }
  if (EMAIL_SHAPED.test(one("Who")) || /https?:\/\//.test(one("Who"))) {
    refusals.push("`Who` holds an email address or URL: name the person by role only");
  }
  for (const name of ["Was the app theirs", "Was it behind a login"]) {
    if (valueOf(record, name).length > 0 && !YES_NO.has(one(name))) refusals.push(`\`${name}\` is not yes, no or NOT STATED`);
  }
  const worth = valueOf(record, "Worth your time");
  if (worth.length > 0 && !worthIsQuotedOrNotStated(worth)) {
    refusals.push("`Worth your time` is neither NOT STATED nor a blockquote of their own words");
  }
  return refusals;
}

function refusalsOf(record: ParsedRecord): string[] {
  const order = fieldOrderRefusals(record);
  return order.length > 0 ? order : [...valueRefusals(record), ...shapeRefusals(record)];
}

/** A record that passes, built as text so each control below breaks exactly one thing in it. */
function recordText(overrides: Partial<Record<(typeof FIELDS)[number], string | null>> = {}): string {
  const base: Record<(typeof FIELDS)[number], string> = {
    Run: "2",
    Date: "2026-10-01",
    Who: "second outsider",
    "Was the app theirs": "yes",
    "Was it behind a login": "no",
    "Worth your time": "\n  > It found two things my scanner had not.",
    "What they did about a finding": "filed one issue",
    "Where they got stuck": NOT_STATED,
    Source: "First-hand, on row #9999",
  };
  const lines = FIELDS.flatMap((name) => {
    const value = name in overrides ? overrides[name] : base[name];
    return value === null || value === undefined ? [] : [`- **${name}:** ${value}`];
  });
  return `## Run 2\n\n${lines.join("\n")}\n`;
}

function refusalsOfText(text: string): string[] {
  const records = parseRecords(text);
  assert.equal(records.length, 1, "the fixture must parse as exactly one record");
  return refusalsOf(records[0]);
}

const DOC = readFileSync(`${REPO}docs/outsider-runs.md`, "utf8");

test("the real file yields at least one record, so an emptiness assertion cannot pass on a parser that reads nothing", () => {
  assert.ok(parseRecords(DOC).length >= 1);
  assert.deepEqual(parseRecords(recordText()).map((r) => r.fields.length), [FIELDS.length]);
});

test("every record in docs/outsider-runs.md keeps the format", () => {
  for (const record of parseRecords(DOC)) assert.deepEqual(refusalsOf(record), [], record.heading);
});

test("run numbers are not reused", () => {
  const numbers = parseRecords(DOC).map((r) => valueOf(r, "Run").join(" "));
  assert.equal(new Set(numbers).size, numbers.length, numbers.join(","));
});

test("Run 1 states nothing the source does not state", () => {
  const run1 = parseRecords(DOC).find((r) => valueOf(r, "Run").join("") === "1");
  assert.ok(run1, "Run 1 must exist");
  assert.equal(valueOf(run1, "Who").join(" "), "first outsider");
  for (const name of ["Worth your time", "Was the app theirs"]) {
    assert.deepEqual(valueOf(run1, name), [NOT_STATED], name);
  }
});

test("positive control: a well-formed fixture is accepted, so the refusals below are not refusals of everything", () => {
  assert.deepEqual(refusalsOfText(recordText()), []);
  assert.deepEqual(refusalsOfText(recordText({ "Worth your time": NOT_STATED })), []);
});

test("a record with `Worth your time` empty is refused", () => {
  const refusals = refusalsOfText(recordText({ "Worth your time": "" }));
  assert.ok(refusals.some((r) => r.includes("`Worth your time` is empty")), refusals.join("; "));
});

test("a record with `Worth your time` as an unquoted sentence is refused", () => {
  const refusals = refusalsOfText(recordText({ "Worth your time": "They thought it was worth the time." }));
  assert.ok(refusals.some((r) => r.includes("blockquote")), refusals.join("; "));
  const half = refusalsOfText(recordText({ "Worth your time": "\n  > Their words.\n  and then our summary" }));
  assert.ok(half.some((r) => r.includes("blockquote")), "a quote followed by a paraphrase line is refused too");
});

test("a record with a field missing is refused", () => {
  for (const name of FIELDS) {
    const refusals = refusalsOfText(recordText({ [name]: null }));
    assert.ok(refusals.some((r) => r.includes(`missing field \`${name}\``)), `${name}: ${refusals.join("; ")}`);
  }
});

test("a record with its fields out of order is refused", () => {
  const swapped = recordText().replace(/(- \*\*Who:\*\*[^\n]*\n)(- \*\*Was the app theirs:\*\*[^\n]*\n)/, "$2$1");
  assert.ok(refusalsOfText(swapped).some((r) => r.includes("out of order")));
});

test("a record with `Who` holding an email-address-shaped string is refused", () => {
  const refusals = refusalsOfText(recordText({ Who: "someone@example.com" }));
  assert.ok(refusals.some((r) => r.includes("`Who`")), refusals.join("; "));
});

test("an unrecognised answer to a yes/no/NOT STATED field is refused", () => {
  const refusals = refusalsOfText(recordText({ "Was the app theirs": "probably" }));
  assert.ok(refusals.some((r) => r.includes("`Was the app theirs`")), refusals.join("; "));
});

test("the doc is indexed in docs/README.md, and try-it.md's 'What we would like back' links to it", () => {
  const readme = readFileSync(`${REPO}docs/README.md`, "utf8");
  assert.ok(readme.includes("outsider-runs.md"));
  const tryIt = readFileSync(`${REPO}docs/try-it.md`, "utf8");
  const section = tryIt.slice(tryIt.indexOf("## What we would like back"));
  const end = section.indexOf("\n## ", 1);
  assert.ok((end === -1 ? section : section.slice(0, end)).includes("outsider-runs.md"));
});
