/**
 * THE NAME A NIGHTLY RELEASE HAS TO RECOVER, testable without `ansible` or a real fetch.
 *
 * `lab:fetch -e artifact=corpus-archive` flattens every corpus snapshot to the same local path
 * (`runs/fetched/candidate.corpus-archive.<ext>`), because that is the right behaviour for every OTHER
 * artifact it knows. `corpus-release-nightly.mjs` reads the fetch's own "from ... on the lab" line back to
 * recover the real `corpus-<timestamp>.tar.gz` name before handing anything to `corpus-release.mjs`, whose
 * `tagFor` depends on that exact filename. Both halves of that recovery are split out from the I/O for the
 * same reason `corpus-release.mjs`'s own `releaseVerdict`/`tagFor` are: the decision is the part worth
 * pinning.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceBasenameFromFetchOutput,
  flattenedFetchPath,
} from "../../scripts/corpus-release-nightly.mjs";

test("recovers the real snapshot name from lab-fetch.yml's own debug line", () => {
  const output = [
    "TASK [Where it landed] *********************************************************",
    "ok: [a11y-lab] => ",
    "    msg:",
    "    - runs/fetched/candidate.corpus-archive.gz",
    "    - from backups/corpus-2026-09-21_03-00-00.tar.gz on the lab",
    "",
    "PLAY RECAP **********************************************************************",
  ].join("\n");
  assert.equal(sourceBasenameFromFetchOutput(output), "corpus-2026-09-21_03-00-00.tar.gz");
});

test("a source path is reduced to its basename, not left as a lab-relative path", () => {
  // The debug line names a path RELATIVE TO THE LAB'S OWN REPO (`backups/corpus-...`); only the
  // basename means anything once the bytes are on the control plane.
  const output = "from backups/corpus-2026-01-02_03-04-05.tar.gz on the lab";
  assert.equal(sourceBasenameFromFetchOutput(output), "corpus-2026-01-02_03-04-05.tar.gz");
});

test("no matching line means no name -- the caller refuses rather than guessing one", () => {
  const output = "PLAY RECAP\na11y-lab : ok=9 changed=0 unreachable=0 failed=0\n";
  assert.equal(sourceBasenameFromFetchOutput(output), null);
});

test("the flattened path is named for the ARTIFACT, with the source's own last extension", () => {
  // `lab-job.yml`'s own naming task: `candidate.<artifact>` plus whatever `splitext` leaves of the
  // source name -- which, like Python's, strips only the LAST dot, so a `.tar.gz` source yields `.gz`.
  assert.match(
    flattenedFetchPath("corpus-2026-09-21_03-00-00.tar.gz").replaceAll("\\", "/"),
    /runs\/fetched\/candidate\.corpus-archive\.gz$/,
  );
});

test("an unusual source extension is carried through rather than hardcoded to .gz", () => {
  assert.match(
    flattenedFetchPath("corpus-2026-09-21_03-00-00.tar.bz2").replaceAll("\\", "/"),
    /runs\/fetched\/candidate\.corpus-archive\.bz2$/,
  );
});
