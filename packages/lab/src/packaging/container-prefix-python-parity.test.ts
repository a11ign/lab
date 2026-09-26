/**
 * THE PYTHON FEATURIZER'S CONTAINER PREFIX MUST DIFFER FROM THE JS WORKER'S BY EXACTLY THE KNOWN WORDS.
 *
 * Split out of `packages/nvda-worker/src/container-prefix-parity.test.ts` (#2612, child 1 of #69), which pins the
 * other two copies of "what a container prefix looks like" (`CONTAINER_ROLES` against the worker's
 * `CONTAINER_PREFIX`) and had this one test reading `scorer`'s `screenreader_features.py` by a `../../scorer/`
 * path. A layer that is to leave for its own repository cannot lean on a sibling's file by path, and the two
 * halves of a parity check must stay checked by something, so THE ASSERTION MOVED and was not deleted.
 *
 * It lives in `lab` and not in `scorer` because `lab` already declares `@a11ign/nvda-worker`, which this reads BY
 * NAME (`capture-pure` resolves to the worker's source in either layout); `scorer` would need a new manifest
 * dependency on an AGPL package and a lockfile edit for one test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CONTAINER_PREFIX } from "@a11ign/nvda-worker/capture-pure";

/**
 * THE PYTHON COPY, PINNED AS A KNOWN, DATED DIVERGENCE — NOT AS EQUALITY.
 *
 * Measured 2026-09-05: `screenreader_features.py`'s `CONTAINER_PREFIX` accepts two bare words the JS
 * worker's does not, `"search,"` and `"contentinfo,"`. Both come from `LANDMARK_ROLES`, a Python-only set
 * that also feeds a DIFFERENT purpose (a landmark-vs-not classification) and was folded into the prefix
 * regex's alternation wholesale rather than word by word — so these two travelled in without a specific
 * decision the way `"section"` got one.
 *
 * Checked against the local `runs/` snapshot on disk (2,181 dataset captures + 28 real-page captures,
 * dated 2 Sep): no capture contains a bare `"search,"` or `"contentinfo,"` — every real occurrence reads
 * `"search landmark, ..."`, which both sides already strip (via the generic leading-name mechanism on the
 * JS side, and via the `(?:\s+landmark)?` suffix on the Python side). That snapshot is a known-stale copy,
 * not the authoritative corpus, so "unobserved" here is SUSPECTED rather than SETTLED — record it as such,
 * do not read it as proof the divergence is safe.
 *
 * NOT RECONCILED, deliberately: `structured_feature_values` reads through this regex, so narrowing it is a
 * feature-extraction change and would need `FEATURE_SCHEMA_VERSION` bumped and a retrain to validate —
 * fleet/lab work, out of reach here and not a thing to fold into an unrelated audit regardless.
 *
 * BOTH SIDES READ FROM THE REAL ARTEFACT, never restated: the JS set comes off the imported `CONTAINER_
 * PREFIX` regex's own `.source`, and the Python set off `screenreader_features.py`'s source text (which
 * cannot be imported into a JS test at all) — the same exception `forbidden-input-keys-parity.test.ts`
 * documents and takes.
 */
const KNOWN_PYTHON_ONLY_WORDS = new Set(["search", "contentinfo"]);

function jsAcceptedBareWords(): string[] {
  // The role alternation is the LAST parenthesised group before the trailing `,\s*` — the leading
  // `(?:\w[\w\s'-]*[,\s]\s*)?` group is the optional preceding NAME, not a role.
  const match = /\(\?:([a-z|\s]+)\),\\s\*$/i.exec(CONTAINER_PREFIX.source);
  assert.ok(match, "CONTAINER_PREFIX's shape changed; the role-alternation extraction no longer matches "
    + "it -- this test now examines nothing and must be re-read, not just re-run");
  return match[1].split("|");
}

function pythonAcceptedBareWords(): string[] {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../../scorer/python/screenreader_features.py"), "utf8");
  const landmarkRoles = /LANDMARK_ROLES = \{([^}]*)\}/.exec(source);
  const extraUnion = /LANDMARK_ROLES \| \{([^}]*)\}/.exec(source);
  assert.ok(landmarkRoles && extraUnion,
    "screenreader_features.py's CONTAINER_PREFIX no longer builds its alternation from LANDMARK_ROLES "
    + "unioned with a literal set -- this test's extraction no longer matches the real construction and "
    + "must be re-read, not just re-run");
  const words = (text: string) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return [...new Set([...words(landmarkRoles![1]), ...words(extraUnion![1])])];
}

test("the Python featurizer's container prefix differs from the JS worker's by EXACTLY the known words", () => {
  const js = new Set(jsAcceptedBareWords());
  const python = new Set(pythonAcceptedBareWords());
  assert.ok(js.size >= 8, "too few words read from the JS worker's regex; its shape changed");
  assert.ok(python.size >= 8, "too few words read from the Python featurizer; its shape changed");

  const pythonOnly = [...python].filter((word) => !js.has(word)).sort();
  assert.deepEqual(pythonOnly, [...KNOWN_PYTHON_ONLY_WORDS].sort(),
    `the Python featurizer accepts ${JSON.stringify(pythonOnly)} as bare container prefixes that the JS `
    + `worker does not. If this is a NEW word, it is an unpinned divergence -- decide whether it is real `
    + `(add it to the JS worker and re-run evidence:check) or add it to KNOWN_PYTHON_ONLY_WORDS with the `
    + `reason, dated. If a listed word is now GONE from this list, the regex was edited -- remove it from `
    + `KNOWN_PYTHON_ONLY_WORDS, it would otherwise hide a real narrowing.`);

  // BOTH DIRECTIONS. The JS worker accepting a word the Python featurizer does not would be a hole on the
  // Python side -- a feature silently blind to a container word the worker already strips.
  const jsOnly = [...js].filter((word) => !python.has(word)).sort();
  assert.deepEqual(jsOnly, [],
    `the JS worker accepts ${JSON.stringify(jsOnly)} that the Python featurizer does not -- a container `
    + `word stripped from the capture but never from the featurizer's own reading of the same announcement`);
});
