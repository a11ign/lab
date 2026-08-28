// @ts-check
/**
 * Emit the two tables of UNCLOSABLE vetoes, so the Python weights-side audit can read a JS declaration.
 *
 *   npm run corpus:unclosable-map
 *
 * ## Why this exists
 *
 * `audit-corpus-starvation.mjs` has carried `IMPOSSIBLE_BY_DEFINITION` for months, with the cost written
 * beside it: *"Reporting those put items on a work list that nobody can complete, and inflated the two
 * features at the top of the ranking."* `audit-scorer-shortcuts.py` never learned it — grep it for
 * `impossible` and there is nothing — so `scorer:shortcuts` reports 57 veto pairs with no way to say which
 * are worth corpus work and which are structurally unclosable.
 *
 * That is a fact learned at one layer and not carried to the next, which is this repo's own recurring
 * shape. The remedy is the one `corpus:grants-map` already uses: neither language can import the other, so
 * the map is EMITTED rather than duplicated by hand, and the Python side refuses without it rather than
 * examining an empty set.
 *
 * Written into `runs/`, which is gitignored, because it is derived. A checked-in copy would be a second
 * source of truth and would drift the first time somebody added an entry.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { IMPOSSIBLE_BY_DEFINITION, UNREACHABLE_WITHOUT_PERTURBING } from "./audit-corpus-starvation.mjs";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * Takes no flags: it emits the JS-side declarations for the Python audit to read.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success — and a veto
 * report that quietly forgave the wrong set would be worse than one that forgave none.
 */
refuseUnknownFlags([], { entry: import.meta.url, command: "npm run corpus:unclosable-map" });

const OUT = resolve(fileURLToPath(new URL("../../../", import.meta.url)), "runs/unclosable-vetoes.json");

/**
 * The two kinds, kept SEPARATE rather than merged into one list of forgiven pairs.
 *
 * They are different facts and a reader acts on them differently. `by-definition` means the subtype IS
 * the absence of that announcement, so no page can carry both — nothing to build, ever.
 * `perturbs-measurement` means the page could carry it and capturing it would destroy the evidence, which
 * is a statement about THIS probe and could change if the probe did. Collapsing them would make the
 * second look permanent.
 */
export function unclosableVetoes() {
  return {
    "by-definition": Object.fromEntries(
      Object.entries(IMPOSSIBLE_BY_DEFINITION).map(([subtype, features]) => [subtype, [...features]])),
    "perturbs-measurement": Object.fromEntries(
      Object.entries(UNREACHABLE_WITHOUT_PERTURBING).map(([subtype, features]) => [subtype, [...features]])),
  };
}

function main() {
  const map = unclosableVetoes();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  const pairs = Object.values(map)
    .flatMap((group) => Object.values(group).flatMap((features) => features)).length;
  process.stdout.write(`  ${pairs} unclosable veto pair(s) across `
    + `${Object.values(map).reduce((n, group) => n + Object.keys(group).length, 0)} subtype(s) -> `
    + `${OUT}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
