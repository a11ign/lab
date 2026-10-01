/**
 * THE DOCS SAY pnpm (#2895, row 8 of 10 of "Finish the move to pnpm", #57).
 *
 * `docs/`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md` and `PLAN.md` are what people and agents read when they look a
 * command up. A line there that says `npm run` / `npm test` / `npm exec` / `npx` is one of three things, and only the
 * first is a defect:
 *
 *   - an INSTRUCTION ("to do X run Y"): it must say pnpm. This test refuses it, naming file and line.
 *   - a RECORD (what a session ran, what a gate printed, on a date): it stays as typed, because rewriting it to pnpm
 *     makes the record false. Records are listed below BY FILE with a one-line reason and PINNED BY COUNT, so a new
 *     npm instruction cannot hide inside a file that already has records, and a record that is later rewritten
 *     (the pin is now too high) is noticed rather than left as a stale exemption.
 *   - DELIBERATE npm: a command that is npm on purpose, the text recognised by pattern rather than listed: the
 *     consumer's `npx a11ign`, the remote `npx @guidepup/setup` that provisioning and the Action really run, and the
 *     Windows `npx.ps1` shim a worker's error names. A HEADING is exempt too: the row freezes heading text because
 *     other files link to its anchor.
 *
 * `pnpm run X -- --flag` is NOT the pnpm spelling of `npm run X -- --flag`: pnpm hands the literal `--` to the script
 * (measured with pnpm 10.34.5: the script's argv was ["--","--x","1"], where npm's was ["--x","1"]). So the rewrite
 * DROPS the `--`, and that is why a flag after a script name reads differently from the npm line it replaced.
 *
 * Headings are compared against the merge-base so a rewrite cannot rename a section out from under its anchor.
 * The READMEs of the two PRIVATE packages (`lab`, `control`) are in the Region (#2923): nobody consumes them, so every
 * command in them is an instruction to somebody working in this repository. The other `packages/*\/README.md` are
 * published READMEs a consumer follows (`npx a11ign` is right there), and are not.
 */
// requires: history
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sandboxGitEnv } from "../../../guards/src/git-env.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PRIVATE_PACKAGE_READMES = [
  "packages/lab/README.md",
  "packages/lab/src/training/README.md",
  "packages/control/README.md",
  "packages/control/ansible/README.md",
];
const REGION = ["docs", "README.md", "CONTRIBUTING.md", "SECURITY.md", "PLAN.md", ...PRIVATE_PACKAGE_READMES];

/** The row's own open-check expression: what counts as a line that names an npm command. */
const NPM_COMMAND = /\bnpm (run|test|exec)|\bnpx\b/;

/** npm on purpose. Matched by pattern, and removed before the line is judged, so a line that ALSO carries `npm run` is still refused. */
const DELIBERATE = [
  /\bnpx (--yes )?"?@guidepup\/setup\S*/g, // a remote package, fetched by npx exactly as provisioning and action.yml do
  /\bnpx a11ign\b/g, // the consumer's command, against the published package
  /\bnpx\.(ps1|cmd)\b/g, // the Windows shim a worker's error message names
];

interface Hit { line: number; text: string; kind: "instruction" | "heading" | "deliberate" }

