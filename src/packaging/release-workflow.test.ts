import { test } from "node:test";
import assert from "node:assert/strict";
import { codeOf, workflowCode } from "./workflow-code.ts";

const release = workflowCode("release.yml");
const callerJob = release.slice(release.indexOf("\n  release:\n"));

test("a release is a tag and nothing else: no registry, no stored token, no manual trigger", () => {
  assert.match(release, /^on:\n {2}push:\n {4}branches: \[main\]$/m, "positive control: the trigger block is found and is a push to main");
  for (const forbidden of [/workflow_dispatch/, /kind: npm/, /npm publish/, /NODE_AUTH_TOKEN/, /NPM_TOKEN/, /pull-requests: write/]) {
    assert.doesNotMatch(release, forbidden);
  }
});

test("the release is the shared workflow, pinned by a full sha, with kind tag and the root package that holds the version", () => {
  assert.match(callerJob, /^ {4}uses: a11ign\/toolchain\/\.github\/workflows\/release-per-merge\.yml@[0-9a-f]{40}$/m, "positive control: the call is found, by a 40-hex sha and no tag or branch");
  assert.match(callerJob, /^ {6}kind: tag$/m);
  assert.doesNotMatch(callerJob, /lone-package-dir/, "the package is the root manifest, so the tag is `v<version>` with no directory named: one is a typo for a package that is not there");
  assert.doesNotMatch(release, /git push origin "HEAD:refs\/tags/, "the tag is the shared workflow's to cut, not this file's");
});

test("the tag is cut only after ci.yml's gate succeeded on the exact sha: this file's guard is in `needs:`, and the shared one reads the same check", () => {
  assert.match(callerJob, /^ {4}needs: \[gate\]$/m, "positive control: the caller job waits on the guard");
  assert.match(callerJob, /^ {6}gate-check: gate$/m);
  assert.match(release, /check_name=gate/);
  assert.match(release, /success\) exit 0 ;;/);
  assert.match(release, /refs\/heads\/main/);
});

test("the caller grants `id-token` only so the called workflow loads, and under kind tag the publish job that asks for it never runs", () => {
  assert.equal(release.match(/id-token/g)?.length, 1, "exactly one grant, in the caller job");
  assert.ok(callerJob.includes("id-token: write"), "positive control: the one grant is in the caller job");
  assert.match(callerJob, /^ {6}kind: tag$/m);
});

test("codeOf drops a comment that mentions the trigger", () => {
  assert.doesNotMatch(codeOf("# workflow_dispatch\non:\n  push:\n"), /workflow_dispatch/);
});
