// @ts-check
/**
 * #781: HOW MUCH DOES A REAL PAGE'S SHAPE DRIFT, AND OVER WHAT INTERVAL? A PAIR CANNOT ANSWER IT.
 *
 * #688 asked whether a page serves a DIFFERENT DOCUMENT (0 of 19, a rule-of-three bound) and #780 made
 * that measurement durable. This is the other half: given the SAME document, how much does its content
 * move? On 2026-09-09 one pair of hubspot captures seven hours apart read "perfectly stable" and one pair
 * six minutes apart read "varies" -- from the SAME five captures, because hubspot alternates between two
 * readings and a pair can only ever land on one comparison of the coin. So this reports a DISTRIBUTION
 * (n, the number of distinct shapes observed, and the spread) rather than the worst-field deviation of a
 * single pair -- see the row for hubspot/calendly/ikea's three worked shapes (bimodal, stable, stepped).
 *
 * A "shape" is a capture's STRUCTURE-CENSUS COUNT VECTOR (headings, landmarks, formFields, tableCells,
 * links, lists, graphics, frames -- `EVIDENCE_FIELDS`' own `structure` group, never re-derived here), not
 * its full content. Structure counts are what the row's own worked table used, and they hold still when
 * nothing about the page's DOM changed: a completed sweep counts every element of a type it walked,
 * independently of which probe ran or how NVDA phrased an announcement. The `interaction` fields vary
 * with probe budgets and activation order (`evidence-diff.mjs`'s own `NOT_COMPARED`/`observed` notes) and
 * would read every capture as a new "shape" for reasons that have nothing to do with the page moving.
 *
 * TWO GUARDS, BOTH FROM INCIDENTS THIS ROW NAMES, apply BEFORE any shape is compared:
 *
 *   - `documentIdentity(capture).targetMatch !== "matched"` captures are EXCLUDED (named, never silently
 *     dropped -- #780's own rule) because a fallback capture's content is a sign-in wall's shape, not the
 *     page's; blurring "the same served document" into "unchanged content" is #688's original defect
 *     (this row's acceptance 3).
 *   - a URL whose matched captures span more than one `environment.workerCode` REFUSES the whole group
 *     rather than reporting -- `capture-integrity-plan.md` C8's own "done when": on 2026-09-09 five IKEA
 *     captures spanning four worker builds produced a ratio that changed SIGN, read as a finding about
 *     the page twice, before anyone checked the builds. A comparison across a code change measures the
 *     worker, not the drift.
 */
import { EVIDENCE_FIELDS, fieldKey, fieldValues } from "../capture/evidence-diff.mjs";
import { captureIn } from "../capture/sweep-costs.mjs";
import { documentIdentity } from "@a11ign/evidence/document-identity";

/**
 * The structure-census fields alone -- `EVIDENCE_FIELDS` also carries `interaction` fields and the
 * `observed.<channel>.asked` marks (`[group, name]` vs `[group, name, "asked"]` tells them apart), and
 * both are excluded here for the reason this file's own header gives. Derived from the shared table
 * rather than a second hand-typed list, so a structure field added there (as `frames` was, 2026-09-01)
 * reaches this vector without a second edit.
 * @type {string[][]}
 */
const STRUCTURE_FIELDS = EVIDENCE_FIELDS.filter((field) => field.length === 2 && field[0] === "structure");

/**
 * @typedef {{ url: string, capturedAt: string | null, workerCode: string | null, targetMatch: string | null, vector: Record<string, number> }} ShapeReading
 */

/**
 * One capture, reduced to its structure-count vector -- pure, and the only place `EVIDENCE_FIELDS` is
 * walked for this row. `captureIn` accepts either a raw capture or a `runs/witness/` `{capturedAt, task,
 * capture}` record (`sweep-costs.mjs`'s own two-shapes rule), so a reader never needs to know which one
 * is on disk.
 *
 * @param {any} record @returns {ShapeReading | null} null when the record carries no capture at all
 */
export function shapeReadingFor(record) {
  const capture = captureIn(record);
  if (!capture) return null;
  /** @type {Record<string, number>} */
  const vector = {};
  for (const field of STRUCTURE_FIELDS) vector[fieldKey(field)] = fieldValues(capture, field).length;
  return {
    url: capture.url ?? null,
    capturedAt: capture.capturedAt ?? null,
    workerCode: capture.environment?.workerCode ?? null,
    targetMatch: documentIdentity(capture).targetMatch,
    vector,
  };
}

/** Stable key for exact vector equality -- object key order is fixed by `STRUCTURE_FIELDS` above. */
const vectorKey = (/** @type {Record<string, number>} */ vector) => JSON.stringify(vector);