const isFence = (line: string): boolean => /^\s*(```|~~~)/.test(line);

/** Every line naming an npm command, classified. Fence-aware: a `# comment` inside a code block is not a heading. */
export function commandLines(text: string): Hit[] {
  let inFence = false;
  const hits: Hit[] = [];
  text.split("\n").forEach((raw, i) => {
    if (isFence(raw)) inFence = !inFence;
    if (!NPM_COMMAND.test(raw)) return;
    const rest = DELIBERATE.reduce((s, re) => s.replace(re, ""), raw);
    const kind = !inFence && /^#{1,6}\s/.test(raw) ? "heading" : NPM_COMMAND.test(rest) ? "instruction" : "deliberate";
    hits.push({ line: i + 1, text: raw.trim(), kind });
  });
  return hits;
}

/** Every ATX heading outside a code fence, as written. */
export function headingsOf(text: string): string[] {
  let inFence = false;
  return text.split("\n").filter((raw) => {
    if (isFence(raw)) inFence = !inFence;
    return !inFence && /^#{1,6}\s/.test(raw);
  }).map((h) => h.trim());
}

/** Headings present before and gone after, and the reverse. Empty means no heading text changed. */
export function headingDrift(before: string, after: string): string[] {
  const b = headingsOf(before);
  const a = headingsOf(after);
  return [
    ...b.filter((h) => !a.includes(h)).map((h) => `removed or edited: ${h}`),
    ...a.filter((h) => !b.includes(h)).map((h) => `added or edited: ${h}`),
  ];
}

/**
 * Files in the Region whose instruction lines break the rule. `pins` is the records allowlist flattened to
 * file -> number of record lines left. A file with no pin must have none; a file with one must have exactly that many.
 */
export function refusals(files: Record<string, string>, pins: Record<string, number>): string[] {
  const out: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    const hits = commandLines(text).filter((h) => h.kind === "instruction");
    const pinned = pins[file] ?? 0;
    if (pinned === 0) hits.forEach((h) => out.push(`${file}:${h.line}: an npm instruction, say pnpm (or list the file as a record): ${h.text.slice(0, 80)}`));
    else if (hits.length !== pinned) out.push(`${file}: pinned at ${pinned} record lines, found ${hits.length} (lines ${hits.map((h) => h.line).join(", ")})`);
  }
  for (const file of Object.keys(pins)) if (!(file in files)) out.push(`${file}: pinned but not in the Region`);
  return out;
}

interface RecordGroup { kind: "record" | "deliberate"; reason: string; files: Record<string, number> }

