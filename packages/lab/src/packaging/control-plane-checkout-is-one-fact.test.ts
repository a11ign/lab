/**
 * ENTERING THE CONTROL PLANE'S CHECKOUT IS DISCOVERED BY THE OPERATION, NOT BY THE NAME — because four
 * sweeps by three sessions searched for the name and none of them found the literal that took the fleet
 * down.
 *
 * On 2026-09-08 every fleet play was unreachable. `fleet-playbook.mjs` held `const CHECKOUT = "a11ign"`,
 * moved there by `e435ac17` (the product rename), and `deploy`, `provision`, `recover`, `wake`,
 * `inventory-install` and `control-host-install` all route through it — so each one `cd`-ed into a
 * directory that does not exist. `lab-pipeline.mjs` held the SAME fact as `"/root/a11y-witness"`, and
 * #531 restored that one and missed this one.
 *
 * ## Why a fifth sweep would not have worked either
 *
 * Every earlier search was for a VALUE: `/root/a11ign`, then `packages/`-scoped, then the SSH-key
 * filename. **A grep for a value cannot match the same value in a different shape** — bare, absolute, or
 * embedded in a `cd`. It was found by a play failing.
 *
 * So this test discovers the OPERATION. A name may take any shape; entering a directory takes exactly
 * two forms in this tree — a `cd` in a command string, and `systemd-run --working-directory=`. Every one
 * of them is found and must either interpolate `control-plane-checkout.mjs`'s export or be classified
 * with a reason. A new consumer that writes its own literal fails here by name.
 *
 * ## And the two green checks that could not see it
 *
 * `win_ping` was green 9 of 9 and `fleet:status` passed while every play was unreachable, because
 * NEITHER GOES THROUGH `CHECKOUT` — one is an ansible ping over SSH, the other reads `/health` over
 * HTTP. This repository's own rule is that a verification sharing no failure mode with the action
 * verifies nothing; here two of them said green at once. The acceptance for the fix is therefore
 * `fleet:deploy` reaching the boxes, which is the only thing that traverses the path under test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "@a11ign/evidence/source-text";
import { sandboxGitEnv } from "../../../../scripts/git-env.mjs";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, "utf8");

/** The one module that may know the directory's name. */
const SOURCE_OF_TRUTH = "packages/control/src/control-plane-checkout.mjs";

/**
 * Entering a directory, in the two forms this tree uses: a `cd` inside a command string, and
 * `systemd-run --working-directory=`. Comments are stripped first — `local-judge.paths.test.ts`
 * discusses a `cd /tmp` in prose, and a file that DESCRIBES entering a directory has not entered one.
 */
const ENTERS_A_DIRECTORY = /`cd\s+([^`&]+)|--working-directory=(\S+)/g;

/**
 * The DIRECTORY a `cd` actually enters, past any flags. `guest-run.mjs` writes `cd /d ${GUEST_DIR}` —
 * `/d` is cmd.exe's cross-drive flag, and a first draft of this guard read it as the directory and
 * reported the site as entering `/d`. **A guard fooled by a flag is the same shape-blindness that made
 * every earlier sweep miss `const CHECKOUT = "a11ign"`**, committed inside the guard written against it.
 */
function directoryEntered(argument: string): string {
  const tokens = argument.trim().split(/\s+/).filter((t) => t.length > 0);
  // ANCHORED AT BOTH ENDS. Unanchored, `/[a-zA-Z]` matches the start of `/root` too, so the ssh
  // wrapper's own landing directory was dropped as though it were a flag and the population silently
  // shrank by one. A pattern that matches more than it names is how this guard would come to examine
  // less than it believes -- the failure it exists to catch, one level down.
  return tokens.find((t) => !/^(\/[a-zA-Z]|--?[a-zA-Z][\w-]*)$/.test(t)) ?? "";
}

/**
 * A site is SAFE when the thing it enters interpolates one of the source of truth's exports — matched by
 * the exported NAMES rather than by the value, since the value is exactly what a rename moves.
 */
const EXPORTED_NAMES = ["CONTROL_PLANE_CHECKOUT", "CONTROL_PLANE_CHECKOUT_PATH"];

/**
 * Every site that enters a directory which is NOT the control plane's checkout, each with the reason.
 * A site reaching this list is a decision; a site reaching neither this list nor the source of truth is
 * a FAILURE BY NAME, so "a different directory" and "somebody wrote a second literal" stay different
 * states — which is the distinction that would have caught the outage.
 */
const NOT_THE_CONTROL_PLANE_CHECKOUT: Record<string, string> = {
  "/root": "the ssh wrapper's landing directory in `fleet-playbook.mjs`, not the checkout — it is what "
    + "makes the checkout's own `cd` relative, and it is the ssh user's home rather than a path anybody "
    + "renamed",
  "${GUEST_DIR}": "the WINDOWS worker's checkout in `guest-run.mjs` (`C:\\Users\\witness\\...`), a "
    + "different machine's directory. It is the same class as this one and is deliberately NOT fixed "
    + "here: nobody has run `win_stat` against those nine boxes, and restoring a name on sight is the "
    + "act #515 was filed against. Held on #526.",
};

