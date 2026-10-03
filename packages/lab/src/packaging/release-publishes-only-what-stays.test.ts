/**
 * THE MONOREPO'S OWN RELEASE MUST NOT PUBLISH A PACKAGE WHOSE REPOSITORY HAS NOT RELEASED IT YET (#3126, child of #69).
 *
 * The chairman's direction is RELEASE PER REPOSITORY (ADR 0040; #2885, #2887, #2705): `@a11ign/screenreader-worker`,
 * `@a11ign/screenreader-fleet` and `@a11ign/documents` publish from their own repositories. Until each package has left,
 * `release.yml` still sees it as a non-private workspace package, and `changeset publish` would publish it from
 * `a11ign/a11ign`: exactly the binding the chairman rejected, and one a published `@a11ign/*` version cannot take back
 * after 72 hours. The typed `publish-for-real` confirmation stopped an ACCIDENTAL release, not a deliberate one made before
 * the moves finish (ceo, #3126); #3131 removed the confirmation, which leaves this hold standing on the publishing push.
 *
 * ## Why this is a test and not a config entry
 *
 * Measured 2026-10-03 with `@changesets/cli` 3.0.1 in a scratch tree of `main`, none of it reaching the registry:
 *   - `ignore` = the three names: REFUSED, `a11ign` depends on the skipped `documents` and `screenreader-fleet`.
 *   - `ignore` = the three plus `a11ign`: REFUSED, 7 pending changesets name `screenreader-worker` beside `evidence`
 *     (a "mixed changeset"), and it would drop the CLI from the release anyway.
 *   - `private: true` on the three: REFUSED, changesets treats a private package as skipped too.
 * So `.changeset/config.json` is untouched, and the guard is this file plus ONE step in `release.yml`.
 *
 * ## It bites on the real path only
 *
 * The three are publishable today, so asserting they are not would be red on `main` for as long as the moves take. The
 * held-set assertion therefore runs only under `A11Y_CHECK_RELEASE_HOLD=1` (the precedent is
 * `A11Y_CHECK_MAIN_RULESET=1`), which `release.yml` sets on a step guarded by the plan's `publish` mode (#3131; it was `inputs.dry-run == false`). Ordinary CI and
 * the dry run stay green; a real publish goes red before any byte leaves, naming the package. What keeps that from
 * being a switch nobody throws is the last test here, which reads the PARSED workflow.
 *
 * ## Lifting a name
 *
 * Each entry of `HELD` says when it comes off: the day its repository's first release has published and `npm view
 * <name>` shows it. Each move row's last step deletes ONE entry (and the package directory leaves this repository in the
 * same change). Nothing here reads the registry: a hold that asked the network could not run on a runner without one, and
 * a name leaving the list is a reviewed change on purpose.
 *
 * Positive control for the emptiness assertion under the flag: the fixture tests below, which REFUSE a held name that is
 * publishable, and the real-workspace test that the publishable set is non-empty and holds `@a11ign/evidence`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO = fileURLToPath(new URL("../../../..", import.meta.url));
const WORKFLOW = join(REPO, ".github/workflows/release.yml");
const SELF = "packages/lab/src/packaging/release-publishes-only-what-stays.test.ts";
const HOLD_FLAG = "A11Y_CHECK_RELEASE_HOLD";

/** The one declared list. Entries come off one at a time, each by the move row that finishes its package. */
const HELD: readonly { name: string; moveRow: string; liftedWhen: string }[] = [
  {
    name: "@a11ign/screenreader-worker",
    moveRow: "#2701",
    liftedWhen: "its repository's first release has published and `npm view @a11ign/screenreader-worker` shows it",
  },
  {
    name: "@a11ign/screenreader-fleet",
    moveRow: "#2702",
    liftedWhen: "its repository's first release has published and `npm view @a11ign/screenreader-fleet` shows it",
  },
  {
    name: "@a11ign/documents",
    moveRow: "#2705",
    liftedWhen: "its repository's first release has published and `npm view @a11ign/documents` shows it",
  },
];
const HELD_NAMES = HELD.map((entry) => entry.name);

/** What `changeset publish` would consider: every non-private workspace package under `packagesDir`. */
function publishableNames(packagesDir: string): string[] {
  const names: string[] = [];
  for (const dir of readdirSync(packagesDir)) {
    let manifest: { name?: string; private?: boolean };
    try {
      manifest = JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
    } catch {
      continue; // a directory without a manifest is not a workspace package, so there is nothing to publish
    }
    if (manifest.name && manifest.private !== true) names.push(manifest.name);
  }
  return names;
}

/** The `held` packages a release from `packagesDir` would publish, in the order of `held`. */
function heldAndPublishable(packagesDir: string, held: readonly string[]): string[] {
  const publishable = new Set(publishableNames(packagesDir));
  return held.filter((name) => publishable.has(name));
}