/** Instruction-shaped lines LEFT AS TYPED, by file, with why. Measured 2026-10-01 at 251f82f61 (237 record lines, 8 deliberate). */
const LEFT_AS_TYPED: RecordGroup[] = [
  {
    kind: "record",
    reason: "the dated plan: each command names what a measurement or a status was taken with",
    files: {
      "PLAN.md": 5,
    },
  },
  {
    kind: "record",
    reason: "an ADR: the decision as recorded, quoting what was typed at the time",
    files: {
      "docs/adr/0004-package-boundaries.md": 2,
      "docs/adr/0005-workspaces-build-and-linking.md": 2,
      "docs/adr/0006-naming-registry-and-licensing.md": 1,
      "docs/adr/0007-versioning-and-release.md": 1,
      "docs/adr/0008-what-stays-internal.md": 5,
      "docs/adr/0010-real-page-calibration-corpus.md": 1,
      "docs/adr/0014-idle-workers-power-themselves-down.md": 2,
      "docs/adr/0015-one-defect-per-page-taught-the-scorer-to-veto.md": 3,
      "docs/adr/0018-a-placeholder-label-is-not-witnessable-by-a-screen-reader.md": 1,
      "docs/adr/0019-a-synthetic-holdout-cannot-falsify-a-synthetic-assumption.md": 1,
      "docs/adr/0020-unexamined-is-not-failing.md": 1,
      "docs/adr/0021-the-layer-that-decides-must-be-the-layer-allowed-to-claim.md": 1,
      "docs/adr/0025-the-capture-cache-key-describes-evidence-not-code.md": 2,
      "docs/adr/0027-bare-metal-fleet-replaces-local-vm-capture.md": 1,
      "docs/adr/0030-fleet-code-parity-is-a-precondition-not-a-cache-key.md": 2,
      "docs/adr/0032-the-scorer-runs-as-a-subprocess-in-a-python-venv.md": 2,
      "docs/adr/0033-guidepup-exact-pin-is-evidence-not-dependency-hygiene.md": 1,
      "docs/adr/0036-the-layer-model.md": 1,
      "docs/adr/0038-authenticated-capture.md": 4,
      "docs/adr/0039-the-split-is-mostly-org-machinery.md": 16,
      "docs/adr/0040-agent-org-is-a-standalone-project-agnostic-tool.md": 37,
    },
  },
  {
    kind: "record",
    reason: "a dated audit: what was measured and how",
    files: {
      "docs/architecture-audit.md": 4,
    },
  },
  {
    kind: "record",
    reason: "the RECORD of what was found and what it cost",
    files: {
      "docs/backlog.md": 23,
    },
  },
  {
    kind: "record",
    reason: "the history of a removed section",
    files: {
      "docs/board/README.md": 2,
    },
  },
  {
    kind: "record",
    reason: "generated board record: the command line a gate or achievement reported",
    files: {
      "docs/board/reported/achievements/issue-311-f29021fb.json": 2,
      "docs/board/reported/achievements/issue-356-c81cb047.json": 1,
      "docs/board/reported/gates/board-edition-2026-09-09-pdf-refused.json": 1,
      "docs/board/reported/gates/fleet-access-after-the-rename-2026-09-08.json": 1,
      "docs/board/reported/gates/npm-run-lab-job-e-job-capture-only-e-only-7-families-e-captu-a620f9d7.json": 1,
      "docs/board/reported/gates/npm-run-lab-job-e-job-promote-e-ref-main-65e81af4.json": 1,
      "docs/board/reported/gates/npm-run-lab-job-e-job-release-gate-e-ref-8efe61c413bab57a3b0-97866055.json": 2,
      "docs/board/reported/gates/npm-run-lab-job-e-job-rules-real-pages-e-ref-0d9655dbbf243c6-59906942.json": 2,
      "docs/board/reported/gates/npm-run-lab-job-e-job-rules-real-pages-e-ref-lead-real-page--6c3b1464.json": 2,
      "docs/board/reported/gates/npm-run-lab-job-e-job-rules-real-pages-e-ref-main-b43b4151.json": 1,
      "docs/board/reported/gates/sweep-protocol-21-2212.json": 1,
      "docs/board/reported/meta.json": 1,
    },
  },
  {
    kind: "record",
    reason: "a dated draft of a board summary, quoting the commands it was written from",
    files: {
      "docs/board/summary-drafts-2026-09-10.md": 2,
    },
  },
  {
    kind: "record",
    reason: "an audit: the command its issue's acceptance named",
    files: {
      "docs/capture-phase-breakdown-audit.md": 1,
    },
  },
  {
    kind: "record",
    reason: "a dated plan whose commands are the measured acceptance runs",
    files: {
      "docs/capture-protocol-plan.md": 1,
    },
  },
  {
    kind: "record",
    reason: "dated protocol history",
    files: {
      "docs/capture-protocol-version-history.md": 1,
    },
  },
  {
    kind: "record",
    reason: "GENERATED from each script's own `// command:` header; the header is edited in its own row, then regenerated",
    files: {
      "docs/commands.md": 1,
    },
  },
  {
    kind: "record",
    reason: "a dated plan with MET statuses and transcripts",
    files: {
      "docs/control-plane-plan.md": 8,
    },
  },
  {
    kind: "record",
    reason: "a dated plan with MET statuses; its commands are what was run to meet each",
    files: {
      "docs/determinism-plan.md": 9,
    },
  },
  {
    kind: "record",
    reason: "a struck-through rule kept as the lesson",
    files: {
      "docs/fleet-capacity-history.md": 2,
    },
  },
  {
    kind: "record",
    reason: "transcript of commands and their exit codes",
    files: {
      "docs/guard-population-boundaries.md": 3,
    },
  },
  {
    kind: "record",
    reason: "dated history of the August build",
    files: {
      "docs/history-2026-08.md": 13,
    },
  },
  {
    kind: "record",
    reason: "the reasoning behind a gate, at the time",
    files: {
      "docs/isolation-spike.md": 1,
    },
  },
  {
    kind: "record",
    reason: "dated readings inside a gap's history",
    files: {
      "docs/known-gaps.md": 5,
    },
  },
  {
    kind: "record",
    reason: "transcripts of `lab:job describe` and an error message",
    files: {
      "docs/lab-cli.md": 2,
    },
  },
  {
    kind: "record",
    reason: "the `Tests run:` lines of replays that were run",
    files: {
      "docs/mutant-replay.md": 2,
    },
  },
  {
    kind: "record",
    reason: "incident readings: what ran and what it printed",
    files: {
      "docs/not-working.md": 6,
    },
  },
  {
    kind: "record",
    reason: "an incident's quoted failure",
    files: {
      "docs/nvda-behavior-incidents.md": 1,
    },
  },
  {
    kind: "record",
    reason: "incident log: what a session ran, on a date",
    files: {
      "docs/operational-lessons.md": 29,
    },
  },
  {
    kind: "record",
    reason: "incident entries quoting what was typed",
    files: {
      "docs/pipeline.md": 5,
    },
  },
  {
    kind: "deliberate",
    reason: "runs after the revert, when npm IS the manager (or is the rehearsal transcript)",
    files: {
      "docs/pnpm-rollback.md": 8,
    },
  },
  {
    kind: "record",
    reason: "a dated plan; its commands are what each phase ran",
    files: {
      "docs/reliability-plan.md": 2,
    },
  },
  {
    kind: "record",
    reason: "the incident an acceptance rule was written from, quoting what was typed",
    files: {
      "docs/row-filing.md": 2,
    },
  },
  {
    kind: "record",
    reason: "a baseline taken at a commit",
    files: {
      "docs/split-baseline.md": 1,
    },
  },
  {
    kind: "record",
    reason: "an audit of rows on a date",
    files: {
      "docs/stale-row-audit.md": 1,
    },
  },
  {
    kind: "record",
    reason: "an investigation: what was run",
    files: {
      "docs/ufffc-investigation.md": 1,
    },
  },
];

