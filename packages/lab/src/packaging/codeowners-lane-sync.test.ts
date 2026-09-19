/**
 * #916: root `CODEOWNERS` is a SECOND SPELLING of docs/lane-ownership.json's `paths` and `except` --
 * GitHub parses CODEOWNERS natively and cannot read JSON, so there is no way to make CODEOWNERS import
 * the fact list the way owned-path-signoff.mjs imports docs/owned-path-facts.json. This is the guard
 * against exactly the drift #939 found in nine independent spellings of "what changed": if a lane's paths
 * move in the JSON and nobody edits CODEOWNERS to match, this fails in both directions -- a path the JSON
 * protects but CODEOWNERS does not, and a CODEOWNERS line the JSON no longer names.
 *
 * `ROLE_LOGIN` is the one place a lane's role-name owner (`"ceo"`) becomes a GitHub login (`@DanBeckDev`)
 * -- there is no other mapping of the two in this repo (`workers-github-account.md`'s account split is
 * operational memory, not code), so it is written out and small on purpose rather than imported from
 * somewhere that would make it look derived when it is actually just asserted here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const REPO_ROOT = new URL("../../../../", import.meta.url);
const CODEOWNERS = readFileSync(new URL("CODEOWNERS", REPO_ROOT), "utf8");
const LANES = JSON.parse(readFileSync(new URL("docs/lane-ownership.json", REPO_ROOT), "utf8"));

/** ceo's own ruling on 2026-09-07 refuses this same treatment for owned-path-facts.json's role, so this
 * mapping is deliberately scoped to lane-ownership.json's lanes and nothing wider. */
const ROLE_LOGIN: Record<string, string> = { ceo: "DanBeckDev" };

/** @returns {{pattern: string, owners: string[]}[]} non-comment, non-blank CODEOWNERS lines, parsed. */
function parseCodeowners(text: string): { pattern: string; owners: string[] }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners };
    });
}

/** CODEOWNERS anchors a leading-slash path at the repo root; lane-ownership.json's paths do not carry one. */
function anchored(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

test("#916: every lane path in docs/lane-ownership.json has a matching CODEOWNERS entry naming its owner", () => {
  const entries = parseCodeowners(CODEOWNERS);
  for (const lane of LANES.lanes) {
    const login = ROLE_LOGIN[lane.owner];
    assert.ok(login, `lane "${lane.lane}" is owned by "${lane.owner}", which ROLE_LOGIN does not map -- `
      + "add it here rather than leaving CODEOWNERS unable to name an owner for a real lane");
    for (const path of lane.paths) {
      const entry = entries.find((e) => e.pattern === anchored(path));
      assert.ok(entry, `docs/lane-ownership.json protects "${path}" under lane "${lane.lane}", but `
        + `CODEOWNERS has no "${anchored(path)}" line -- add one naming @${login}`);
      assert.deepEqual(entry!.owners, [`@${login}`],
        `CODEOWNERS's owner(s) for "${entry!.pattern}" must be exactly the lane's owner, @${login}`);
    }
  }
});

test("#916: every lane's `except` path has a later, ownerless CODEOWNERS line overriding the directory owner", () => {
  const entries = parseCodeowners(CODEOWNERS);
  for (const lane of LANES.lanes) {
    for (const exceptPath of lane.except ?? []) {
      const exceptIndex = entries.findIndex((e) => e.pattern === anchored(exceptPath));
      assert.ok(exceptIndex !== -1, `docs/lane-ownership.json carves "${exceptPath}" out of lane `
        + `"${lane.lane}", but CODEOWNERS has no matching line to un-own it`);
      assert.deepEqual(entries[exceptIndex].owners, [],
        `"${anchored(exceptPath)}" must have NO owners in CODEOWNERS -- an owner here would put it back `
        + "under the lane it was carved out of");
      for (const path of lane.paths) {
        const dirIndex = entries.findIndex((e) => e.pattern === anchored(path));
        assert.ok(dirIndex < exceptIndex,
          "CODEOWNERS applies the LAST matching pattern -- the except line must come AFTER the "
          + `directory line ("${anchored(path)}") it overrides, or the carve-out does nothing`);
      }
    }
  }
});

test("#916: CODEOWNERS names no path that docs/lane-ownership.json does not itself protect or except", () => {
  // The converse of the two tests above: an orphan CODEOWNERS line looks like protection that isn't
  // backed by any recorded lane, which is the same silent-drift shape as a lane with no CODEOWNERS line.
  const known = new Set<string>();
  for (const lane of LANES.lanes) {
    for (const path of lane.paths) known.add(anchored(path));
    for (const exceptPath of lane.except ?? []) known.add(anchored(exceptPath));
  }
  const orphans = parseCodeowners(CODEOWNERS)
    .map((e) => e.pattern)
    .filter((pattern) => !known.has(pattern));
  assert.deepEqual(orphans, [], "CODEOWNERS has entries with no matching lane path or except in "
    + "docs/lane-ownership.json -- either the JSON is missing the lane or this line does not belong");
});
