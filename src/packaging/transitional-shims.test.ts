/**
 * The one-release `.mjs` shims of `scripts/` (a11ign/a11ign#4551): what each one is, and that it still runs the program.
 *
 * WHY A SHIM RUNS THE PROGRAM. The 35 `scripts/*.mjs` became `.ts`, and the core's `package.json`, its nightly unit and control's `lab-job.yml` still name the
 * `.mjs`. The `.ts` is a program only when it is itself the entry file (`import.meta.url === pathToFileURL(process.argv[1])`), so a bare re-export would exit 0
 * having measured nothing, and a throw would stop every lab job between the core pinning this release and the core pinning the control that names the `.ts`.
 * So the shim re-exports for an importer and, as the entry file, runs the `.ts` with the same arguments and exits with its status.
 *
 * THE PINS HERE ARE THE SHIMS' OWN: a11ign/a11ign#4798 deletes the 35 shims and this file with them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTransitionalShim, programBehind } from "../transitional-shims.ts";

const SCRIPTS = fileURLToPath(new URL("../../scripts/", import.meta.url));
const MARKER = "// TRANSITIONAL (a11ign/a11ign#4551)";
const RENAMED = 35;

/** What a shim is below its header comment: the same text for every program, with only its stem different. */
function shimBody(stem: string): string {
  return [
    'import { spawnSync } from "node:child_process";',
    'import { realpathSync } from "node:fs";',
    'import { fileURLToPath, pathToFileURL } from "node:url";',
    `export * from "./${stem}.ts";`,
    "if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {",
    `  process.stderr.write("${stem}.mjs is now ${stem}.ts (a11ign/a11ign#4551): this name is deleted at the next lab release; running the .ts\\n");`,
    `  const run = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(new URL("./${stem}.ts", import.meta.url)), ...process.argv.slice(2)], { stdio: "inherit" });`,
    "  if (run.error) throw run.error;",
    "  process.exit(run.status ?? 1);",
    "}",
    "",
  ].join("\n");
}

const bodyOf = (source: string) => source.slice(source.indexOf("import { spawnSync }"));
const shimStems = () => readdirSync(SCRIPTS)
  .filter((file) => file.endsWith(".mjs") && readFileSync(join(SCRIPTS, file), "utf8").startsWith(MARKER))
  .map((file) => file.replace(/\.mjs$/, ""))
  .sort();

test(`there are ${RENAMED} shims, each beside the .ts it stands for and each the same text but for its name`, () => {
  const stems = shimStems();
  // The positive control for every loop below: a discovery that found nothing would pass them all.
  assert.equal(stems.length, RENAMED, `${stems.length} marked shims in scripts/, expected ${RENAMED}`);
  for (const stem of stems) {
    const shim = join(SCRIPTS, `${stem}.mjs`);
    assert.ok(isTransitionalShim(shim), `${stem}.mjs has no ${stem}.ts beside it`);
    assert.equal(programBehind(shim), join(SCRIPTS, `${stem}.ts`));
    assert.equal(bodyOf(readFileSync(shim, "utf8")), shimBody(stem), `${stem}.mjs drifted from the shim text`);
  }
});

test("a .mjs with no .ts beside it, and a .ts, are not shims", () => {
  assert.equal(isTransitionalShim(fileURLToPath(new URL("../training/corpus-settled.mjs", import.meta.url))), false);
  assert.equal(isTransitionalShim(join(SCRIPTS, "bench-capture.ts")), false);
});

/** A shim copied beside a stub program, so it can be run with arguments and a status that the real programs would not give it. */
function withStubProgram(run: (shim: string, program: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "transitional-shim-"));
  try {
    const program = join(dir, "stub.ts");
    writeFileSync(program, [
      'import { pathToFileURL } from "node:url";',
      "export const answer: number = 42;",
      "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {",
      '  process.stdout.write(`ran with ${process.argv.slice(2).join(" ")}\\n`);',
      "  process.exit(3);",
      "}",
      "",
    ].join("\n"));
    const shim = join(dir, "stub.mjs");
    copyFileSync(join(SCRIPTS, `${shimStems()[0]}.mjs`), shim);
    writeFileSync(shim, readFileSync(shim, "utf8").split(shimStems()[0]!).join("stub"));
    run(shim, program);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("as the entry file a shim RUNS its program with the same arguments and exits with its status", () => {
  withStubProgram((shim, program) => {
    // The control: the stub itself exits 3 when it is the entry file, so a shim that exited 0 having run nothing cannot pass by coincidence.
    const direct = spawnSync(process.execPath, [program, "a"], { encoding: "utf8" });
    assert.equal(direct.status, 3);

    const viaShim = spawnSync(process.execPath, [shim, "one", "--two=2"], { encoding: "utf8" });
    assert.equal(viaShim.status, 3, `the shim exited ${viaShim.status}, not the program's 3: ${viaShim.stderr}`);
    assert.equal(viaShim.stdout, "ran with one --two=2\n");
    assert.match(viaShim.stderr, /stub\.mjs is now stub\.ts/);
  });
});

test("imported, a shim re-exports the program and runs nothing", () => {
  withStubProgram((shim) => {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import(${JSON.stringify(`file://${shim}`)}).then((m) => process.stdout.write(String(m.answer)))`], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "42");
  });
});
