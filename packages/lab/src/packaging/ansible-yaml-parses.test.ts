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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";

const REPO = resolve(import.meta.dirname, "../../../..");
const ANSIBLE = "packages/control/ansible/";

/** `collections/` is VENDORED third-party content, not ours to gate on. What it removes is counted below. */
const VENDORED = `${ANSIBLE}collections/`;

const committedYml = () =>
  // `sandboxGitEnv()` is CALLED, not merely imported: git exports GIT_DIR into every hook environment, so
  // a spawn with an inherited env reads whatever repository the caller was in -- which on 2026-09-06 put
  // stray commits on real refs. A test that walks the tree is exactly the shape that inherits one.
  execFileSync("git", ["-C", REPO, "ls-files", `${ANSIBLE}**/*.yml`, `${ANSIBLE}*.yml`],
    { encoding: "utf8", env: sandboxGitEnv() })
    .split("\n").filter(Boolean);

const EXPECTED_FILES = 45;
const EXPECTED_VENDORED = 2;

test("#1274: every committed Ansible .yml parses, and the file list is NAMED not globbed", () => {
  const all = committedYml();
  const ours = all.filter((p) => !p.startsWith(VENDORED));
  const vendored = all.filter((p) => p.startsWith(VENDORED));

  // THE COUNT IS ASSERTED EQUAL, NOT FLOORED. A walk that silently finds nothing passes a floor
  // perfectly, and this test's entire value is that it reached every file.
  assert.equal(ours.length, EXPECTED_FILES,
    `expected ${EXPECTED_FILES} committed Ansible .yml files outside collections/, found ${ours.length}:\n  `
    + `${ours.join("\n  ")}\n\nIf a playbook was added or removed, update EXPECTED_FILES deliberately -- `
    + "this number moving silently is how the population stops being the one anybody checked.");
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
