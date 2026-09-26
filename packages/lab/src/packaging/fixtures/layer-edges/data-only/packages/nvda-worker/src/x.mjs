const REGION_BODY = "packages/other/src/x.mjs\npackages/nvda-worker/src/own.mjs\n";
const FIXTURE_PATHS = ["packages/other/src/x.mjs", "../../other/src/x.mjs"];

/** Splits a Region body into paths. It names them and never opens one. */
function parseRegion(body) {
  return body.split("\n").filter(Boolean);
}

export const parsed = parseRegion(REGION_BODY);
export const inline = parseRegion("packages/other/src/x.mjs");
export const claimed = FIXTURE_PATHS.map((path) => path.toUpperCase());
