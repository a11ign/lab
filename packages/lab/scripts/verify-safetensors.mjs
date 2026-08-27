#!/usr/bin/env node
// @ts-check

/**
 * Check a local model directory before it is used for training or conversion.
 *
 * Training mode is deliberately strict: at least one .safetensors checkpoint
 * must be present and pickle-style weight formats are rejected. Inference mode
 * accepts an ONNX or GGUF artifact, but still rejects unsafe training weights.
 * Metadata and tokenizer files are allowed because they are not executable
 * model checkpoints.
 */
import { lstat, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { refuseUnknownFlags } from "@a11y-witness/worker-fleet/cli-flags";

/**
 * `--inference` decides which shape is verified, so a typo checks the wrong contract and passes.
 *
 * An unrecognised flag is otherwise IGNORED, so it runs the default and reports success.
 */
refuseUnknownFlags(["--inference"], { entry: import.meta.url, command: "npm run scorer:verify" });

/**
 * Wrapped and GUARDED, so importing this module does not run it.
 *
 * It was 60 lines of top-level statements, so `node -e "import(...)"` — the only way to catch a bad
 * `.mjs` import, since neither lint nor tsc can see one — executed the whole check and printed a usage
 * error instead. `entry-points.test.ts` says exactly why this matters and did not cover this file,
 * because its discovery reads npm scripts and NOTHING invoked this one.
 */
/** Weight formats that execute code when loaded. safetensors exists precisely because these do. */
const UNSAFE_EXTENSIONS = new Set([
  ".bin", ".pt", ".pth", ".ckpt", ".pkl", ".pickle", ".h5", ".msgpack", ".ot",
]);

/** @param {string} dir @returns {Promise<string[]>} */
async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

/**
 * Sort a directory's files into the three kinds this check cares about.
 *
 * A SYMBOLIC LINK counts as unsafe whatever it points at: the check is of this directory, and a link can
 * leave it. Verifying what a link resolves to would verify a different directory from the one shipped.
 *
 * @param {string[]} files @param {string} modelDir
 */
export async function classify(files, modelDir) {
  /** @type {{unsafe: string[], safetensors: string[], inference: string[]}} */
  const found = { unsafe: [], safetensors: [], inference: [] };
  for (const file of files) {
    const name = file.toLowerCase();
    const ext = name.slice(name.lastIndexOf("."));
    const shown = relative(modelDir, file);
    if (UNSAFE_EXTENSIONS.has(ext)) found.unsafe.push(shown);
    if (ext === ".safetensors") found.safetensors.push(shown);
    if (ext === ".onnx" || ext === ".gguf") found.inference.push(shown);
    if ((await lstat(file)).isSymbolicLink()) found.unsafe.push(`${shown} (symbolic link)`);
  }
  return found;
}

/**
 * What is wrong with this directory, as a list. Empty means nothing.
 *
 * @param {{unsafe: string[], safetensors: string[], inference: string[]}} found
 * @param {"training"|"inference"} mode
 */
export function problems(found, mode) {
  const errors = [];
  if (found.unsafe.length) errors.push(`unsafe checkpoint files: ${found.unsafe.join(", ")}`);
  if (mode === "training" && !found.safetensors.length) {
    errors.push("training mode requires at least one .safetensors checkpoint");
  }
  if (mode === "inference" && !found.inference.length) {
    errors.push("inference mode requires at least one .onnx or .gguf artifact");
  }
  return errors;
}

/**
 * Wrapped and GUARDED, so importing this module does not run it.
 *
 * It was 60 lines of top-level statements, so `node -e "import(...)"` — the only way to catch a bad
 * `.mjs` import, since neither lint nor tsc can see one — executed the whole check and printed a usage
 * error instead. `entry-points.test.ts` says exactly why that matters and did not cover this file,
 * because its discovery reads npm scripts and NOTHING invoked this one.
 */
async function main() {
  const mode = process.argv[2] === "--inference" ? "inference" : "training";
  const modelDirArg = mode === "inference" ? process.argv[3] : process.argv[2];
  if (!modelDirArg || modelDirArg.startsWith("-")) {
    console.error("Usage: node scripts/verify-safetensors.mjs [--inference] <model-directory>");
    process.exit(2);
  }
  const modelDir = resolve(modelDirArg);

  let files;
  try {
    files = await filesUnder(modelDir);
  } catch (error) {
    console.error(`MODEL CHECK FAILED (${mode})`);
    console.error(`- cannot read ${modelDir}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const found = await classify(files, modelDir);
  const errors = problems(found, mode);
  if (errors.length) {
    console.error(`MODEL CHECK FAILED (${mode})`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`MODEL CHECK PASSED (${mode})`);
  console.log(`- directory: ${modelDir}`);
  console.log(`- safetensors: ${found.safetensors.length}`);
  if (found.inference.length) console.log(`- inference artifacts: ${found.inference.join(", ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