const PINS: Record<string, number> = Object.fromEntries(LEFT_AS_TYPED.flatMap((g) => Object.entries(g.files)));

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, env: sandboxGitEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
}

function regionFiles(): string[] {
  return git(["ls-files", "--", ...REGION]).split("\n").filter((f) => f !== "" && /\.(md|json)$/.test(f));
}

const readRegion = (): Record<string, string> =>
  Object.fromEntries(regionFiles().map((f) => [f, readFileSync(`${REPO_ROOT}${f}`, "utf8")]));

/** Markdown files in the Region at 251f82f61: the heading comparison must have read most of them. */
const MIN_MARKDOWN_FILES = 80;

/** Below this the scan has broken rather than the docs shrunk: measured 2026-10-01, 512 lines in 90 files at 251f82f61. */
const MIN_COMMAND_LINES = 200;

const BAD_DOC = ["# Guide", "", "Build it:", "", "```bash", "npm run build", "```"].join("\n");

test("#2895: a fixture doc with an `npm run` instruction is REFUSED, naming file and line", () => {
  const found = refusals({ "docs/guide.md": BAD_DOC }, {});
  assert.equal(found.length, 1);
  assert.match(found[0], /^docs\/guide\.md:6: /);
});

test("#2895: the same line in an allowlisted record passes, and the pin bites in both directions", () => {
  assert.deepEqual(refusals({ "docs/log.md": BAD_DOC }, { "docs/log.md": 1 }), []);
  assert.match(refusals({ "docs/log.md": `${BAD_DOC}\nnpm test` }, { "docs/log.md": 1 })[0], /pinned at 1 record lines, found 2/);
  assert.match(refusals({ "docs/log.md": "# Log\n\nnothing here" }, { "docs/log.md": 1 })[0], /pinned at 1 record lines, found 0/);
  assert.match(refusals({}, { "docs/gone.md": 1 })[0], /pinned but not in the Region/);
});

test("#2895: the pnpm spelling passes, and each of the four forms is recognised", () => {
  assert.deepEqual(refusals({ "docs/ok.md": "pnpm run build\npnpm test\npnpm exec tsx x.ts" }, {}), []);
  const forms = ["npm run a", "npm test", "npm exec -- x", "npx tsx y"];
  assert.equal(refusals({ "docs/forms.md": forms.join("\n") }, {}).length, forms.length);
});

test("#2895: deliberate npm is recognised by pattern, and does not shelter a real instruction", () => {
  const ok = ["`npx a11ign https://example.com`", "npx --yes @guidepup/setup install nvda", "`npx.ps1 cannot be loaded`"];
  assert.deepEqual(refusals({ "docs/deliberate.md": ok.join("\n") }, {}), []);
  const mixed = refusals({ "docs/mixed.md": "`npx a11ign` then `npm test`" }, {});
  assert.equal(mixed.length, 1, "positive control: a line carrying both is still an instruction");
});

