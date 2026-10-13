import { readFileSync, readdirSync } from "node:fs";

/**
 * Every lab module that DISPATCHES a capture to a worker -- the one discovery that `capture-body-owner.test.ts`
 * (who builds the body) and `worker-code-check-clients.test.ts` (who runs the preflight) both read, so the two
 * cannot drift into disagreeing about what a capture client is.
 *
 * DISPATCHING WORK is the signature, and it has two spellings: a literal POST, or a call to the shared
 * `captureTolerantly`. Matching only the first found four clients after nine moved behind the shared one.
 * Still NOT matched: reading `/capture/<id>` to recover a lost response, which asks for work already done.
 *
 * `.ts` since lab v0.1.27 (a11ign/a11ign#4519). The control copy of the discovery matched `.mjs` alone, so the
 * five harness clients were never discovered; a `.mjs` left beside a `.ts` is a one-release shim that throws,
 * so it matches no dispatch.
 *
 * `repo` is the root a caller computes for itself: this is a non-test source, which `core-root.test.ts` refuses to
 * climb out of the lab, and a caller that is a test may.
 * The positive control for an emptiness assertion over this list lives in each caller's own floor test.
 */
export function captureClients(repo: string): string[] {
  const found: string[] = [];
  for (const dir of ["packages/lab/src/training", "packages/lab/src/harnesses"]) {
    for (const entry of readdirSync(`${repo}${dir}`)) {
      if (!/\.(mjs|ts)$/.test(entry) || /\.(test|d)\.ts$/.test(entry)) continue;
      const path = `${dir}/${entry}`;
      const source = readFileSync(`${repo}${path}`, "utf8");
      const dispatches = /["'`][^"'`]*\/capture["'`][^]{0,120}?method:\s*["']POST["']/.test(source)
        || /\bcaptureTolerantly\(/.test(source);
      if (dispatches) found.push(path);
    }
  }
  return found.sort();
}
