/**
 * Emit the accompanying-defect `grants` map, so the Python audit can read a JavaScript declaration.
 *
 *   npm run corpus:grants-map
 *
 * `ACCOMPANYING_DEFECTS` lives in `case-matrix.mjs` and the features it names are computed in Python.
 * Neither language can import the other, so the map is emitted rather than duplicated by hand, and
 * `audit_grants.py` REFUSES to run without it rather than examining an empty set.
 *
 * Written into `runs/`, which is gitignored, because it is derived: a checked-in copy would be a second
 * source of truth and would drift the first time somebody added a defect.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ACCOMPANYING_DEFECTS } from "../src/training/case-matrix.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * takes no flags: it emits the JS-side declarations for the Python audit to read.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags([], { command: "npm run corpus:grants-map" });

const OUT = resolve(fileURLToPath(new URL("../../../", import.meta.url)), "runs/accompanying-grants.json");

/** `grants` is a string on most defects and an array on three; the audit wants one feature per defect. */
export function grantsMap(defects) {
  const map = {};
  for (const [name, defect] of Object.entries(defects ?? {})) {
    const grants = defect?.grants;
    if (typeof grants === "string") map[name] = grants;
    // An array means the markup grants several features. Only the FIRST is taken, and deliberately: the
    // audit asks "did this defect's evidence arrive at all", and one feature answers that. Requiring all
    // of them would fail on a defect whose secondary feature is legitimately absent on some pages.
    else if (Array.isArray(grants) && grants.length) map[name] = grants[0];
  }
  return map;
}

function main() {
  const map = grantsMap(ACCOMPANYING_DEFECTS);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(map, null, 2)}\n`);
  process.stdout.write(`wrote ${Object.keys(map).length} grant(s) to ${OUT}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
