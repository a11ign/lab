/**
 * M0 SPIKE: is the core bet real?
 *
 * Goal: prove that an AI model can judge the REAL screen-reader experience
 * trustworthily. We drive VoiceOver (via Guidepup) through a page the way a
 * real user navigates, capture what it announces, and ask the Codex-backed
 * judge whether the experience was coherent and usable.
 *
 * This models real navigation (reading in browse mode), NOT tabbing. Tabbing
 * only reaches interactive controls and is not how screen-reader users read a
 * page.
 *
 * Next refinements (verify exact commands in the Guidepup docs first):
 *   - get the cursor cleanly into the page's web area
 *   - add heading navigation via voiceOver.perform(voiceOver.keyboardCommands...)
 *   - drive multi-step task flows
 */
import { pathToFileURL } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { voiceOver } from "@guidepup/guidepup";
import { judge } from "@a11y-witness/judge";

const sh = promisify(exec);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const url = process.argv[2];
  const task = process.argv[3] ?? "Read and understand this page";
  if (!url) {
    console.error('Usage: npm run spike -- <url> "<task>"');
    process.exit(1);
  }

  // Open the page in Safari, which VoiceOver drives well on macOS, and let it settle.
  await sh(`open -a Safari ${JSON.stringify(url)}`);
  await delay(3000);

  let transcript: string[];
  await voiceOver.start();
  try {
    // Browse-style read-through, NOT tabbing: step the VoiceOver cursor forward
    // and let it speak. The full spoken log is collected at the end.
    for (let i = 0; i < 60; i++) {
      await voiceOver.next();
    }
    transcript = await voiceOver.spokenPhraseLog();
  } finally {
    await voiceOver.stop();
  }

  console.log(`\nCaptured ${transcript.length} announcements. Judging...\n`);
  const verdict = await judge({ url, task, screenReader: "VoiceOver", transcript });
  console.log(JSON.stringify(verdict, null, 2));
}

/**
 * Run ONLY when this file is the program, never when it is imported — so a test (or the `import()` load
 * check) can reach the functions above without executing the script. See `entry-points.test.ts`.
 */
const isProgram = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isProgram) main().catch((err) => {
  console.error(err);
  process.exit(1);
});
