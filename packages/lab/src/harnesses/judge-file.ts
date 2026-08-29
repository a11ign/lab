/**
 * Run the judge against a captured transcript JSON file.
 *
 * Usage: npx tsx src/lab/judge-file.ts <transcript.json> "<task>"
 *
 * The transcript file is the output of a capture worker:
 *   { url, screenReader, transcript: string[] }
 * This closes the end-to-end loop: a real screen-reader capture (e.g. NVDA on
 * the Windows worker) judged by the Codex-backed judge on the control plane.
 */
import type { CaptureStructure } from "@a11y-witness/evidence";
import { readFileSync } from "node:fs";
import { judge } from "@a11y-witness/judge";

async function main(): Promise<void> {
  const path = process.argv[2];
  const task = process.argv[3] ?? "Read and understand this page";
  if (!path) {
    console.error('Usage: npx tsx src/lab/judge-file.ts <transcript.json> "<task>"');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(path, "utf8")) as {
    url: string;
    screenReader?: string;
    transcript: string[];
    // Derived from the wire type — known-gaps §15. A harness restating it is how the copies multiplied.
    structure?: Pick<CaptureStructure, "headings" | "landmarks" | "formFields">;
    interaction?: { controls: string[]; stateChanges: { control: string; after: string }[] };
  };
  const verdict = await judge({
    url: data.url,
    task,
    screenReader: data.screenReader ?? "NVDA",
    transcript: data.transcript,
    structure: data.structure,
    interaction: data.interaction,
  });
  console.log(JSON.stringify(verdict, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
