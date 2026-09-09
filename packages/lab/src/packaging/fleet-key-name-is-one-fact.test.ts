/**
 * THE FLEET'S SSH KEY IS A FILE ON SOMEBODY'S MACHINE, AND ITS NAME IS ONE FACT — so the eleven places
 * this tree writes that name down must never be able to disagree.
 *
 * #515. The rename (#66, `e435ac17`) replaced the product name across 411 files, correctly for the tree,
 * and **a rename sweep cannot tell a name we own from a name we do not**. `~/.ssh/a11y-witness_ed25519`
 * became `~/.ssh/a11ign_ed25519` in one commit, at every site at once — which reads as consistent and is
 * the opposite of safe: renaming the string does not rename the key, so every site moved together off
 * the file that actually exists.
 *
 * The damage was not one broken fallback. It was six DEREFERENCING sites, each failing differently:
 *
 *   - `group_vars/a11y_workers.yml` — ansible authenticates against a file that is not there, whenever
 *     `A11Y_SSH_KEY` is unset. Masked for anyone who exports it, which is why it could go unnoticed.
 *   - `doctor.mjs` — `checkControlPlaneIsolation` reads the key path to decide whether this machine is
 *     holding the fleet key. Pointed at the wrong name it finds nothing and reports the control plane
 *     COMPLIANT, with the key sitting right there under its old name. A guard reading clean because it
 *     looked in the wrong place is this repository's signature defect, and this one inverts a verdict.
 *   - `bootstrap-control-plane.sh` — GENERATES the key when the path is absent. Under the wrong name it
 *     finds nothing, mints a second identity no worker trusts, and prints `ok fleet key generated`.
 *   - `bare-metal/a11y-bootstrap.service` — an `ExecStart` on a machine, handing a `.pub` to a PXE
 *     install.
 *
 * ## The remedy is the ladder, third rung
 *
 * CLAUDE.md's "A FACT STATED TWICE" ranks the fixes: delete a copy, derive one from the other, or pin
 * them equal with a test. The first two are unavailable here — the name has to appear in YAML that
 * ansible reads, JavaScript that `doctor` runs, a bash generator and a systemd unit, four languages that
 * cannot share a constant. So: pinned equal, with `group_vars/a11y_workers.yml`'s fallback as the one
 * source of truth. Rename it there and this test names every other site that has to move with it.
 *
 * DISCOVERED, never listed. A hand-written "the places that name the key" list is exactly what the next
 * sweep walks past — the same reason `git-spawn-classification.test.ts` discovers its git spawns and
 * `cli-flags.test.ts` discovers its command lines.
 *
 * ## What this test CANNOT do, said plainly
 *
 * It proves the tree agrees with itself. It cannot prove the tree agrees with the control plane, because
 * `runs/`-style access to that machine is not available from a checkout and this repository's own rule is
 * that a verification sharing no failure mode with its subject verifies nothing. The check that settles
 * it is read-only and belongs to whoever owns that machine:
 * `ansible a11y_workers -m win_ping` from a shell with `A11Y_SSH_KEY` unset — every host must pong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { declareTreeWideGuard, walkTree } from "../../../../scripts/tree-wide-guard.mjs";

// #716/#704: this file's own population is the whole tracked tree, not one file -- declared here
// rather than inferred from its source, per ceo's ruling (2026-09-09) that the tree-wide-guard
// population must be derived from a real import, never from scanning source text.
declareTreeWideGuard();

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/** Where the fleet key's name is DEFINED: the one site ansible actually dereferences. */
const SOURCE_OF_TRUTH = "packages/control/ansible/group_vars/a11y_workers.yml";

/**
 * Any `~/.ssh/<name>` or `/root/.ssh/<name>` private-key filename, with an optional `.pub`. Deliberately
 * matched against RAW source rather than comment-stripped: a comment naming the wrong key sends an
 * operator to a file that is not there, which costs an afternoon exactly like a wrong runbook does. This
 * is the one discovery in this repo where prose is as load-bearing as code.
 */
const KEY_MENTION = /(?:~|\/root)\/\.ssh\/([A-Za-z0-9][A-Za-z0-9._-]*_ed25519)/g;

/**
 * Every other private key this repository legitimately names, each with the reason it is not the fleet
 * key. A name reaching this list is a decision; a name reaching neither this list nor the fleet key's is
 * a FAILURE BY NAME, so "another key" and "somebody's rename got half of them" stay different states.
 */
const OTHER_KEYS: Record<string, string> = {
  "a11y-pve_ed25519":
    "the CONTROL-PLANE key (`A11Y_PVE_KEY`), reaching the hypervisor and the lab. A different machine "
    + "and a different credential domain — ADR 0012 is the reason the two must not be merged, and "
    + "`pve-key-has-no-default.test.ts` is the reason it has no fallback of its own to pin here.",
  "a11y-lab_ed25519":
    "`CONTROL_TO_LAB_KEY` in `lab-pipeline.mjs` — `/root/.ssh/a11y-lab_ed25519`, the control plane's own "
    + "route to the lab. A third real key on a real machine, and it survived `e435ac17` untouched only "
    + "because its name never contained the product's: the rename could not have told it apart if it had.",
  "id_ed25519":
    "the OPERATOR'S OWN default key, and every one of its four sites is a sentence saying it is NOT the "
    + "fleet key — `ssh-key.yml` reads its PUBLIC half to authorise a human on a worker, and both "
    + "group_vars files name it only to contrast with the key they actually use. A default is not a "
    + "credential this repository owns, and it must never be renamed to match a product.",
  "a11y-fixture_ed25519":
    "a FIXTURE STRING in `tracked-prose-leak-guard.test.ts` — the prose that guard is written to catch, "
    + "not a key anybody holds. It exists to be found, which is the opposite of the others here.",
};

