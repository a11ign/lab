/**
 * #1078: `homepage` is stated in SEVEN places and nothing compares them.
 *
 * `a11ign.com` does not resolve, and it is the `homepage` of every published package and the first link in
 * the README. **This guard does not endorse that value.** Whichever way #919's decision lands — the domain
 * resolving, the post-transfer repository URL, or publishing with it dead and recording that — the seven must
 * still agree afterwards, and pinning them equal now makes the decision **one line in one place** rather
 * than seven hand edits in publish week. A published package's metadata is fixed at publish time; correcting
 * a `homepage` means republishing.
 *
 * THREE THINGS IT DELIBERATELY DOES NOT DO, each of which would make it stop working at the moment it is
 * needed:
 *
 *   - **It compares the seven to EACH OTHER, never to a literal.** A literal would be an EIGHTH copy, and
 *     the first edit would be to it.
 *   - **The population is DERIVED** from the workspaces glob minus `private`, not a hand-typed list. #919
 *     and #1078 both say FIVE packages; the derivation finds **six** — `worker-fleet` is published and
 *     carries the homepage too, so SEVEN places state it. A hand-typed list would have shipped the row's
 *     own miscount -- and correcting only the PACKAGE count left "six places" standing one line above,
 *     which is **a correction that fixes the number it was pointed at and not the one derived from it.**
 *   - **The README's occurrence is found by ROLE** — the project link in the preamble — never by matching
 *     the current string. A guard keyed on `a11ign.com` stops working the moment the value changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { stripComments } from "@a11ign/evidence/source-text";
import { productHome, PRODUCT_HOME_SOURCE } from "../../../../scripts/product-home.mjs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Every package this repository PUBLISHES, derived: the workspaces glob, minus anything `private`.
 *
 * npm's own rule is the derivation — `private: true` is what stops a package being published — so this
 * cannot disagree with what actually ships the way a list of names can.
 *
 * `repo` DEFAULTS to this checkout and is a parameter for one reason: the silent-drop test below has to
 * drive THIS function over a package that states no homepage, and no such package exists here. Building
 * the answer by hand instead is what that test used to do, and it asserted a property of `Set` rather than
 * anything about this code — **a guard whose only input is a fixture proves the fixture.**
 */
