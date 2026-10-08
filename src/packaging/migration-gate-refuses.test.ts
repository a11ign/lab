/**
 * `scorer:migration` must REFUSE a release while a feature-schema migration is open.
 *
 * ## What it guards
 *
 * A migration is declared when the featurizer's input schema moves ahead of the shipped weights. In that
 * state the weights cannot score under the pipeline in this tree — the model and the features disagree
 * about what the inputs MEAN — so anything released would be wrong in a way no accuracy number shows.
 *
 * ## The subtlety worth proving, which is the escape hatch
 *
 * `--evaluating` exits 0 with a migration open, and the script's own comment records why it must exist:
 * without it the gate is CIRCULAR. A migration closes only at promotion, and an open migration blocks
 * `release:gate` — so the gate that would qualify a promotion refuses to run because the promotion has
 * not happened. Nothing could be promoted through the front door.
 *
 * An escape hatch is exactly the thing that quietly becomes the normal path. `A11Y_SKIP_VERIFY=1` was
 * used six times in one evening here for a refusal that turned out to be a stale local export. So this
 * proves both halves: the hatch works, AND it announces itself, so a green line cannot be misread as
 * "no migration".
 *
 * ## Why tier 2 runs against a COPY of the script
 *
 * The script resolves its repo root from `import.meta.url`, so exercising the blocked path means a
 * declaration file existing at that path. Planting one in `packages/` — even inside a `finally` — risks
 * the failure `test_no_writes_into_source_tree.py` was written after: a dirty tree made the lab run 17
 * commits behind for days, every job reporting the true and useless "Not pulling: the checkout is dirty".
 *
 * The script imports only node builtins, so a copy in a temp tree resolves its own root and reads a
 * planted declaration there. Real process, real exit code, real message, nothing written into the repo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationVerdict, MIGRATION_FILE } from "../../../../scripts/check-schema-migration.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPT = join(REPO, "scripts/check-schema-migration.mjs");

const OPEN = {
  shippedSchema: "screenreader-structured-v7",
  pendingSchema: "screenreader-structured-v15",
  openedAt: "2026-08-24",
  why: "the featurizer began reading the announcement parse instead of re-deriving the grammar in Python",
};

/** A temp tree shaped like the repo, so the copied script resolves its own root. */
function treeWith(declaration: object | null): string {
  // `realpathSync`, and it is NOT incidental. On macOS `tmpdir()` is under `/var`, which is a symlink to
  // `/private/var` — so a script run from there sees `import.meta.url` resolved to the real path while
  // `process.argv[1]` keeps the symlinked one. Its entry guard compares the two, so `main()` never runs
  // and the command exits 0 having printed NOTHING. Which reads exactly like a passing gate.
  //
  // Worth stating for the next tier-2 proof: a silent exit 0 from a copied script is this trap, not a
  // clean run. It cost twenty minutes here and it will look like the gate working every time.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "a11y-migration-")));
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "scripts/check-schema-migration.mjs"));
  if (declaration) {
    mkdirSync(dirname(join(root, MIGRATION_FILE)), { recursive: true });
    writeFileSync(join(root, MIGRATION_FILE), JSON.stringify(declaration));
  }
  return root;
}

function run(root: string, args: string[] = []): { status: number; output: string } {
  try {
    return { status: 0, output: execFileSync("node", [join(root, "scripts/check-schema-migration.mjs"),
      ...args], { encoding: "utf8" }) };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

test("the pure verdict blocks on an open migration and names both schemas", () => {
  const verdict = migrationVerdict(OPEN);
  assert.equal(verdict.ok, false);
  // BOTH versions, because "a migration is open" without them sends the reader to find the file.
  assert.match(verdict.message, /screenreader-structured-v7/);
  assert.match(verdict.message, /screenreader-structured-v15/);
});

test("the pure verdict passes when nothing is declared", () => {
  // The control. Without it every assertion here is satisfied by a gate that blocks unconditionally.
  assert.equal(migrationVerdict(null).ok, true);
});

test("THE COMMAND exits non-zero with a migration open", () => {
  const root = treeWith(OPEN);
  try {
    const { status, output } = run(root);
    assert.notEqual(status, 0, "an open migration must block, or release:gate sails past it");
    assert.match(output, /BLOCKED/);
    assert.match(output, /screenreader-structured-v15/, "the refusal must name what would close it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("THE COMMAND exits 0 with no migration, and says so", () => {
  const root = treeWith(null);
  try {
    const { status, output } = run(root);
    assert.equal(status, 0, "no migration must not block a release");
    assert.match(output, /no schema migration is open/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--evaluating passes a migration WITHOUT pretending there is none", () => {
  const root = treeWith(OPEN);
  try {
    const { status, output } = run(root, ["--evaluating"]);
    assert.equal(status, 0, "without this the gate is circular: nothing could ever be promoted");
    // THE HALF THAT MATTERS. A hatch that exits 0 silently is indistinguishable from a clean run, and an
    // escape indistinguishable from a pass is one that becomes the normal path.
    assert.match(output, /EVALUATING/, "the hatch must announce itself in its own output");
    assert.match(output, /Release remains blocked/,
      "it must state that release is still blocked, or a green line reads as 'no migration'");
    assert.doesNotMatch(output, /^OK\b/m, "it must not print the clean-run wording");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