/**
 * This file, excluded from its own walk — the device `git-population-vacuity.test.ts` and
 * `real-page-corpus-freshness.test.ts` both use, for the same reason and with the same care.
 *
 * Its header quotes the renamed spelling verbatim, because the incident is unreadable without it, and it
 * matches raw source by design — so once committed it discovers ITSELF. The honest classification would
 * be "this names the old spelling in prose ABOUT the old spelling", which is true and is also a file
 * writing its own exemption into the list it maintains: a reader cannot tell that apart from an ordinary
 * row. Excluded in code instead, so the decision is visible here rather than buried in `OTHER_KEYS`.
 *
 * What that costs, stated: a future rename that touched only this file's prose would be invisible to it.
 * That is a stale comment, not a broken authentication — this file dereferences nothing — and the second
 * test below still holds every site that does.
 */
const SELF = "packages/lab/src/packaging/fleet-key-name-is-one-fact.test.ts";

function trackedTextFiles(): string[] {
  return walkTree({ kind: "all", roots: [] }).map((f) => f.path)
    .filter((f) => f !== SELF && !f.includes("/dist/") && !f.startsWith("runs/"))
    .filter((f) => /\.(ts|mjs|js|yml|yaml|sh|md|service|cmd|ps1|json)$/.test(f) || !f.includes("."));
}

/** @returns the fleet key's filename, read out of the one file that decides it. */
function fleetKeyName(): string {
  const line = read(SOURCE_OF_TRUTH).split("\n").find((l) => l.includes("ansible_ssh_private_key_file"));
  assert.ok(line, `${SOURCE_OF_TRUTH} no longer sets ansible_ssh_private_key_file — this guard's source `
    + "of truth has moved and the guard must move with it, rather than quietly asserting over nothing");
  const match = /\/\.ssh\/([A-Za-z0-9][A-Za-z0-9._-]*_ed25519)/.exec(line);
  assert.ok(match, `no key filename in: ${line}`);
  return match[1];
}

/** Every discovered mention: `[file, keyName]`, one row per occurrence. */
function mentions(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const file of trackedTextFiles()) {
    let source: string;
    try { source = read(file); } catch { continue; }
    for (const m of source.matchAll(KEY_MENTION)) found.push([file, m[1]]);
  }
  return found;
}

test("every site naming an SSH key names the fleet key or a DECLARED other one — the population is "
  + "discovered, so a site the next rename sweep touches cannot slip past a list nobody updated", () => {
  const fleetKey = fleetKeyName();
  const all = mentions();
  assert.ok(all.length >= 8,
    `only ${all.length} key mention(s) found across the tree — the discovery is broken, and a check that `
    + "passes having examined nothing is the defect this file exists to prevent (11 on 2026-09-08)");

  assert.ok(!all.some(([file]) => file === SELF), "SELF must not reach the population");
  assert.ok(read(SELF).includes("a11ign_ed25519"),
    "SELF is excluded because it quotes the renamed spelling in prose about the rename. If it no longer "
    + "does, delete the exclusion rather than carrying an exemption nothing needs.");

  const unclassified = all.filter(([, key]) => key !== fleetKey && !(key in OTHER_KEYS));
  assert.deepEqual(unclassified, [],
    `these sites name a key that is neither the fleet key (${fleetKey}, from ${SOURCE_OF_TRUTH}) nor one `
    + `of the declared others (${Object.keys(OTHER_KEYS).join(", ")}). If a rename moved half the tree, `
    + "move the rest; if this is genuinely a new key, add it to OTHER_KEYS with the reason it exists.");
});

test("the fleet key is named in ALL FOUR languages that dereference it — YAML ansible reads, the "
  + "JavaScript `doctor` runs, the bash that generates it and the systemd unit that serves its public "
  + "half — so a rename that reaches one of them is visibly a rename that reached one of them", () => {
  const fleetKey = fleetKeyName();
  const files = new Set(mentions().filter(([, k]) => k === fleetKey).map(([f]) => f));
  for (const dereferencing of [
    "packages/control/ansible/group_vars/a11y_workers.yml",
    "packages/worker-fleet/src/doctor.mjs",
    "packages/worker-fleet/src/provisioning/bootstrap-control-plane.sh",
    "packages/worker-fleet/src/provisioning/bare-metal/a11y-bootstrap.service",
  ]) {
    assert.ok(files.has(dereferencing),
      `${dereferencing} no longer names ${fleetKey}. It DEREFERENCES the key — it authenticates with it, `
      + "reads it to decide a verdict, generates it, or serves its public half — so if the name moved "
      + "there and not here, one of those four is now pointing at a file that does not exist.");
  }
});
