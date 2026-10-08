/**
 * Every WAV a case embeds must be a well-formed RIFF file, because a malformed one does not fail here — it
 * fails on the fleet, intermittently, as an evidence DRIFT nobody can trace to the page.
 *
 * #1866: `media-autoplay-audio` carried a hand-typed base64 WAV with one stray 0x00 after the RIFF size
 * field. Every chunk tag sat a byte late, the media never decoded, and the `.good` variant's native play
 * button announced "unable to play media." on every capture after a worker's first. It cost a night of
 * fleet re-runs chasing an autoplay-policy theory and a warm-up theory before the bytes were read.
 *
 * Pure and millisecond-fast: the pages are strings, and reading four fixed offsets settles it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES } from "./case-matrix.mjs";

const WAV_DATA_URI = /data:audio\/wav;base64,([A-Za-z0-9+/=]+)/g;

function embeddedWavs(): { at: string; bytes: Buffer }[] {
  const found: { at: string; bytes: Buffer }[] = [];
  for (const c of CASES as { id: string }[]) {
    for (const match of JSON.stringify(c).matchAll(WAV_DATA_URI)) {
      found.push({ at: c.id, bytes: Buffer.from(match[1], "base64") });
    }
  }
  return found;
}

function riffDefects({ at, bytes }: { at: string; bytes: Buffer }): string[] {
  const tag = (offset: number) => bytes.toString("ascii", offset, offset + 4);
  const expected: [number, string][] = [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]];
  const defects = expected
    .filter(([offset, want]) => tag(offset) !== want)
    .map(([offset, want]) => `${at}: offset ${offset} reads ${JSON.stringify(tag(offset))}, expected "${want}"`);
  if (bytes.readUInt32LE(4) !== bytes.length - 8) defects.push(`${at}: RIFF size ${bytes.readUInt32LE(4)} != ${bytes.length - 8}`);
  if (bytes.readUInt32LE(40) !== bytes.length - 44) defects.push(`${at}: data size ${bytes.readUInt32LE(40)} != ${bytes.length - 44}`);
  if (bytes.readUInt32LE(40) === 0) defects.push(`${at}: data chunk is empty, so there is nothing to decode`);
  return defects;
}

test("the corpus embeds at least one WAV — the positive control for the emptiness assertion below", () => {
  // Both variants of media-autoplay-audio embed one. If this reads zero, the regex or the case moved and
  // the next test passes on an empty population.
  assert.ok(embeddedWavs().filter((w) => w.at.startsWith("media-autoplay-audio")).length >= 1);
});

test("every WAV a case embeds is well-formed RIFF/WAVE PCM with its chunks at their fixed offsets", () => {
  assert.deepEqual(embeddedWavs().flatMap(riffDefects), []);
});

test("the pre-#1866 literal fails this check — the check can see the defect it exists for", () => {
  const malformed = Buffer.from("UklGRiQAAAAAV0FWRWZtdCAQAAAAAQABAEANDgAgTgAAAgAQAGRhdGEAAAAA", "base64");
  assert.ok(riffDefects({ at: "pre-1866", bytes: malformed }).some((d) => d.includes("offset 8")));
});
