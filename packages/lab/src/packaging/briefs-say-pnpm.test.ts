// no-token: gh -- reads markdown and JSON files under the repo and nothing else; no `gh`, `herdr` or network is reached
/**
 * #2894 (row 7 of 10 of the move to pnpm, #57): THE FILES AN AGENT LOADS ON A WAKE TELL IT TO TYPE `pnpm`.
 *
 * An agent does what its brief says, so a brief that still says `npm run X` keeps the old package manager alive
 * on every wake no matter what the manifest declares. This reads the role briefs, the CLAUDE.md files and the
 * rules the row names, and refuses any line that tells an agent to run `npm run`, `npm test`, `npm install`,
 * `npm ci`, `npm exec` or `npx`, naming file and line.
 *
 * The exceptions are HISTORICAL lines: prose recording what an agent ran on a date, or a unit file's path, which
 * rewriting to say `pnpm` would make false. They are an allowlist by file and line, each carrying the words that
 * identify it (so a line that moved is reported rather than silently exempting whatever now sits there), and the
 * list is pinned by count so growing it is a decision made in a diff.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The row's Region: every file an agent loads, or is pointed at, for what to type. */
const REGION = [
  ".agent-org/roles",
  "CLAUDE.md",
  ".github/CLAUDE.md",
  "packages/lab/CLAUDE.md",
  "packages/nvda-worker/CLAUDE.md",
  "packages/control/CLAUDE.md",
  ".claude/rules",
] as const;

/** A command an agent is told to type under the old package manager. `npm_config_cache` and `/usr/bin/npm` are not it. */
const NPM_COMMAND = /\bnpm (?:run|ci|install|test|exec)\b|\bnpx\b/;
/** The same command under the new one: what the positive control counts. */
const PNPM_COMMAND = /\bpnpm (?:run|install|test|exec)\b/;

type Allowed = { file: string; line: number; anchor: string; why: string };
type Source = { file: string; text: string };

/** Lines that record what was run, not what to run. Each anchor is a phrase from that line. */
const HISTORICAL: readonly Allowed[] = [
  { file: ".agent-org/roles/README.md", line: 440, anchor: "JS portion left none",
    why: "the drill's own measurement of what `npm test` left behind" },
  { file: ".agent-org/roles/memory/local-worker-vms-deprecated.md", line: 14, anchor: "opened with",
    why: "what CLAUDE.md said on 2026-08-28, the contradiction this memory records" },
  { file: ".agent-org/roles/memory/merge-worktree-is-not-a-gate-environment.md", line: 12, anchor: "pre-push",
    why: "what the pre-push hook ran when GIT_DIR leaked into it" },
  { file: ".agent-org/roles/memory/worktree-resolves-primary-dist.md", line: 14, anchor: "Measured 2026-09-06",
    why: "the dated incident" },
  { file: ".agent-org/roles/migrate.md", line: 125, anchor: "ExecStart=/usr/bin/npm",
    why: "a systemd unit path, which is the units row's (#2892) to move, and /usr/bin/pnpm does not exist" },
  { file: ".agent-org/roles/migrate.md", line: 195, anchor: "ran clean after",
    why: "what the reconstitution drill ran on a date" },
  { file: ".agent-org/roles/product-manager.md", line: 98, anchor: "Fifth instance, 2026-09-09",
    why: "a dated incident" },
  { file: ".agent-org/roles/reviewer.md", line: 273, anchor: "unavailable (0/4;",
    why: "a dated incident: `npx` failed before execution" },
  { file: ".agent-org/roles/worker-loop-orchestrator.md", line: 220, anchor: "had already been tried",
    why: "what a worker tried in an incident" },
];

/** Pinned: a number the author moves in the same diff as the line it counts. */
const HISTORICAL_COUNT = 9;

function filesUnder(path: string): string[] {
  const abs = join(ROOT, path);
  if (!statSync(abs).isDirectory()) return [path];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(md|json)$/.test(entry.name))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)));
}

const regionSources = (): Source[] =>
  REGION.flatMap(filesUnder).map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));

const isAllowed = (file: string, line: number, text: string, allowed: readonly Allowed[]) =>
  allowed.some((a) => a.file === file && a.line === line && text.includes(a.anchor));

