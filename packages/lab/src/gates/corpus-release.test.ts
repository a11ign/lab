/**
 * THE VERDICT AN OFFSITE BACKUP TURNS ON, testable without a network or a `gh` binary.
 *
 * `corpus-release.mjs` uploads a snapshot to a private GitHub release and then DOWNLOADS IT BACK to check
 * what is inside — because `gh release upload` exiting 0 means the API accepted the bytes, which is not
 * the same as the asset being there, complete, and readable a month from now. That is the only property a
 * backup has, and it is the same argument `corpus-snapshot.mjs` makes about `tar` exiting 0 and
 * `worker:code` makes about verifying a deploy over HTTP rather than through the deploy channel.
 *
 * The comparison is split out from the I/O for the reason every verdict in this repo is: the decision is
 * the part worth pinning, and it can then be exercised in both directions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { releaseVerdict, tagFor, jsonEntries, DEFAULT_REPO } from "../../scripts/corpus-release.mjs";

test("a matching count is the only success, and it says what it counted", () => {
  const v = releaseVerdict({ expected: 5397, found: 5397, tag: "corpus-2026-09-06_18-15-48" });
  assert.equal(v.ok, true);
  assert.match(v.why, /5397 JSON file\(s\), matching the archive/);
});

test("FEWER is a truncated asset — a failed backup, named as one", () => {
  const v = releaseVerdict({ expected: 5397, found: 4959, tag: "corpus-2026-09-06_18-15-48" });
  assert.equal(v.ok, false);
  assert.match(v.why, /438 did not survive the round trip/);
});

test("MORE is a DIFFERENT snapshot, and is called out as the harder failure", () => {
  // The direction that cannot happen from the same archive. It means the tag names another corpus, which
  // restores cleanly and is therefore worse than a shortfall — nothing downstream can tell.
  const v = releaseVerdict({ expected: 5397, found: 5800, tag: "corpus-2026-09-06_18-15-48" });
  assert.equal(v.ok, false);
  assert.match(v.why, /MORE, not fewer/);
  assert.match(v.why, /restores cleanly as the wrong corpus/);
});

test("the tag comes from the ARCHIVE's name, never from the clock", () => {
  // The snapshot runs on the lab and the upload runs on the control plane, possibly hours later. A tag
  // from `Date.now()` would name the moment of TRANSPORT rather than the moment of the corpus, and a
  // backup's identity is when the evidence was.
  assert.equal(tagFor("backups/corpus-2026-09-06_18-15-48.tar.gz"), "corpus-2026-09-06_18-15-48");
  assert.equal(tagFor("/anywhere/else/corpus-2026-01-02_03-04-05.tar.gz"), "corpus-2026-01-02_03-04-05");
});

test("a file that is not a corpus snapshot yields NO tag, so the caller refuses rather than inventing one", () => {
  // Uploading an arbitrary tarball under a plausible tag is how a backup set acquires an entry nobody
  // can account for — `release:provenance`'s complaint, one artefact along.
  assert.equal(tagFor("backups/something-else.tar.gz"), null);
  assert.equal(tagFor("corpus-latest.tar.gz"), null);
  assert.equal(tagFor("corpus-2026-09-06.tar.gz"), null, "a date with no time is not the snapshot format");
});

test("the entry count reads `.json` lines only, so a listing's directories do not inflate it", () => {
  const listing = [
    "screenreader-dataset/", "screenreader-dataset/captures/",
    "screenreader-dataset/captures/a.json", "screenreader-dataset/captures/b.json",
    "screenreader-dataset/manifest.json", "real-page-corpus/notes.txt", "",
  ].join("\n");
  assert.equal(jsonEntries(listing), 3);
});

test("the default destination is a NAME this test states, so a silent redirect fails here", () => {
  // Where the corpus goes is the owner's decision. If someone changes it, that is a decision and it
  // should cost a test edit rather than being a diff nobody reads.
  assert.equal(DEFAULT_REPO, "a11ign/corpus-backups");
});