/** The fixtures hold their OWN names, so lifting the last real entry never breaks the controls that prove the check bites. */
const FIXTURE_HELD = ["@fixture/held-a", "@fixture/held-b"];

function refusal(offenders: string[]): string {
  return `the release would publish ${offenders.join(", ")} from this repository, before their own repositories `
    + `have released them (ADR 0040, #3126). Lift a name only when its HELD entry's condition is true.`;
}

function fixtureWorkspace(manifests: Record<string, object>): string {
  const root = mkdtempSync(join(tmpdir(), "release-hold-"));
  for (const [dir, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
  }
  return root;
}

test("the derived publishable set of the real workspace is non-empty and holds @a11ign/evidence (positive control)", () => {
  const publishable = publishableNames(join(REPO, "packages"));
  assert.ok(publishable.length > 0, "no publishable workspace package found: the derivation is broken, not the hold");
  assert.ok(publishable.includes("@a11ign/evidence"),
    `@a11ign/evidence is the package that stays and publishes from here; the derivation found ${publishable.join(", ")}`);
});

test("a fixture workspace with a held package publishable is REFUSED, naming it", () => {
  const root = fixtureWorkspace({
    a: { name: "@a11ign/evidence" },
    b: { name: FIXTURE_HELD[0] },
    c: { name: FIXTURE_HELD[1], private: true },
  });
  try {
    assert.deepEqual(heldAndPublishable(root, FIXTURE_HELD), [FIXTURE_HELD[0]],
      "exactly the publishable held name is an offender; the private one and the unheld one are not");
    assert.match(refusal(heldAndPublishable(root, FIXTURE_HELD)), new RegExp(FIXTURE_HELD[0]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fixture workspace with every held package private or absent is NOT refused", () => {
  const root = fixtureWorkspace({
    a: { name: "@a11ign/evidence" },
    b: { name: FIXTURE_HELD[0], private: true },
  });
  try {
    assert.deepEqual(heldAndPublishable(root, FIXTURE_HELD), [], "a private or absent held package is not published");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every held entry names its move row and when it is lifted", () => {
  for (const entry of HELD) {
    assert.match(entry.moveRow, /^#\d+$/, `${entry.name} must name the move row that deletes its entry`);
    assert.match(entry.liftedWhen, /npm view/, `${entry.name} must say the lift is read off \`npm view\``);
  }
  assert.equal(new Set(HELD_NAMES).size, HELD_NAMES.length, "a name listed twice is lifted by neither move");
});

test("THE HOLD: the real workspace publishes none of the held packages (real path only, under the flag)", () => {
  const offenders = heldAndPublishable(join(REPO, "packages"), HELD_NAMES);
  if (process.env[HOLD_FLAG] !== "1") {
    // Not a skip that hides: the derivation above ran on the real workspace, and the workflow test below pins that
    // the real path sets the flag. Ordinary CI is meant to stay green while the three are still here.
    console.log(`  HOLD NOT ENFORCED (no ${HOLD_FLAG}=1): ${offenders.length} held package(s) publishable from here today`);
    return;
  }
  assert.deepEqual(offenders, [], refusal(offenders));
  console.log("  RELEASE HOLD PASS: no held package is publishable from this repository");
});

interface Step { name?: string; if?: string; run?: string; env?: Record<string, string> }

function releaseSteps(): Step[] {
  const doc = parse(readFileSync(WORKFLOW, "utf8")) as { jobs?: Record<string, { steps?: Step[] }> };
  return Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

test("release.yml runs this hold on the real path only, before the access read-back and the publish", () => {
  const steps = releaseSteps();
  const holdAt = steps.findIndex((step) => step.env?.[HOLD_FLAG] === "1");
  assert.notEqual(holdAt, -1, `no release.yml step sets ${HOLD_FLAG}=1, so the hold would never bite`);
  const hold = steps[holdAt];
  assert.equal(hold.if?.replace(/\s+/g, " ").trim(), "needs.plan.outputs.mode == 'publish'",
    "the hold runs on the publishing push only: the rehearsal and ordinary CI stay green while the three are still here");
  assert.ok(hold.run?.includes(SELF), `the hold step must run ${SELF}`);
  assert.ok(hold.run?.includes("RELEASE HOLD PASS"),
    "a green exit is not a pass: the step must require the PASS line, or a run that asserted nothing would publish");
  const accessAt = steps.findIndex((step) => /\.changeset\/config\.json.*\.access|\.access.*\.changeset\/config\.json/s.test(step.run ?? ""));
  const publishAt = steps.findIndex((step) => step.run?.includes("changeset publish"));
  assert.ok(accessAt > holdAt, "the hold must come BEFORE the access read-back");
  assert.ok(publishAt > holdAt, "the hold must come BEFORE `changeset publish`, so the real path goes red before a byte leaves");
});
