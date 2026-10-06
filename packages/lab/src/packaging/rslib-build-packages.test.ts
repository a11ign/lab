/**
 * ROW 4c-a11ign OF ADR 0043 (#3580): a11ign's published packages are built by Rslib to `.mjs` plus `.d.ts`, and nothing here builds with `tsc --build`.
 *
 * Seven things are pinned, each by a function over a manifest or a config, driven first against a fixture that breaks it (the positive control: a
 * pass over the real tree is then not "found nothing"), and then against the real tree:
 *
 * 1. EVERY PUBLISHED PACKAGE has an `rslib.config.ts` and a `prepack` that builds it, and no `package.json` under `packages/` names `tsc --build`.
 * 2. EVERY `exports` TARGET is `.mjs` or `.d.ts` and every `bin` target is `.mjs`. A `.js` left behind names a file the build no longer makes.
 * 3. THE ENTRIES AGREE WITH `exports`, in both directions, and every entry's source exists (`entryProblems`, the toolchain's own helper).
 * 4. ONE BUILD AT INSTALL, #168 RESTATED. Five packages once each ran `tsc --build` from `prepare`, an unordered race that failed `ci/ts`
 *    intermittently with eleven type errors in a package the pull request never touched. The root `prepare` runs exactly one build, `pnpm -r run build`
 *    (pnpm's own topological order), and no package's `prepare` runs one.
 * 5. NO `references`, and the root base carries none of `composite`, `outDir`, `rootDir`: the compiler no longer orders anything.
 * 6. THE BUILD ORDER IS NOW THE MANIFESTS', so every `@a11ign/<member>` a package's source imports is declared in its manifest. This is the
 *    successor of `project-references.test.ts`, which asserted the same about `references`; pnpm orders `-r` by the declared edges, peers included.
 * 7. THE CLI BUNDLE IS THE ONE THE ADR MEASURED: `@a11ign/documents`, `pdf-lib` and `yaml` are inlined, `evidence`, `judge` and `scorer` stay external,
 *    and a PDF scan run through the BUILT `dist/cli.mjs` works (the row's falsifier 6: a scan the unbundled form passes and the bundle fails withdraws
 *    the inlining).
 * 8. `scripts/build-packages.mjs` is gone, and the scorer's package-root read still resolves from the BUILT entry (a bundle moves the file
 *    `new URL("../", import.meta.url)` is relative to; the ADR said what the scorer reads there "was not looked at").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { entryProblems, type PackageExports } from "@a11ign/toolchain/entries";
// STATIC, because a dynamic `import()` of a `.ts` path is not transformed by the runner. The test below asserts the list is every config found.
import cliConfig from "../../../cli/rslib.config.ts";
import evidenceConfig from "../../../evidence/rslib.config.ts";
import judgeConfig from "../../../judge/rslib.config.ts";
import scorerConfig from "../../../scorer/rslib.config.ts";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const PACKAGES = join(REPO, "packages");

type Manifest = PackageExports & {
  name?: string;
  private?: boolean;
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
type Package = { dir: string; manifest: Manifest };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** Every directory under `packages/` that holds a manifest. */
function packages(): Package[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(PACKAGES, entry.name, "package.json")))
    .map((entry) => ({ dir: entry.name, manifest: readJson<Manifest>(join(PACKAGES, entry.name, "package.json")) }));
}

/** A published package: not private. These are the ones that ship a `dist`. */
const published = (): Package[] => packages().filter(({ manifest }) => manifest.private !== true);

/** The published packages this row converts, by directory: the population the discovery must still find. */
const CONVERTED = ["evidence", "judge", "scorer", "cli"];

test("VACUITY GUARD: the discovery finds the four converted packages among the published ones", () => {
  const found = published().map(({ dir }) => dir);
  for (const dir of CONVERTED) assert.ok(found.includes(dir), `${dir} is not among the published packages found (${found.join(", ")}): the walk is blind`);
});

// 1. THE BUILD IS RSLIB ------------------------------------------------------------------------------------------------------------

