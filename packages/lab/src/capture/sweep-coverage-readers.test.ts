/**
 * #951, ONE VERDICT, EVERY READER -- the #887 fixture read through each reader of a sweep's completeness.
 *
 * `sweptElsewhere` (`@a11ign/evidence/verify`) is the one place that decides a sweep found far less than the
 * page's census, whatever held it. Every reader below used to call round 9's trapped capture something else --
 * `capture:explain` "ok links", the ambiguity audit "asked, ran out", the lab's own `sweepCompleteness`
 * "complete" -- which is the repo's most expensive recurring shape: a fix at one call site when the behaviour
 * reaches several. This file is what fails if one of them stops asking the verdict.
 *
 * Deliberately NOT here: `captureIsSelfConsistent`, which decides whether a capture is evidence at all. A sweep
 * confined by the page's own modal is the 2.1.2 finding, so the verdict withholds claims and never discards a
 * capture -- `packages/evidence/src/sweep-coverage.test.ts` pins that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sweepCompleteness as evidenceCompleteness } from "@a11ign/evidence/verify";
import { whatItAsked } from "./what-it-asked.mjs";
import { sweepCompleteness as labCompleteness } from "./sweep-costs.mjs";
import { sweepAgainstCensus } from "./sweep-vs-census.mjs";
import { observationAmbiguity } from "../training/observation-ambiguity.mjs";

type Sweep = Record<string, unknown>;
type Entry = { source: string, census: Record<string, unknown>, sweeps: Sweep[] };
const FIXTURE = JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../../../evidence/src/fixtures-exhausted-887.json"), "utf8")) as { captures: Entry[] };

const FIELD: Record<string, string> = { heading: "headings", landmark: "landmarks", formField: "formFields",
  graphic: "graphics", link: "links", list: "lists", frame: "frames" };

/** A capture as the readers receive it, with the `observed` record a protocol-9 capture writes for each sweep. */
function captureOf({ census, sweeps }: Pick<Entry, "census" | "sweeps">) {
  const structure: Record<string, string[]> = Object.fromEntries(Object.values(FIELD).map((f) => [f, []]));
  const observed: Record<string, unknown> = {};
  for (const s of sweeps) {
    const field = FIELD[String(s.type)] ?? String(s.type);
    structure[field] = (s.phrases as string[] | undefined) ?? [];
    const complete = s.prevStop === "exhausted" && s.nextStop === "exhausted";
    observed[field] = { asked: true, complete, stop: { prev: s.prevStop, next: s.nextStop } };
  }
  return { transcript: [], structure, observed,
    diagnostics: [{ event: "structureCensus", ...census }, ...sweeps.map((s) => ({ event: "sweep", ...s }))] };
}

const source = "runs/887-r9A-hubspot-w7.json/capture-1.json";
const entry = FIXTURE.captures.find((c) => c.source === source);
assert.ok(entry, `${source} is not in the fixture`);
const TRAPPED = captureOf(entry);
/** theregister's shape: 0 links against a census of 618, both directions exhausted -- an EMPTY trapped sweep. */
const EMPTY_TRAP = captureOf({ census: { distinct: { link: 618 } },
  sweeps: [{ type: "link", found: 0, prevStop: "exhausted", nextStop: "exhausted", phrases: [] }] });

test("#951 READER @a11ign/evidence sweepCompleteness: the trapped link and graphic sweeps are `elsewhere`", () => {
  const verdicts = evidenceCompleteness(TRAPPED as never);
  assert.equal(verdicts.link, "elsewhere");
  assert.equal(verdicts.graphic, "elsewhere");
});

test("#951 READER capture:explain: never \"ok links\" over a sweep of a chat widget", () => {
  const rows = whatItAsked(TRAPPED);
  const links = rows.find((r) => /\blinks\b/.test(r)) ?? "";
  assert.doesNotMatch(links, /\bok links\b/, `the trapped link sweep printed as ok: ${links}`);
  assert.match(links, /found far less than the page's census, so something held it \(it named no container\) \(#951\)/);
  const graphics = rows.find((r) => /\bgraphics\b/.test(r)) ?? "";
  assert.match(graphics, /something held it \(it named "Message History, region" first\) \(#951\)/);
});

test("#951 READER the lab's sweepCompleteness and sweep-vs-census: `elsewhere`, never `complete`, and no ratio", () => {
  const mark = TRAPPED.diagnostics.find((m) => (m as Sweep).event === "sweep" && (m as Sweep).type === "link");
  assert.equal(labCompleteness(mark, TRAPPED.diagnostics), "elsewhere");
  const link = sweepAgainstCensus(TRAPPED).find((row) => row.type === "link");
  assert.equal(link?.completeness, "elsewhere");
  assert.equal(link?.ratio, null, "a sweep something held is not a coverage figure for the page");
});

test("#951 READER the ambiguity audit: an EMPTY trapped sweep is \"asked, short\" and a capture defect -- never \"asked, ran out\"", () => {
  const { channels } = observationAmbiguity([EMPTY_TRAP]);
  assert.equal(channels.link.emptyAskedComplete, 0, "its own complete:true is true about whatever held it");
  assert.equal(channels.link.emptyAskedShort, 1);
  assert.equal(channels.link.sweepMissed, 1, "a sweep that never examined the page is the capture's defect");
});