/**
 * This file, excluded from its own walk — the device `git-population-vacuity.test.ts` and
 * `fleet-key-name-is-one-fact.test.ts` both use, for the same reason.
 *
 * `ENTERS_A_DIRECTORY` contains the literal text `--working-directory=(\S+)`, so the pattern matches its
 * own definition and this file reports itself as entering `(\S+)/g;`. The honest classification would be
 * "this is the pattern, not a use of it", which is true and is also a file writing its own exemption
 * into the list it maintains.
 *
 * **AND IT PASSED LOCALLY WHILE FAILING IN CI, for the reason I had documented an hour earlier and then
 * walked into.** `git ls-files` cannot see an UNTRACKED file, so every local run before `git add`
 * examined a population that did not contain this file. CI reads a commit. Run a discovery guard again
 * after committing it — the first run is the one that tells you nothing.
 */
const SELF = "packages/lab/src/packaging/control-plane-checkout-is-one-fact.test.ts";

function trackedSource(): string[] {
  return execFileSync("git", ["ls-files", "*.mjs", "*.ts"], { cwd: REPO, env: sandboxGitEnv(), encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => f !== SELF && !f.includes("/dist/"));
}

/** Every discovered site: `[file, whatItEnters]`, one row per occurrence. */
function entrySites(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const file of trackedSource()) {
    for (const m of stripComments(read(file)).matchAll(ENTERS_A_DIRECTORY)) {
      const target = directoryEntered((m[1] ?? m[2]).replace(/[`"'].*$/, ""));
      // An EMPTY target is `--working-directory=` appearing as a searched-for string rather than as a
      // built command (`lab-job.test.ts` slices argv between two such markers). Nothing is entered, so
      // there is nothing to classify -- recorded here rather than silently dropped.
      if (target !== "") found.push([file, target]);
    }
  }
  return found;
}

test("the source of truth exports the two shapes its consumers need, and the name is a fact about a "
  + "machine rather than about this repository", () => {
  const source = read(SOURCE_OF_TRUTH);
  for (const name of EXPORTED_NAMES) {
    assert.match(source, new RegExp(`export const ${name}\\b`),
      `${SOURCE_OF_TRUTH} no longer exports ${name} -- this guard's source of truth has moved and the `
      + "guard must move with it, rather than quietly asserting over nothing");
  }
});

test("every site that ENTERS a directory either interpolates the source of truth or is classified -- "
  + "keyed on the operation, because every sweep that searched for the NAME missed the literal that "
  + "took the fleet down", () => {
  const sites = entrySites();
  assert.ok(!sites.some(([file]) => file === SELF), "SELF must not reach the population");
  assert.ok(read(SELF).includes("--working-directory="),
    "SELF is excluded because its own pattern contains the text it searches for. If that stops being "
    + "true, delete the exclusion rather than carrying an exemption nothing needs.");
  assert.ok(sites.length >= 8,
    `only ${sites.length} entry site(s) found across the tree -- the discovery is broken, and a check `
    + "that passes having examined nothing is the defect this file exists to prevent (10 on 2026-09-08)");

  const unclassified = sites.filter(([file, target]) => {
    const name = /^\$\{([A-Za-z_$][\w$]*)\}/.exec(target)?.[1];
    if (name && EXPORTED_NAMES.includes(name)) return false;
    if (target in NOT_THE_CONTROL_PLANE_CHECKOUT) return false;
    // A local alias is fine ONLY if THIS file derives it from the source of truth. Reading the site's
    // OWN file matters: the first draft read `sites[0]`'s, which answered about a neighbouring file --
    // this repository's most-repeated shape, committed inside the guard written against it.
    return !(name && new RegExp(`\\b${name}\\s*=\\s*(${EXPORTED_NAMES.join("|")})\\b`).test(read(file)));
  }).map(([file, target]) => `${file}: enters ${target}`);
  assert.deepEqual(unclassified, [],
    `these sites enter a directory that is neither the control plane's checkout (from ${SOURCE_OF_TRUTH}) `
    + `nor a classified other one. If this is a SECOND literal for the checkout, derive it from the `
    + `source of truth -- that is the whole reason this file exists. If it is a different directory, add `
    + `it to NOT_THE_CONTROL_PLANE_CHECKOUT with the reason.`);
});

test("both consumers reach the checkout through the source of truth, and neither holds its own literal "
  + "-- the two files that held two shapes of one fact, with only one of them restored", () => {
  for (const consumer of ["packages/control/src/fleet-playbook.mjs", "packages/control/src/lab-pipeline.mjs"]) {
    const source = read(consumer);
    assert.match(source, /from "\.\/control-plane-checkout\.mjs"/,
      `${consumer} no longer imports the source of truth. If it stopped entering the checkout, remove `
      + "its entry here; if it grew its own literal, that is the outage again.");
    assert.ok(!/=\s*["']\/?root?\/?a11[a-z-]*["']/.test(stripComments(source)),
      `${consumer} assigns a bare checkout literal again -- the exact shape that made every fleet play `
      + "unreachable on 2026-09-08");
  }
});