/** What is wrong with how a package builds. Empty is agreement. */
function builderProblems(manifest: Manifest, { hasConfig }: { hasConfig: boolean }): string[] {
  const problems: string[] = [];
  if (!hasConfig) problems.push("it has no rslib.config.ts");
  if (manifest.scripts?.prepack !== "rslib build") problems.push(`its prepack is ${JSON.stringify(manifest.scripts?.prepack)}, not "rslib build"`);
  return problems;
}

/** Every script of a manifest that runs `tsc --build`, as `name: command`. */
function tscBuildScripts(manifest: Manifest): string[] {
  return Object.entries(manifest.scripts ?? {}).filter(([, command]) => /\btsc\b[^&|;]*--build\b|\btsc\s+-b\b/.test(command)).map(([name, command]) => `${name}: ${command}`);
}

test("control: a manifest whose prepack is still `tsc --build` is RED, on both counts", () => {
  const stale: Manifest = { scripts: { prepack: "tsc --build" } };
  assert.deepEqual(builderProblems(stale, { hasConfig: false }), ["it has no rslib.config.ts", 'its prepack is "tsc --build", not "rslib build"']);
  assert.deepEqual(tscBuildScripts(stale), ["prepack: tsc --build"]);
  assert.deepEqual(tscBuildScripts({ scripts: { build: "pnpm exec tsc -b ." } }), ["build: pnpm exec tsc -b ."]);
  assert.deepEqual(tscBuildScripts({ scripts: { typecheck: "tsc --noEmit", prepack: "rslib build" } }), [], "`tsc --noEmit` is the checker and stays");
});

test("every published package has an rslib.config.ts and a prepack that builds it", () => {
  const offenders = published().flatMap(({ dir, manifest }) =>
    builderProblems(manifest, { hasConfig: existsSync(join(PACKAGES, dir, "rslib.config.ts")) }).map((problem) => `packages/${dir}: ${problem}`));
  assert.deepEqual(offenders, []);
});

test("no package.json under packages/ names `tsc --build`", () => {
  const offenders = packages().flatMap(({ dir, manifest }) => tscBuildScripts(manifest).map((script) => `packages/${dir} ${script}`));
  assert.deepEqual(offenders, []);
});

// 2. THE TARGETS ARE .mjs AND .d.ts ---------------------------------------------------------------------------------------------

/** What is wrong with the files a manifest points at. A plain `.json` target is a file the package ships as it is (`./package.json`). */
function targetProblems(manifest: Manifest): string[] {
  const problems: string[] = [];
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target === "string") {
      if (!target.endsWith(".json")) problems.push(`exports "${subpath}" is ${target}, neither a built .mjs nor a shipped .json`);
      continue;
    }
    // `.d.mts` is what a source kept as `.mjs` declares as (the toolchain's); a `.ts` source declares `.d.ts`.
    if (target.types !== undefined && !/\.d\.m?ts$/.test(target.types)) problems.push(`exports "${subpath}" types is ${target.types}, not a .d.ts`);
    if (target.default !== undefined && !target.default.endsWith(".mjs")) problems.push(`exports "${subpath}" default is ${target.default}, not a .mjs`);
  }
  for (const [name, target] of Object.entries(manifest.bin ?? {})) {
    if (!target.endsWith(".mjs")) problems.push(`bin "${name}" is ${target}, not a .mjs`);
  }
  return problems;
}

