#!/usr/bin/env node

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

const mode = process.argv[2] === "--inference" ? "inference" : "training";
const modelDirArg = mode === "inference" ? process.argv[3] : process.argv[2];

if (!modelDirArg || modelDirArg.startsWith("-")) {
  console.error("Usage: node scripts/verify-safetensors.mjs [--inference] <model-directory>");
  process.exit(2);
}

const modelDir = resolve(modelDirArg);
const unsafeExtensions = new Set([
  ".bin", ".pt", ".pth", ".ckpt", ".pkl", ".pickle", ".h5", ".msgpack", ".ot",
]);

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

let files;
try {
  files = await filesUnder(modelDir);
} catch (error) {
  console.error(`Cannot read model directory ${modelDir}: ${error.message}`);
  process.exit(2);
}

const unsafe = [];
const safetensors = [];
const inference = [];
for (const file of files) {
  const name = file.toLowerCase();
  const ext = name.slice(name.lastIndexOf("."));
  if (unsafeExtensions.has(ext)) unsafe.push(relative(modelDir, file));
  if (ext === ".safetensors") safetensors.push(relative(modelDir, file));
  if (ext === ".onnx" || ext === ".gguf") inference.push(relative(modelDir, file));
  const info = await lstat(file);
  if (info.isSymbolicLink()) unsafe.push(`${relative(modelDir, file)} (symbolic link)`);
}

const errors = [];
if (unsafe.length) errors.push(`unsafe checkpoint files: ${unsafe.join(", ")}`);
if (mode === "training" && !safetensors.length) {
  errors.push("training mode requires at least one .safetensors checkpoint");
}
if (mode === "inference" && !inference.length) {
  errors.push("inference mode requires at least one .onnx or .gguf artifact");
}

if (errors.length) {
  console.error(`MODEL CHECK FAILED (${mode})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`MODEL CHECK PASSED (${mode})`);
console.log(`- directory: ${modelDir}`);
console.log(`- safetensors: ${safetensors.length}`);
if (inference.length) console.log(`- inference artifacts: ${inference.join(", ")}`);
