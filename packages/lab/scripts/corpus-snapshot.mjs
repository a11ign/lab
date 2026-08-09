// Archive the capture corpus, because it is expensive and nothing else protects it.
//
//   node scripts/corpus-snapshot.mjs [--out=dir]
//
// `runs/` is gitignored, so the 2,122 captures that `check-signals` and the corpus gate treat as ground
// truth exist in exactly one place: this disk. They are reproducible — `npm run training:capture` — but
// only at the cost of many hours of worker time, which makes them the most expensive artifact in the
// repo and the only one with no copy.
//
// What this deliberately does NOT do is choose where the archive lives long-term. A snapshot on the same
// disk protects against `rm -rf runs/` and a bad recapture; it does not protect against losing the
// machine. Syncing the output somewhere durable is an operator decision, and a repo that silently
// uploaded a user's data somewhere would be making it for them. See RELEASE.md, "Deferred".
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { resolve } from "node:path";

const run = promisify(execFile);
const DATASET = resolve(process.cwd(), process.env.DATASET_ROOT ?? "runs/screenreader-dataset");
const flag = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const outDir = resolve(process.cwd(), flag("out", "backups"));

/** Only what cannot be regenerated cheaply: the captures and the manifest that indexes them. */
const WANTED = ["captures", "manifest.json"];

function describe() {
  const present = WANTED.filter((name) => existsSync(resolve(DATASET, name)));
  const missing = WANTED.filter((name) => !present.includes(name));
  const captures = existsSync(resolve(DATASET, "captures"))
    ? readdirSync(resolve(DATASET, "captures")).filter((f) => f.endsWith(".json")).length
    : 0;
  return { present, missing, captures };
}

const { present, missing, captures } = describe();
if (!present.length) {
  process.stderr.write(`nothing to snapshot: no captures or manifest under ${DATASET}\n`);
  process.exit(2);
}
if (missing.length) process.stderr.write(`note: ${missing.join(", ")} absent, archiving the rest\n`);

// Timestamp comes from the clock at run time, and is the only thing distinguishing two snapshots, so it
// carries seconds: two archives in one minute is a normal thing to want when a recapture is in doubt.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
mkdirSync(outDir, { recursive: true });
const archive = resolve(outDir, `corpus-${stamp}.tar.gz`);

process.stdout.write(`Archiving ${captures} capture(s) from ${DATASET}\n`);
await run("tar", ["-czf", archive, "-C", DATASET, ...present], { maxBuffer: 1 << 26 });
const size = statSync(archive).size;
process.stdout.write(`Wrote ${archive} (${(size / (1024 * 1024)).toFixed(1)} MB)\n`);
process.stdout.write(
  "This is on the SAME DISK as the corpus. Sync it somewhere durable if you care about it —\n" +
  "that step is deliberately not automated; see RELEASE.md, \"Deferred\".\n");
