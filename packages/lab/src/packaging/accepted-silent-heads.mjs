// @ts-check
/**
 * The heads `ceo` has ruled MAY SHIP silent, read from `packages/lab/src/training/accepted-silent-heads.json`.
 *
 * `releasability()` is pure and takes this list as an input, so a caller that forgets to load it gets the
 * strict behaviour (every silent head blocks) rather than a silent excuse. The loader is LOUD on anything
 * malformed: an empty list read from a broken file would re-block a ruled head and look like a candidate
 * fault, and a list quietly widened would ship a head nobody ruled on.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ACCEPTED_SILENT_HEADS_FILE = fileURLToPath(
  new URL("../training/accepted-silent-heads.json", import.meta.url));

/** The only head ruled on so far (#2536). Another one is a new reading and comes back to `ceo`. */
const RULED_HEAD_IDS = new Set(["4.1.3:status-waiting"]);
const FILE_KEYS = ["heads", "ruling"];
const ENTRY_KEYS = ["id", "measured", "row", "ruled"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {object} AcceptedSilentHead
 * @property {string} id           `criterion:subtype`, matched exactly
 * @property {{truePositive: number, positive: number, atThreshold?: number}} measured  provenance only
 * @property {string} ruled        ISO date of the ruling
 * @property {string} row          the row the ruling was made on
 */

/** @param {string} path @param {Record<string, any>} entry */
function assertEntry(path, entry) {
  const keys = Object.keys(entry).sort();
  if (JSON.stringify(keys) !== JSON.stringify(ENTRY_KEYS)) {
    throw new Error(`${path} entry ${JSON.stringify(entry)} must carry exactly ${ENTRY_KEYS.join(", ")}`);
  }
  if (!RULED_HEAD_IDS.has(entry.id)) {
    throw new Error(`${path} entry ${JSON.stringify(entry.id)} is not a head \`ceo\` ruled on (${[...RULED_HEAD_IDS].join(", ")}). `
      + "Widening the list is a new `ceo` ruling and a new known-gaps section, not an edit to this file.");
  }
  if (!ISO_DATE.test(entry.ruled) || !/^#\d+$/.test(entry.row)) {
    throw new Error(`${path} entry ${entry.id} needs an ISO \`ruled\` date and a \`row\` like #2536`);
  }
}

/**
 * @param {string} [path]
 * @returns {AcceptedSilentHead[]}
 */
export function readAcceptedSilentHeads(path = ACCEPTED_SILENT_HEADS_FILE) {
  const document = JSON.parse(readFileSync(path, "utf8"));
  if (JSON.stringify(Object.keys(document).sort()) !== JSON.stringify(FILE_KEYS)) {
    throw new Error(`${path} keys are ${Object.keys(document).sort().join(", ")}, expected ${FILE_KEYS.join(", ")}`);
  }
  for (const entry of document.heads) assertEntry(path, entry);
  const ids = document.heads.map((/** @type {{id: string}} */ entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${path} lists a head twice`);
  return document.heads;
}
