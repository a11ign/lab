/**
 * #1172: `docs/try-it.md` quotes the no-worker error "because it is the most likely first result", and
 * nothing compared that quote to what `cli.ts` actually builds -- the page was missing the `(reason)`
 * line `refuseIfNothingListening` prints last, the one line that carries WHY the connection failed
 * (`ECONNREFUSED`, a DNS failure, a timeout).
 *
 * `cli.ts` now exports `noWorkerMessage({ worker, reason })` as a pure builder so this test drives the
 * real producer instead of comparing two independently retyped literals -- a hand-typed expectation in
 * this file would be a THIRD copy of the string, the defect this row is about one level up.
 *
 * Whitespace is normalised before comparing: the doc hand-wraps the long middle sentence across several
 * display lines for readability, which is cosmetic and not a difference in content. A changed WORD still
 * fails this test; only line-wrap position is ignored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { noWorkerMessage } from "../../../cli/src/cli.js";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const TRY_IT = readFileSync(resolve(REPO, "docs/try-it.md"), "utf8");

const normalize = (text: string): string => text.trim().replace(/\s+/g, " ");

test("docs/try-it.md's quoted no-worker error matches noWorkerMessage()'s real output", () => {
  const fenceMatch = TRY_IT.match(/```\nNo capture worker answered[\s\S]*?```/);
  assert.ok(fenceMatch, "docs/try-it.md no longer has a fenced quote starting with 'No capture worker "
    + "answered' -- either the wording changed or the fence moved; find it before trusting this test");
  const quoted = fenceMatch![0].replace(/^```\n/, "").replace(/```$/, "");

  // The address and the reason the page's example shows -- inputs to the real builder, not part of the
  // text under test, so a MUTATION in cli.ts's fixed prose still changes the comparison below.
  const worker = "http://localhost:8765";
  const reason = "connect ECONNREFUSED 127.0.0.1:8765";
  const expected = noWorkerMessage({ worker, reason });

  assert.equal(normalize(quoted), normalize(expected),
    "docs/try-it.md's quoted no-worker error no longer matches noWorkerMessage()'s real output -- update "
    + "the fence in docs/try-it.md to match what cli.ts now builds (#1172)");
});

test("the page's quote is complete: it includes the (reason) line cli.ts prints last", () => {
  // `noWorkerMessage` ends its second paragraph with `.\n(${reason})` -- the fence must show a line
  // starting with "(" right after the "...none)." sentence, not stop one line short of it.
  assert.match(TRY_IT, /or use the GitHub Action if you have none\)\.\n\(/,
    "docs/try-it.md's fence ends before the (reason) line cli.ts actually prints last -- the quote is "
    + "missing the one line a confused reader needs most: why the connection failed (#1172)");
});
