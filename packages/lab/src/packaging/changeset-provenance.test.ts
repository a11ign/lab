/**
 * The changeset is the only record of WHY a set of weights shipped. Its provenance must survive.
 *
 * `promote-model.mjs`'s own docstring gives the reason it exists: "training-report provenance (corpus,
 * encoder hash, thresholds) in the changelog entry, because 'which model produced this finding' is a
 * question somebody will ask". Two of those rows were not surviving, in every changeset ever written.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeValue, provenanceLines } from "../../scripts/promote-model.mjs";

test("an object is rendered by what identifies it, never as [object Object]", () => {
  // Measured on the real promoted report: `representation.encoder` is null, so it falls through to the
  // top-level encoder, which is `{path, hiddenSize, modelSha256}` — and `${value}` on that is the literal
  // string `[object Object]`. The HASH is the part the docstring calls the point, and it was the part
  // being destroyed.
  assert.equal(describeValue({ path: "/x", hiddenSize: 384, modelSha256: "abc123" }), "abc123");
  assert.equal(describeValue({ sha256: "def" }), "def");
  assert.equal(describeValue("training-set-minimum"), "training-set-minimum");
  assert.equal(describeValue(0.5587), "0.5587");
  // No identifying field: JSON, which is ugly and READABLE. `[object Object]` is neither.
  assert.equal(describeValue({ a: 1 }), '{"a":1}');
});

test("the feature schema is read from where the report actually carries it", () => {
  // `representation.featureSchemaVersion` appears NOWHERE else in this repo and nothing writes it, so
  // the row was filtered out as absent and has never once appeared in a changeset. The real value is
  // `representation.schema`, which is what `scorer:migration` gates on — the single most useful thing
  // for tracing a disputed finding to the model that produced it.
  const lines = provenanceLines({
    dataset: { records: 2403 },
    representation: { schema: "screenreader-structured-v15", encoder: null },
    encoder: { modelSha256: "53aa5117", path: "/opt/a11y/encoders/all-MiniLM-L6-v2" },
  });
  assert.match(lines, /- feature schema: `screenreader-structured-v15`/);
  assert.match(lines, /- encoder: `53aa5117`/);
  assert.ok(!lines.includes("[object Object]"), "the defect this test exists for");
});

test("a row with nothing behind it is omitted rather than rendered empty", () => {
  // The filter that HID the schema bug: an absent value drops the row silently. That is right — a row
  // reading "- feature schema: `undefined`" is worse — but it means a MISTYPED field name looks exactly
  // like a model that has no schema, which is how this survived every release.
  const lines = provenanceLines({ dataset: { records: 5 } });
  assert.equal(lines, "- records: `5`");
});