test("control: a `.js` default, a `.ts` types target and a `.js` bin are each RED", () => {
  const stale: Manifest = {
    exports: { ".": { types: "./dist/index.ts", default: "./dist/index.js" }, "./x": "./dist/x.js" },
    bin: { tool: "./dist/cli.js" },
  };
  assert.equal(targetProblems(stale).length, 4);
  assert.deepEqual(targetProblems({ exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.mjs" }, "./package.json": "./package.json" }, bin: { tool: "./dist/cli.mjs" } }), []);
});

test("every exports target of a published package is .mjs or .d.ts, and every bin target is .mjs", () => {
  const offenders = published().flatMap(({ dir, manifest }) => targetProblems(manifest).map((problem) => `packages/${dir}: ${problem}`));
  assert.deepEqual(offenders, []);
});

// 3. THE ENTRIES AGREE WITH `exports` -------------------------------------------------------------------------------------------

/** `bin` targets are built files no `exports` key names, so they stand in the map as subpaths of their own. */
const withBins = (manifest: Manifest): PackageExports => ({
  exports: { ...manifest.exports, ...Object.fromEntries(Object.entries(manifest.bin ?? {}).map(([name, target]) => [`bin:${name}`, target])) },
});

test("control: an entry map missing an exports key, or holding one no key names, is RED", () => {
  const manifest: Manifest = { exports: { ".": { default: "./dist/index.mjs" }, "./a": { default: "./dist/a.mjs" } } };
  assert.equal(entryProblems(withBins(manifest), { index: "./src/index.ts" }).length, 1);
  assert.equal(entryProblems(withBins(manifest), { index: "./src/index.ts", a: "./src/a.ts", b: "./src/b.ts" }).length, 1);
  assert.deepEqual(entryProblems(withBins({ ...manifest, bin: { t: "./dist/cli.mjs" } }), { index: "./src/index.ts", a: "./src/a.ts", cli: "./src/cli.ts" }), []);
});

type LibraryConfig = { lib: { source: { entry: Record<string, string> } }[] };
const CONFIGS: Record<string, LibraryConfig> = {
  cli: cliConfig as LibraryConfig, evidence: evidenceConfig as LibraryConfig, judge: judgeConfig as LibraryConfig, scorer: scorerConfig as LibraryConfig,
};

test("every published package's rslib.config.ts builds exactly the entries its exports and bin name, from sources that exist", () => {
  // The toolchain's own config is checked by `a11ign/toolchain`'s own tests; a config found here and not imported above is a package this list forgot.
  const found = published().filter(({ dir }) => existsSync(join(PACKAGES, dir, "rslib.config.ts")));
  assert.deepEqual(found.map(({ dir }) => dir).sort(), Object.keys(CONFIGS).sort(), "CONFIGS above is not every published package's config");
  const offenders: string[] = [];
  for (const { dir, manifest } of found) {
    const [{ source: { entry } }] = CONFIGS[dir].lib;
    offenders.push(...entryProblems(withBins(manifest), entry).map((problem) => `packages/${dir}: ${problem}`));
    for (const [name, source] of Object.entries(entry)) {
      if (!existsSync(join(PACKAGES, dir, source))) offenders.push(`packages/${dir}: entry "${name}" names ${source}, which does not exist`);
    }
  }
  assert.deepEqual(offenders, []);
});

/** The packages whose config leaves rspack's persistent build cache on. */
const cachingConfigs = (configs: Record<string, { performance?: { buildCache?: boolean } }>): string[] =>
  Object.entries(configs).filter(([, config]) => config.performance?.buildCache !== false).map(([dir]) => dir);

test("control: a config that leaves the build cache on is RED", () => {
  assert.deepEqual(cachingConfigs({ judge: {}, cli: { performance: { buildCache: true } }, scorer: { performance: { buildCache: false } } }), ["judge", "cli"]);
});

test("no package's build uses rspack's persistent cache: two `npm pack`s of one package at once PANIC on its lock", () => {
  // Measured 2026-10-06: a second concurrent `rslib build` in `packages/judge` aborted with "State lock mismatch ... This indicates a race condition"
  // (~1 pair in 4), and `no-worker-refusal.test.ts` packs the packages from a parallel worker. Off, 18 concurrent pairs across judge, scorer and cli passed.
  assert.deepEqual(cachingConfigs(CONFIGS as Record<string, { performance?: { buildCache?: boolean } }>), []);
});

/** The packages whose config lets Rslib empty `dist` before a build. */
const cleaningConfigs = (configs: Record<string, { lib: { output?: { cleanDistPath?: boolean } }[] }>): string[] =>
  Object.entries(configs).filter(([, config]) => config.lib.some((lib) => lib.output?.cleanDistPath !== false)).map(([dir]) => dir);

test("control: a config that lets Rslib empty `dist` is RED", () => {
  assert.deepEqual(cleaningConfigs({ judge: { lib: [{}] }, cli: { lib: [{ output: { cleanDistPath: true } }] }, scorer: { lib: [{ output: { cleanDistPath: false } }] } }), ["judge", "cli"]);
});

test("no package's build empties `dist`: a pack in one test file left another's reader a missing built file", () => {
  // Measured 2026-10-06: `corpus-restore-drill.test.ts` failed with ERR_MODULE_NOT_FOUND on `packages/scorer/dist/evidence-units.mjs` in a full `verify` run
  // (it passes alone); a poller over one `rslib build` of scorer found the file absent on 2.4% of reads, and on none with `cleanDistPath: false`.
  assert.deepEqual(cleaningConfigs(CONFIGS as Parameters<typeof cleaningConfigs>[0]), []);
});

// 4. ONE BUILD AT INSTALL, #168 -------------------------------------------------------------------------------------------------

/** The simple commands of a script line, split on `&&`, `||`, `;`, `|` and `&`. */
const segmentsOf = (line: string): string[] => line.split(/&&|\|\||[;|&]/).map((segment) => segment.trim()).filter(Boolean);

/** The commands of a script that BUILD packages: Rslib itself, `tsc --build`, or pnpm running every package's `build` (`-r run build`). */
function buildSteps(script: string | undefined): string[] {
  return segmentsOf(script ?? "").filter((segment) => /\brslib\s+build\b|\btsc\b[^&|;]*--build\b|-r\s+run\s+build\b|\brun\s+-r\s+build\b/.test(segment));
}

test("control, #168 restated: a package-level `prepare` that builds is RED, and so is a root `prepare` that builds twice", () => {
  const raced = packagesWhoseLifecycleBuilds([{ dir: "judge", manifest: { scripts: { prepack: "rslib build", prepare: "rslib build" } } }]);
  assert.deepEqual(raced, ["judge"]);
  assert.deepEqual(packagesWhoseLifecycleBuilds([{ dir: "judge", manifest: { scripts: { prepack: "rslib build" } } }]), []);
  assert.equal(buildSteps("node scripts/lay-layer.mjs x && node scripts/pnpm.mjs -r run build && rslib build").length, 2);
  assert.equal(buildSteps("node scripts/install-git-hooks.mjs").length, 0);
});

/** The directories whose own `prepare` builds: `npm ci` fires it in every workspace at once, with nothing ordering one after another. */
const packagesWhoseLifecycleBuilds = (all: Package[]): string[] => all.filter(({ manifest }) => buildSteps(manifest.scripts?.prepare).length > 0).map(({ dir }) => dir);

test("the root `prepare` and `build` each run exactly ONE build, and it is pnpm's own ordered one", () => {
  const { scripts } = readJson<Manifest>(join(REPO, "package.json"));
  for (const name of ["prepare", "build"]) {
    const steps = buildSteps(scripts?.[name]);
    assert.equal(steps.length, 1, `the root \`${name}\` runs ${steps.length} builds (${steps.join(" ; ")}), not one`);
    assert.match(steps[0], /scripts\/pnpm\.mjs -r run build$/, `the root \`${name}\` build is not \`pnpm -r run build\`, which orders packages by their declared dependencies`);
  }
});

test("no package's own `prepare` runs a build", () => {
  assert.deepEqual(packagesWhoseLifecycleBuilds(packages()), []);
});

// 5. NO `references`, NO emit settings in the root base -------------------------------------------------------------------------------

/** A tsconfig's own contents, comments allowed. */
function tsconfigOf(path: string): { references?: unknown[]; compilerOptions?: Record<string, unknown> } {
  const { config, error } = ts.readConfigFile(path, (file) => readFileSync(file, "utf8"));
  assert.equal(error, undefined, `${path} does not parse`);
  return config as { references?: unknown[]; compilerOptions?: Record<string, unknown> };
}

const EMIT_SETTINGS = ["composite", "outDir", "rootDir"];
const emitSettingsIn = (options: Record<string, unknown> | undefined): string[] => EMIT_SETTINGS.filter((key) => key in (options ?? {}));

test("control: a tsconfig with `references`, and a base with `composite`, are RED", () => {
  assert.equal(tsconfigFromText('{ "references": [{ "path": "../a" }] }').references?.length, 1);
  assert.deepEqual(emitSettingsIn({ composite: true, strict: true, outDir: "dist" }), ["composite", "outDir"]);
  assert.deepEqual(emitSettingsIn({ strict: true }), []);
});

function tsconfigFromText(text: string): { references?: unknown[] } {
  return ts.parseConfigFileTextToJson("tsconfig.json", text).config as { references?: unknown[] };
}

test("no tsconfig.json under packages/ carries `references`, and the root base carries none of composite, outDir, rootDir", () => {
  const configs = packages().map(({ dir }) => join(PACKAGES, dir, "tsconfig.json")).filter(existsSync);
  assert.ok(configs.length >= CONVERTED.length, `only ${configs.length} tsconfig.json found under packages/: the walk is blind`);
  assert.deepEqual(configs.filter((path) => (tsconfigOf(path).references ?? []).length > 0), []);
  assert.deepEqual(emitSettingsIn(tsconfigOf(join(REPO, "tsconfig.base.json")).compilerOptions), []);
});

// 6. EVERY SIBLING A PACKAGE IMPORTS IS DECLARED ----------------------------------------------------------------------------------

/** The `@a11ign/<name>` specifiers in a source text, subpaths and all. */
const siblingsNamed = (source: string): string[] => [...source.matchAll(/["'](@a11ign\/[a-z-]+)(?:\/[^"']*)?["']/g)].map((match) => match[1]);

/** Every file under a directory whose name ends in one of the given extensions, tests excluded. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourcesUnder(full);
    return /\.(?:ts|mjs)$/.test(entry.name) && !/\.test\.(?:ts|mjs)$/.test(entry.name) ? [full] : [];
  });
}

/** What a package imports from another workspace member and does not declare: pnpm orders `-r` by the declared edges, so an undeclared one is a race. */
function undeclaredSiblings({ imported, manifest, members }: { imported: string[]; manifest: Manifest; members: Set<string> }): string[] {
  const declared = new Set([manifest.dependencies, manifest.devDependencies, manifest.peerDependencies, manifest.optionalDependencies].flatMap((group) => Object.keys(group ?? {})));
  return [...new Set(imported)].filter((name) => name !== manifest.name && members.has(name) && !declared.has(name)).sort();
}

test("control: a package importing a workspace member it does not declare is RED", () => {
  const members = new Set(["@a11ign/evidence", "@a11ign/scorer"]);
  assert.deepEqual(undeclaredSiblings({ imported: siblingsNamed(`import x from "@a11ign/scorer/y"; import "@a11ign/evidence"`), manifest: { name: "@a11ign/judge", dependencies: { "@a11ign/evidence": "0.2.0" } }, members }), ["@a11ign/scorer"]);
  assert.deepEqual(undeclaredSiblings({ imported: ["@a11ign/scorer"], manifest: { name: "@a11ign/judge", peerDependencies: { "@a11ign/scorer": "0.2.1" } }, members }), [], "a peer is an edge pnpm orders by");
});

test("every workspace member a published package's source imports is declared in its manifest", () => {
  const all = packages();
  const members = new Set(all.flatMap(({ manifest }) => manifest.name ?? []));
  const offenders = published().flatMap(({ dir, manifest }) => {
    const imported = sourcesUnder(join(PACKAGES, dir, "src")).flatMap((file) => siblingsNamed(readFileSync(file, "utf8")));
    return undeclaredSiblings({ imported, manifest, members }).map((name) => `packages/${dir} imports ${name} and does not declare it`);
  });
  assert.ok(members.size >= CONVERTED.length, "no workspace member read: the walk is blind");
  assert.deepEqual(offenders, []);
});

// 7. THE CLI BUNDLE -------------------------------------------------------------------------------------------------------------

/** The bare specifiers a built `.mjs` imports from, in `from "x"` and `import("x")` form. Relative and `node:` specifiers are not packages. */
function importedPackages(source: string): Set<string> {
  const found = [...source.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"'./][^"']*)["']/g)].map((match) => match[1]).filter((name) => !name.startsWith("node:"));
  return new Set(found.map((name) => (name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0])));
}