test("#2895: a heading is exempt (its text is frozen), a `# comment` inside a code fence is not a heading", () => {
  assert.deepEqual(refusals({ "docs/h.md": "## npm run row-file\n" }, {}), []);
  assert.equal(commandLines("```bash\n# npm run x  (a comment)\n```").map((h) => h.kind).join(), "instruction");
});

test("#2895: a changed heading is REFUSED; a body edit and a fenced comment are not", () => {
  const before = "# One\n\nrun `npm test`\n\n```bash\n# a comment\n```\n\n## Two\n";
  assert.deepEqual(headingDrift(before, before.replace("npm test", "pnpm test").replace("# a comment", "# another")), []);
  const drift = headingDrift(before, before.replace("## Two", "## Three"));
  assert.deepEqual(drift, ["removed or edited: ## Two", "added or edited: ## Three"]);
});

test("#2895: the real Region has no unlisted npm instruction, and the scan finds the commands it is meant to", () => {
  const files = readRegion();
  const all = Object.values(files).flatMap((t) => commandLines(t));
  assert.ok(all.length >= MIN_COMMAND_LINES, `only ${all.length} command lines found; the scan is broken, not the docs shrunk`);
  assert.ok(Object.keys(files).length >= MIN_MARKDOWN_FILES, `only ${Object.keys(files).length} Region files read`);
  assert.deepEqual(refusals(files, PINS), []);
});

test("#2923: the private packages' READMEs are read by the real Region, and an `npm run` added to one is REFUSED naming file and line", () => {
  const files = readRegion();
  for (const file of PRIVATE_PACKAGE_READMES) {
    assert.ok(file in files, `${file} is not read by the Region: the scan is not looking where the row says`);
    assert.match(files[file], /\bpnpm (run|exec|dlx)\b/, `${file}: names no pnpm command; a README that names none proves nothing`);
    const added = `${files[file]}\n\`\`\`bash\nnpm run lab:status\n\`\`\`\n`;
    const found = refusals({ [file]: added }, {});
    assert.equal(found.length, 1, `positive control: one added npm line in ${file} must be the one refusal`);
    assert.match(found[0], new RegExp(`^${file.replace(/[./]/g, "\\$&")}:\\d+: `));
  }
});

test("#2923: no private-package README is pinned as a record: every command in them is an instruction", () => {
  assert.deepEqual(PRIVATE_PACKAGE_READMES.filter((f) => f in PINS), []);
});

test("#2895: every record group names a reason, and no pin is zero", () => {
  assert.ok(LEFT_AS_TYPED.length > 0);
  for (const g of LEFT_AS_TYPED) assert.ok(g.reason.length > 20, `a group has no reason: ${JSON.stringify(g.files).slice(0, 80)}`);
  assert.deepEqual(Object.entries(PINS).filter(([, n]) => n < 1), []);
});

const NO_ORIGIN_MAIN = "origin/main does not resolve in this checkout -- run `git fetch origin main`. Not run, and not counted as a pass.";

function mergeBase(): string | null {
  try {
    return git(["merge-base", "HEAD", "origin/main"]).trim();
  } catch {
    return null;
  }
}

test("#2895: no heading in any Region file differs from the merge-base's", (t) => {
  const base = mergeBase();
  if (base === null) { t.skip(NO_ORIGIN_MAIN); return; }
  assert.match(base, /^[0-9a-f]{40}$/);
  // Every Region .md that existed at the base, not only the changed ones: on main's own tip nothing has changed, and
  // "compared none" must not read as "compared and found no drift".
  const atBase = new Set(git(["ls-tree", "-r", "--name-only", base, "--", ...REGION]).split("\n"));
  const compared = regionFiles().filter((f) => f.endsWith(".md") && atBase.has(f));
  assert.ok(compared.length >= MIN_MARKDOWN_FILES, `only ${compared.length} Markdown files compared against ${base}`);
  const drift = compared.flatMap((f) => headingDrift(git(["show", `${base}:${f}`]), readFileSync(`${REPO_ROOT}${f}`, "utf8")).map((d) => `${f}: ${d}`));
  assert.deepEqual(drift, []);
});