function publishedPackages(repo: string = REPO): { file: string; homepage: string | null }[] {
  const globs = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { workspaces?: string[] })
    .workspaces ?? [];
  const roots = globs.flatMap((glob) => {
    const base = glob.replace(/\/\*$/, "");
    return glob.endsWith("/*")
      ? readdirSync(join(repo, base), { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => `${base}/${e.name}`)
      : [glob];
  });
  return roots
    .map((root) => ({ root, file: `${root}/package.json` }))
    .filter(({ file }) => existsSync(join(repo, file)))
    .map(({ file }) => ({ file, json: JSON.parse(readFileSync(join(repo, file), "utf8")) as
      { private?: boolean; homepage?: string } }))
    .filter(({ json }) => json.private !== true)
    // A published package with NO homepage is a DISAGREEMENT, not an exclusion: dropping it here would let
    // one go silently unstated, which is the seven-copies defect with one copy deleted instead of changed.
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

/**
 * #1113: THE EIGHTH PLACE — the home the BOARD DOCUMENT renders, found by ROLE rather than by reading it
 * back out of the source.
 *
 * `board-document.mjs:344` used to state the URL as a literal. It was the one place outside this file's
 * population, and it was the one the chairman reads: after #1112 moved the other seven, the board would
 * have been told the product lives at a domain that does not resolve, **with every guard here green**.
 *
 * BY ROLE MEANS CALLING WHAT THE DOCUMENT CALLS, not grepping what it prints. `productHome()` is the
 * function the sentence renders, so this compares the VALUE the board is given — and it keeps working
 * when the value changes, which is the whole reason the README's occurrence is found by position.
 *
 * AND IT IS A LEAF IMPORT, NOT `board-document.mjs`. That module needs `token` — it spawns `gh` at
 * line 1204 — so importing it here would move this file from `[]` to `["token"]` in #827's closure walk
 * and disqualify it from the job that runs acceptance commands. Measured with the real deriver, before
 * and after. Same extraction and the same reason as `region-paths.mjs` (#462, B4).
 */
function boardDocumentHome(): { file: string; homepage: string | null } {
  return { file: `scripts/board-document.mjs (via ${PRODUCT_HOME_SOURCE})`, homepage: productHome() };
}

/**
 * WHAT `boardDocumentHome` CANNOT DO, said out loud because a member that cannot disagree reads exactly
 * like one that can.
 *
 * `productHome()` reads `packages/cli/package.json`, which is ALREADY in the population — so the eighth
 * entry is arithmetically incapable of disagreeing with the rest, and the `distinct.length === 1`
 * assertion learns nothing from it. **That is the point rather than a hole**: a derived value cannot drift,
 * which is the row's fourth requirement — the board document must not need editing when the value changes
 * again.
 *
 * So the protection is NOT the comparison. It is the assertion below: that the document renders the
 * function rather than a string. Put a literal back and the comparison stays green while the board is
 * told something nobody checked — which is the state this row was filed about.
 */
test("#1113: the board document RENDERS the derived home — it does not state one", () => {
  const source = stripComments(readFileSync(join(REPO, "scripts/board-document.mjs"), "utf8"));

  assert.match(source, /productHome\(\)/,
    "board-document.mjs must CALL productHome(). Without this the eighth place is a literal again, and "
    + "the comparison above cannot see it: it compares a value derived from a manifest against that same "
    + "manifest and agrees with itself");

  // AND THE VALUE ITSELF MUST NOT APPEAR, in either spelling — keyed on `productHome()` rather than on a
  // string typed here, so it keeps working when the value changes. That is the same rule the README's
  // occurrence follows, and the reason is the same: a guard keyed on today's URL stops working on the one
  // day it is needed.
  //
  // I GOT THIS WRONG TWICE BEFORE GETTING IT RIGHT, and the two failures are worth the lines. First I
  // banned every URL literal: it flagged the release link `https://github.com/${REPO}/releases/...`,
  // which is ASSEMBLED from values and cannot drift. Then I banned only URLs written whole — and my own
  // CONTROL refused it, because that pattern needs the quote immediately before `https` and so cannot see
  // a URL inside a sentence.
  //
  // **Which is exactly what the defect was.** The literal this row is about was `a11ign.com` — a BARE
  // DOMAIN, mid-sentence, with no scheme — so neither pattern would ever have caught it, and any pattern
  // loose enough to catch it flags ordinary prose. A canary that cannot express the fault proves nothing,
  // and the control is what said so rather than a green run.
  const home = productHome();
  assert.ok(home, `${PRODUCT_HOME_SOURCE} states no homepage, so there is no value to look for`);
  const bare = home.replace(/^https?:\/\//, "");
  const asLiteral = new RegExp(bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  assert.doesNotMatch(source, asLiteral,
    `board-document.mjs contains the homepage as a literal (${bare}). It must RENDER productHome(), not `
    + "restate it: a copy here is the one the board reads and nothing compares.");

  // THE CONTROL: the pattern must SEE the value when it is there, or the assertion above passes because
  // the escaping broke rather than because the source is clean.
  assert.match(`L.push("we live at ${bare} now");`, asLiteral,
    "the value-as-literal pattern cannot find the value -- the assertion above would then be vacuous");
});

test("#1078: every published package and the README state the SAME homepage", () => {
  const stated = [...publishedPackages(), readmeProjectLink(), boardDocumentHome()];
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
  // THIS TEST IS THE AGREEMENT TEST'S NON-EMPTINESS PROOF, and that is not obvious from either.
  // **The agreement test passes on an EMPTY set** -- `distinct` is then just `[readme]`, length 1 -- so
  // nothing in it notices a walk that found nothing. Measured, making the walk return no packages:
  //
  //     agreement    PASS      <- the one the row is about
  //     this test    FAIL
  //     silent-drop  FAIL
  //
  // Two catch it, and neither says so. Narrowing either later removes a protection the agreement test
  // depends on and does not mention.
});

/** A throwaway repo on disk: a workspaces glob and one `package.json` per named package. */
function fixtureRepo(packages: Record<string, Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), "homepage-agreement-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
  for (const [name, json] of Object.entries(packages)) {
    mkdirSync(join(root, "packages", name), { recursive: true });
    writeFileSync(join(root, "packages", name, "package.json"), JSON.stringify(json));
  }
  return root;
}

test("#1078: a package with NO homepage disagrees rather than being SKIPPED — driven through the real walk", () => {
  // THE SILENT-DROP HOLE, and the test that used to stand here could not see it. It built `stated` by hand
  // and asserted `new Set(...).size === 2` -- a property of `Set`, not of `publishedPackages`, so adding
  // `.filter(({ json }) => json.homepage !== undefined)` to the walk was **0 red**. The synthetic value was
  // the only value it was ever given.
  //
  // No package in this repo states no homepage, so the fixture is a REPO rather than an answer: the real
  // function walks it, and what it returns is the assertion.
  const repo = fixtureRepo({
    stated: { name: "stated", homepage: "https://example.invalid" },
    silent: { name: "silent" },
    hidden: { name: "hidden", private: true, homepage: "https://example.invalid" },
  });
  const walked = publishedPackages(repo);

  const silent = walked.find((p) => p.file.includes("/silent/"));
  assert.ok(silent, `a published package stating no homepage must survive the walk; it returned `
    + `${walked.map((p) => p.file).join(", ")} -- dropping it would let one copy VANISH instead of change, `
    + "and the rest would then agree");
  assert.equal(silent.homepage, null, "and it must read as `null`, a value that disagrees with any URL");

  assert.ok(!walked.some((p) => p.file.includes("/hidden/")),
    "a `private` package is not published, so it is correctly absent rather than a gap");
  assert.equal(new Set(walked.map((p) => p.homepage)).size, 2,
    "so the comparison above sees TWO values across these three packages and fails, which is the point");
});

test("#1078: the README link is found by POSITION, so it survives the value changing", () => {
  // Keyed on the current string, the guard stops working the moment the value changes -- which is the one
  // moment it is needed. This asserts the finder reads the preamble's first link whatever it points at.
  const link = readmeProjectLink();
  assert.ok(link.homepage, "the README preamble must carry a project link at all");
  assert.match(link.homepage, /^https?:\/\//, "and it must be a URL rather than an anchor or a path");
});