/**
 * "The number of distinct shapes observed" -- #781's acceptance 1. Groups by EXACT vector equality, never
 * a chosen tolerance (the row's own "what this must not become": no threshold over "worst field").
 * hubspot's worked case is two vectors, each read at more than one capture time -- never one vector with
 * noise scattered around it, which is what a per-field tolerance would produce instead.
 *
 * @param {ShapeReading[]} readings @returns {{ vector: Record<string, number>, count: number, capturedAt: (string | null)[] }[]}
 */
export function distinctShapes(readings) {
  /** @type {Map<string, { vector: Record<string, number>, count: number, capturedAt: (string | null)[] }>} */
  const byKey = new Map();
  for (const reading of readings) {
    const key = vectorKey(reading.vector);
    const existing = byKey.get(key);
    if (existing) { existing.count += 1; existing.capturedAt.push(reading.capturedAt); }
    else byKey.set(key, { vector: reading.vector, count: 1, capturedAt: [reading.capturedAt] });
  }
  return [...byKey.values()];
}

/**
 * "The spread" -- #781's acceptance 1, generalised from #688's own single-pair "worst field deviation" to
 * a whole distribution: for each field, `(max - min) / max` over every reading's count, as a percentage;
 * the worst field across the set is the number reported. Never used to choose a tolerance or a verdict --
 * only printed, per the row's "not a stability gate" rule.
 *
 * @param {ShapeReading[]} readings @returns {number} 0 when fewer than two readings (nothing to spread)
 */
export function worstFieldSpreadPercent(readings) {
  if (readings.length < 2) return 0;
  let worst = 0;
  for (const field of Object.keys(readings[0].vector)) {
    const counts = readings.map((reading) => reading.vector[field] ?? 0);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max === 0) continue; // every reading agrees on zero; nothing to spread
    worst = Math.max(worst, ((max - min) / max) * 100);
  }
  return worst;
}

/**
 * @typedef {{ url: string, n: number, excludedCount: number, refused: string | null, build?: string | null,
 *   shapes?: ReturnType<typeof distinctShapes>, spreadPercent?: number }} PageDrift
 */

/**
 * The per-page drift distribution -- #781's whole deliverable. One entry per URL seen, always, so a page
 * with nothing usable is NAMED rather than silently absent from the report (this repo's own rule for an
 * empty population: an empty answer must not read as "nobody looked").
 *
 * @param {any[]} records raw captures or `runs/witness/` records, any mix of pages and rounds
 * @returns {PageDrift[]}
 */
export function driftDistributionsByUrl(records) {
  const readings = records.map(shapeReadingFor).filter(/** @returns {r is ShapeReading} */ (r) => r !== null);
  /** @type {Map<string, ShapeReading[]>} */
  const byUrl = new Map();
  for (const reading of readings) {
    const list = byUrl.get(reading.url) ?? [];
    list.push(reading);
    byUrl.set(reading.url, list);
  }
  /** @type {PageDrift[]} */
  const out = [];
  for (const [url, group] of byUrl) {
    const matched = group.filter((reading) => reading.targetMatch === "matched");
    const excludedCount = group.length - matched.length;
    const builds = [...new Set(matched.map((reading) => reading.workerCode).filter((b) => b !== null))];
    if (builds.length > 1) {
      out.push({
        url, n: matched.length, excludedCount,
        refused: `${matched.length} matched captures span ${builds.length} worker builds `
          + `(${builds.join(", ")}) -- a drift measurement whose rounds straddle a worker-code change `
          + "measures the worker, not the drift (capture-integrity-plan.md C8)",
      });
      continue;
    }
    out.push({
      url, n: matched.length, excludedCount, refused: null, build: builds[0] ?? null,
      shapes: distinctShapes(matched), spreadPercent: worstFieldSpreadPercent(matched),
    });
  }
  return out;
}

/**
 * One printable line per page, ALWAYS -- including a page with under two usable captures, so "nothing to
 * compare yet" is a stated fact rather than a blank the reader has to notice on their own.
 *
 * @param {PageDrift} entry @returns {string}
 */
export function driftSummaryLine(entry) {
  const excludedNote = entry.excludedCount
    ? ` (${entry.excludedCount} more excluded: not a matched document identity)` : "";
  if (entry.refused) return `${entry.url}: REFUSED -- ${entry.refused}.${excludedNote}\n`;
  if (entry.n < 2) {
    return `${entry.url}: only ${entry.n} usable capture(s) -- a pair cannot measure a distribution.`
      + `${excludedNote}\n`;
  }
  const shapes = /** @type {NonNullable<PageDrift["shapes"]>} */ (entry.shapes);
  const spreadPercent = /** @type {number} */ (entry.spreadPercent);
  const at = shapes.map((shape) => `${shape.count}x at ${shape.capturedAt.join(", ")}`).join("; ");
  return `${entry.url}: n=${entry.n} on build ${entry.build}, ${shapes.length} distinct shape(s) `
    + `(${at}), worst-field spread ${spreadPercent.toFixed(1)}%.${excludedNote}\n`;
}
