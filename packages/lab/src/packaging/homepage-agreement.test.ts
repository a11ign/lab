/**
 * #1078: `homepage` is stated in SIX places and nothing compares them.
 *
 * `a11ign.com` does not resolve, and it is the `homepage` of every published package and the first link in
 * the README. **This guard does not endorse that value.** Whichever way #919's decision lands — the domain
 * resolving, the post-transfer repository URL, or publishing with it dead and recording that — the six must
 * still agree afterwards, and pinning them equal now makes the decision **one line in one place** rather
 * than six hand edits in publish week. A published package's metadata is fixed at publish time; correcting
 * a `homepage` means republishing.
 *
 * THREE THINGS IT DELIBERATELY DOES NOT DO, each of which would make it stop working at the moment it is
 * needed:
 *
 *   - **It compares the six to EACH OTHER, never to a literal.** A literal would be a seventh copy, and the
 *     first edit would be to it.
 *   - **The population is DERIVED** from the workspaces glob minus `private`, not a hand-typed list. #919
 *     and #1078 both say FIVE packages; the derivation finds **six** — `worker-fleet` is published and
 *     carries the homepage too. A hand-typed list would have shipped the row's own miscount.
 *   - **The README's occurrence is found by ROLE** — the project link in the preamble — never by matching
 *     the current string. A guard keyed on `a11ign.com` stops working the moment the value changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Every package this repository PUBLISHES, derived: the workspaces glob, minus anything `private`.
 *
 * npm's own rule is the derivation — `private: true` is what stops a package being published — so this
 * cannot disagree with what actually ships the way a list of names can.
 */
function publishedPackages(): { file: string; homepage: string | null }[] {
  const globs = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { workspaces?: string[] })
    .workspaces ?? [];
  const roots = globs.flatMap((glob) => {
    const base = glob.replace(/\/\*$/, "");
    return glob.endsWith("/*")
      ? readdirSync(join(REPO, base), { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => `${base}/${e.name}`)
      : [glob];
  });
  return roots
    .map((root) => ({ root, file: `${root}/package.json` }))
    .filter(({ file }) => existsSync(join(REPO, file)))
    .map(({ file }) => ({ file, json: JSON.parse(readFileSync(join(REPO, file), "utf8")) as
      { private?: boolean; homepage?: string } }))
    .filter(({ json }) => json.private !== true)
    // A published package with NO homepage is a DISAGREEMENT, not an exclusion: dropping it here would let
    // one go silently unstated, which is the six-copies defect with one copy deleted instead of changed.
    .map(({ file, json }) => ({ file, homepage: json.homepage ?? null }));
}

/**
 * The README's project link, by ROLE: the first markdown link in the preamble, before the first `##`.
 *
 * That is where a reader's first click goes, which is what makes it the project link — and it is a
 * position rather than a value, so it survives the value changing.
 */
function readmeProjectLink(): { file: string; homepage: string | null } {
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  const preamble = readme.split(/^## /m)[0];
  const link = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/.exec(preamble);
  return { file: "README.md", homepage: link ? link[1] : null };
}

test("#1078: every published package and the README state the SAME homepage", () => {
  const stated = [...publishedPackages(), readmeProjectLink()];
  const distinct = [...new Set(stated.map((s) => s.homepage))];
  assert.equal(distinct.length, 1,
    `these disagree about the project homepage:\n  ${stated
      .map((s) => `${s.file}: ${s.homepage ?? "(none stated)"}`).join("\n  ")}\n`
    + "They are compared to each other and not to a literal, so any one of them may be the one to change -- "
    + "but a published package's metadata is fixed at publish time, so they must agree BEFORE the publish.");
});

test("#1078: the population is DERIVED, and it is six rather than the five both rows say", () => {
  // The row, and #919 before it, name FIVE packages. The derivation finds SIX -- `worker-fleet` is
  // published and carries the homepage too. **A hand-typed list would have shipped the row's own
  // miscount**, which is the argument for deriving rather than a preference about style.
  const published = publishedPackages().map((p) => p.file.split("/")[1]).sort();
  assert.ok(published.includes("worker-fleet"),
    `the derived set is ${published.join(", ")} -- worker-fleet is published and was missing from both rows`);
  for (const named of ["cli", "evidence", "judge", "nvda-worker", "scorer"]) {
    assert.ok(published.includes(named), `${named} is published and must be in the compared set`);
  }
  assert.ok(!published.includes("lab") && !published.includes("control"),
    "and a PRIVATE package is not published, so its absence is correct rather than a gap");
});

test("#1078: a package with NO homepage disagrees rather than being skipped", () => {
  // The silent-drop hole: filtering out a package that states nothing would let one copy vanish instead of
  // change, and the remaining five would agree. `null` is a distinct value in the comparison above, so it
  // fails -- and the message says "(none stated)" rather than leaving a reader to spot an absence.
  const stated = [{ file: "packages/x/package.json", homepage: "https://example.invalid" },
    { file: "packages/y/package.json", homepage: null }];
  assert.equal([...new Set(stated.map((s) => s.homepage))].length, 2,
    "a missing homepage must read as a different value from a stated one");
});

test("#1078: the README link is found by POSITION, so it survives the value changing", () => {
  // Keyed on the current string, the guard stops working the moment the value changes -- which is the one
  // moment it is needed. This asserts the finder reads the preamble's first link whatever it points at.
  const link = readmeProjectLink();
  assert.ok(link.homepage, "the README preamble must carry a project link at all");
  assert.match(link.homepage, /^https?:\/\//, "and it must be a URL rather than an anchor or a path");
});