test("control: the import reader sees external packages and ignores relative, node: and bundled ones", () => {
  const imported = importedPackages('import { a } from "node:fs"; import b from "./9.mjs"; import c from "@a11ign/judge/rules"; const d = await import("yaml");');
  assert.deepEqual([...imported].sort(), ["@a11ign/judge", "yaml"]);
});

test("the CLI bundle inlines documents, pdf-lib and yaml and leaves evidence, judge and scorer external", () => {
  const built = join(PACKAGES, "cli/dist/cli.mjs");
  assert.ok(existsSync(built), "packages/cli/dist/cli.mjs does not exist: run `pnpm run build` (the suite's pretest does)");
  const imported = importedPackages(readFileSync(built, "utf8"));
  for (const external of ["@a11ign/evidence", "@a11ign/judge", "@a11ign/scorer"]) {
    assert.ok(imported.has(external), `the bundle no longer imports ${external}: inlining it would give the CLI a second copy of its module state beside scorer's`);
  }
  const inlined = ["@a11ign/documents", "pdf-lib", "yaml"].filter((name) => imported.has(name));
  assert.deepEqual(inlined, [], "the bundle imports a package it is meant to inline, which a consumer no longer installs");
});

/** One untagged, one-page PDF, hand-built like `@a11ign/documents`'s own fixture: enough for one real `pdf-untagged` finding. */
function untaggedPdf(): Buffer {
  const content = "BT /F1 16 Tf 50 150 Td (Hello world) Tj ET\n";
  const objects = ["", "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const offsets: number[] = [0];
  let pdf = "%PDF-1.7\n";
  for (let index = 1; index < objects.length; index++) {
    offsets[index] = Buffer.byteLength(pdf, "latin1");
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  return Buffer.from(`${pdf}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`, "latin1");
}

const PDF_SCAN_TIMEOUT_MS = 60_000;

test("a PDF scan run through the BUILT CLI bundle reports the untagged PDF", async () => {
  const built = join(PACKAGES, "cli/dist/cli.mjs");
  assert.ok(existsSync(built), "packages/cli/dist/cli.mjs does not exist: run `pnpm run build` (the suite's pretest does)");
  const server = createServer((_request, response) => { response.setHeader("content-type", "application/pdf"); response.end(untaggedPdf()); });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  try {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    // ASYNC on purpose: the server is in this process, and a synchronous spawn would block the event loop that has to answer the child.
    const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>((done) =>
      execFile(process.execPath, [built, `http://127.0.0.1:${port}/report.pdf`, "--json"], { encoding: "utf8", timeout: PDF_SCAN_TIMEOUT_MS },
        (error, out, err) => done({ code: typeof error?.code === "number" ? error.code : error ? 1 : 0, stdout: out, stderr: err })));
    assert.equal(code, 0, `the bundle exited ${code}: ${stderr.slice(0, 400)}`);
    const { pdf } = JSON.parse(stdout) as { pdf: { rule: string }[] };
    assert.ok(pdf.some((finding) => finding.rule === "pdf-untagged"), `no pdf-untagged finding in ${stdout.slice(0, 400)}`);
  } finally {
    server.close();
  }
});

// 8. THE SCRIPT IS GONE; THE SCORER'S ROOT READ RESOLVES FROM THE BUILT ENTRY ---------------------------------------------------------

test("scripts/build-packages.mjs does not exist, and the check can see a script that does", () => {
  assert.ok(existsSync(join(REPO, "scripts/lay-layer.mjs")), "the control is blind: a script that exists was not seen");
  assert.equal(existsSync(join(REPO, "scripts/build-packages.mjs")), false, "scripts/build-packages.mjs is back: `pnpm -r run build` builds every package (#3580)");
});

test("the scorer's package-root read resolves, from the BUILT entry, to files the package ships", async () => {
  const built = join(PACKAGES, "scorer/dist/index.mjs");
  assert.ok(existsSync(built), "packages/scorer/dist/index.mjs does not exist: run `pnpm run build` (the suite's pretest does)");
  const { scorerPaths } = await import(pathToFileURL(built).href) as { scorerPaths: () => Record<string, string> };
  const paths = scorerPaths();
  // `encoderDir` is NOT shipped (87 MB, fetched on demand), so it is the one path that is allowed not to exist.
  const missing = Object.entries(paths).filter(([name, path]) => name !== "encoderDir" && !existsSync(path)).map(([name, path]) => `${name}: ${path}`);
  assert.deepEqual(missing, []);
  assert.equal(paths.weights.startsWith(join(PACKAGES, "scorer") + "/"), true, `the root read left the package: ${paths.weights}`);
});
