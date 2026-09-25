// no-token: gh -- every `gh` here is a stub on PATH; nothing imported reaches the real one
/**
 * `npm run work:tick` AS THE SHELL RUNS IT, #1972: the gate's refusal must survive to the exit status.
 *
 * The script was `work-gate.mjs | wake.mjs`. `sh` returns the LAST command's status, so a gate that examined
 * nothing (`CANNOT_ASK`, 2) was overwritten by `wake`'s 0 and an unwoken org read as a quiet one.
 * `wake.test.ts` pins `afterGate`, the decision `work-tick.mjs` makes; it cannot pin which program the
 * `package.json` script actually starts, and this file is the only reader of that. It lives apart from
 * `wake.test.ts` because that file imports `route`, which reaches `gh`, and the acceptance job has no token.
 *
 * THE PIN IS THE BEHAVIOUR, NOT THE MECHANISM. The script text is read from `package.json` and run through
 * `sh -c` as npm does, so any spelling that carries the gate's code past the pipe (a wrapper, `work-tick.mjs`,
 * `PIPESTATUS`) passes and any that swallows it fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
// `work-tick.mjs`'s own `EXIT.CANNOT_ASK`, restated: importing it would pull `wake.mjs` and its `gh` reach into a file
// that must stay runnable without a token. `wake.test.ts` pins the constant itself.
const CANNOT_ASK = 2;
const STUB_MODE = 0o755; // the tick invokes both as commands, so the stubs have to be runnable

/** An empty roster: `herdr` answers, and nobody is on it. */
const HERDR_STUB = "#!/bin/sh\ncase \"$*\" in\n  *'workspace list') printf '%s' '{\"result\":{\"workspaces\":[]}}' ;;\n"
  + "  *) : ;;\nesac\n";

/**
 * Runs the `work:tick` script with `gh` refusing (`null`) or answering the given text to every call.
 * `HOME` is a scratch directory so the tick reads no real ledger, queue or settings.
 */
function runTickScript(ghAnswer: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "work-tick-exit-"));
  try {
    const script = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts["work:tick"];
    assert.equal(typeof script, "string", "package.json defines work:tick");
    writeFileSync(join(dir, "gh"), ghAnswer === null ? "#!/bin/sh\nexit 1\n" : `#!/bin/sh\nprintf '%s' '${ghAnswer}'\n`);
    writeFileSync(join(dir, "herdr"), HERDR_STUB);
    chmodSync(join(dir, "gh"), STUB_MODE);
    chmodSync(join(dir, "herdr"), STUB_MODE);
    return spawnSync("sh", ["-c", script], {
      cwd: REPO_ROOT, encoding: "utf8",
      env: { ...process.env, HOME: dir, PATH: `${dir}:${process.env.PATH ?? ""}` },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("#1972: `npm run work:tick` exits CANNOT_ASK when the gate could examine nothing -- not the quiet 0 a pipe reports", () => {
  const ran = runTickScript(null);
  assert.match(ran.stderr, /Nothing was examined/, `the gate must have been the one that refused; got ${ran.stderr}`);
  assert.equal(ran.status, CANNOT_ASK,
    "a refused tick is distinguishable from a quiet one by its status alone; `a | b` returns b's, which was 0");
});

test("#1972 (control): the same script does NOT exit CANNOT_ASK when the gate could read, so the status above is the gate's", () => {
  // `[]` for every read: both lanes answer, so the refusal branch is not taken. Whatever else the tick reports
  // (this scratch host has unrelated findings and nobody to deliver them to), it is not the refused-read verdict.
  const ran = runTickScript("[]");
  assert.doesNotMatch(ran.stderr, /Nothing was examined/, "the gate read its lanes");
  assert.notEqual(ran.status, CANNOT_ASK, "an always-2 script would fail here");
});
