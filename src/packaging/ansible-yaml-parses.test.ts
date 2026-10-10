/**
 * #1274 — EVERY COMMITTED ANSIBLE `.yml` PARSES, and the population is named rather than globbed.
 *
 * Nothing in CI parsed a playbook. Seven tests enumerate `packages/control/ansible`; six read the files
 * as TEXT and assert with regexes, and a regex over broken YAML matches exactly as well as over valid
 * YAML. The seventh parses `lab-job.yml` alone. So a playbook could be committed with invalid YAML,
 * every check would go green, and the first thing to notice would be a fleet or lab dispatch failing at
 * the moment somebody needed it. Measured on #1274: invalid YAML appended to `fleet-link-view.yml`,
 * confirmed live by a real parser first, and the three enumerating suites still printed 10 pass / 0 fail.
 *
 * THE POPULATION COMES FROM `git ls-files`, NOT `find`, AND THAT IS THE WHOLE DIFFERENCE BETWEEN 44 AND
 * 46. The row filed this at 46, measured with `find` in a working checkout. `find` walks the FILESYSTEM,
 * so it counted two untracked local files — `inventory.yml` and `extra-hosts.local.yml`, both generated
 * and both gitignored. CI clones and has neither. A `find`-based assertion would therefore read 46 on a
 * developer's machine and 44 in CI: green locally, red remotely, for a reason the failure would not
 * explain. The committed tree is also the right SUBJECT — a file nobody can push cannot break anyone
 * else's dispatch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { laidControlFiles } from "./laid-control.ts";

const REPO = resolve(import.meta.dirname, "../../../..");
const ANSIBLE = "packages/control/ansible/";

/** `collections/` is VENDORED third-party content, not ours to gate on. What it removes is counted below. */
const VENDORED = `${ANSIBLE}collections/`;

// The population is the LAID layer on disk, not `git ls-files`: `packages/control` is a layer of a11ign/control since a11ign/a11ign#3506, untracked in the core, and the header's
// reason for `git` (two gitignored operator files `find` counts and CI does not have) is what `laidControlFiles` excludes by name (a11ign/a11ign#3972).
const committedYml = () => laidControlFiles(REPO).filter((path) => path.startsWith(ANSIBLE) && path.endsWith(".yml"));

// A FLOOR, NOT AN EQUALITY (a11ign/lab#4840). The population is the control layer laid at whatever pin the core takes, so
// its size moved (59 -> 61) with no lab commit, and an equality made lab's test a mirror of another repository's file
// count. 59 is the last count lab asserted; the floor is what "the walk reached the tree" needs, and the parse below is
// what the test is for. The control layer's own additions do not need a number moved here.
const MINIMUM_FILES = 59;
const EXPECTED_VENDORED = 2;

test("#1274: every committed Ansible .yml parses, and the file list is NAMED not globbed", () => {
  const all = committedYml();
  const ours = all.filter((p) => !p.startsWith(VENDORED));
  const vendored = all.filter((p) => p.startsWith(VENDORED));

  // A walk that silently finds nothing passes an emptiness assertion perfectly, so the population is floored at what it
  // last held. Files can be added by the layer; a walk that loses some is what fails here.
  assert.ok(ours.length >= MINIMUM_FILES,
    `expected at least ${MINIMUM_FILES} committed Ansible .yml files outside collections/, found ${ours.length}:\n  `
    + `${ours.join("\n  ")}\n\nA walk that reaches fewer files than the layer last held is a broken walk, not a smaller tree.`);
  assert.equal(vendored.length, EXPECTED_VENDORED,
    "collections/ is excluded, and what the exclusion removes is stated rather than left to the glob");

  const unparseable = ours.filter((rel) => {
    try {
      parseYaml(readFileSync(resolve(REPO, rel), "utf8"));
      return false;
    } catch { return true; }
  });
  assert.deepEqual(unparseable, [],
    "a committed playbook does not parse -- every check here goes green on invalid YAML, so the first "
    + "thing to notice would be a fleet or lab dispatch failing when somebody needed it");
});

test("#1274 POSITIVE CONTROL: the parser REJECTS a malformed document", () => {
  // Without this, a `parseYaml` that never throws -- a changed import, a lenient mode -- satisfies the
  // emptiness above perfectly. The assertion is that the instrument can say no, on the same shape the
  // row's mutation appends to a real playbook.
  const malformed = "---\n- hosts: all\n  this: [is, not, valid\n   - yaml: \"unterminated\n";
  // THE MATCHER IS LOAD-BEARING. `assert.throws(fn)` with no matcher accepts ANY throw, so a function
  // that fails for an unrelated reason satisfies it -- my first version of this control did exactly
  // that and a mutation proved it: replacing the body with `throw new Error("x")` still passed 3/0.
  // Naming the error means only a real parse rejection can satisfy it.
  assert.throws(() => parseYaml(malformed), (error: unknown) => {
    assert.equal((error as Error).constructor.name, "YAMLParseError",
      "the parse is the measurement; an instrument that cannot reject is not one");
    return true;
  });
  // And the same instrument must ACCEPT a valid document, or "rejects everything" would pass above.
  assert.deepEqual(parseYaml("---\n- hosts: all\n  tasks: []\n"), [{ hosts: "all", tasks: [] }]);
});

test("#1274 POSITIVE CONTROL: the walk finds files, and finds them by CONTENT not by name", () => {
  // An emptiness assertion needs its population pinned non-empty in the same test. `lab-job.yml` is named
  // because it is the one file an existing test already parses (#1274's own count), so if this walk ever
  // stops finding it the walk is broken rather than the tree changed.
  const ours = committedYml().filter((p) => !p.startsWith(VENDORED));
  assert.ok(ours.includes(`${ANSIBLE}lab-job.yml`), "the walk reaches the one file already parsed today");
  const parsed = parseYaml(readFileSync(resolve(REPO, `${ANSIBLE}lab-job.yml`), "utf8"));
  assert.ok(Array.isArray(parsed) || (parsed !== null && typeof parsed === "object"),
    "and parsing it yields a document, so `no exception` is not being read as `parsed`");
});