/** Every `file:line` that tells an agent to run npm and is not an allowlisted historical line. */
function npmCommandOffenders(sources: readonly Source[], allowed: readonly Allowed[]): string[] {
  return sources.flatMap(({ file, text }) =>
    text.split("\n").flatMap((lineText, i) =>
      NPM_COMMAND.test(lineText) && !isAllowed(file, i + 1, lineText, allowed)
        ? [`${file}:${i + 1}: ${lineText.trim().slice(0, 100)}`] : []));
}

/** Allowlist entries whose line has moved or no longer holds an npm command: a stale exemption is a defect too. */
function staleAllowances(sources: readonly Source[], allowed: readonly Allowed[]): string[] {
  return allowed.flatMap((a) => {
    const lineText = sources.find((s) => s.file === a.file)?.text.split("\n")[a.line - 1] ?? "";
    return NPM_COMMAND.test(lineText) && lineText.includes(a.anchor) ? [] : [`${a.file}:${a.line} (${a.anchor})`];
  });
}

const fixture = (text: string): Source[] => [{ file: "fixture/brief.md", text }];
const FIXTURE_ALLOWED: Allowed[] = [{ file: "fixture/brief.md", line: 2, anchor: "on 2026-09-09", why: "fixture" }];

test("a brief that says `npm run work:gate` is REFUSED, naming the file and the line", () => {
  const offenders = npmCommandOffenders(fixture("intro\nRun `npm run work:gate` first.\n"), []);
  assert.equal(offenders.length, 1);
  assert.match(offenders[0], /^fixture\/brief\.md:2: /);
});

test("every spelling of the old package manager is refused, and the new one is not", () => {
  for (const line of ["npm run x", "npm test", "npm install", "npm ci", "npm exec tsc", "npx tsc --noEmit"]) {
    assert.equal(npmCommandOffenders(fixture(line), []).length, 1, `${line} must be refused`);
  }
  for (const line of ["pnpm run work:gate", "pnpm test", "pnpm exec tsc", "npm_config_cache=/x", "/usr/bin/pnpm"]) {
    assert.deepEqual(npmCommandOffenders(fixture(line), []), [], `${line} must pass`);
  }
});

test("the same text on an allowlisted line passes, and on any OTHER line is still refused", () => {
  const text = "intro\n`npm run x` was run on 2026-09-09\n";
  assert.deepEqual(npmCommandOffenders(fixture(text), FIXTURE_ALLOWED), []);
  assert.equal(npmCommandOffenders(fixture(`${text}\`npm run x\` was run on 2026-09-09\n`), FIXTURE_ALLOWED).length, 1);
  assert.equal(npmCommandOffenders(fixture(`new first line\n${text}`), FIXTURE_ALLOWED).length, 1,
    "a moved line is not exempted by the entry that used to describe it");
});

test("a stale allowlist entry is reported: the line moved, or no longer holds an npm command", () => {
  assert.deepEqual(staleAllowances(fixture("intro\n`npm run x` on 2026-09-09\n"), FIXTURE_ALLOWED), []);
  assert.equal(staleAllowances(fixture("intro\n`pnpm run x` on 2026-09-09\n"), FIXTURE_ALLOWED).length, 1);
  assert.equal(staleAllowances(fixture("`npm run x` on 2026-09-09\nintro\n"), FIXTURE_ALLOWED).length, 1);
});

test("the real Region tells no agent to run npm, outside the pinned historical lines", () => {
  assert.deepEqual(npmCommandOffenders(regionSources(), HISTORICAL), []);
});

test("POSITIVE CONTROL: the real Region is read and holds at least 20 pnpm command lines", () => {
  const sources = regionSources();
  const commandLines = sources.reduce((n, s) => n + s.text.split("\n").filter((l) => PNPM_COMMAND.test(l)).length, 0);
  assert.ok(sources.length >= 20, "fewer than 20 Region files were read: the walk lost its population");
  assert.ok(commandLines >= 20, "fewer than 20 command lines were found: a Region that lost its commands is not a pass");
});

test("the allowlist is pinned by count, and every entry still matches its line", () => {
  assert.equal(HISTORICAL.length, HISTORICAL_COUNT);
  assert.deepEqual(staleAllowances(regionSources(), HISTORICAL), []);
  for (const a of HISTORICAL) assert.notEqual(a.why, "", `${a.file}:${a.line} must say why it is exempt`);
});
